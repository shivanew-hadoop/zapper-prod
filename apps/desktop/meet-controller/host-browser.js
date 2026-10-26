'use strict';
// Host-only Google Meet bridge. Use an INSTALLED Chrome/Edge instead of an old
// Electron Chromium. No browser binary or new npm dependency is bundled.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
// The existing ws dependency is loaded only when launching the host browser.
let WebSocket;

const JOIN_TIMEOUT_MS = 95000;
const HEARTBEAT_MS = 1800;
const CDP_STARTUP_MS = 18000;
const MEET = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const JOIN_WORDS = ['join now', 'ask to join', 'request to join', 'join meeting', 'join this call', 'join call', 'switch here'];
const BLOCKED_WORDS = /this browser version is no longer supported|your browser is not supported|you can.t join this video call|returning to (the )?home screen|check your meeting code/i;

function browserCandidates(env = process.env) {
  const dirs = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
  const tails = [
    'Google/Chrome/Application/chrome.exe',
    'Microsoft/Edge/Application/msedge.exe',
  ];
  return [...dirs.flatMap(d => tails.map(t => path.join(d, t))),
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/microsoft-edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
}
function findBrowser() { return browserCandidates().find(f => fs.existsSync(f)) || null; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
// A crashed Zapper may leave *its dedicated* Chrome/Edge process alive. Recover
// that profile only; never terminate the user's unrelated browser processes.
function stopOrphanHostProfile(profileDir, runner = spawnSync) {
  if (process.platform !== 'win32') return;
  const quoted = String(profileDir).replace(/'/g, "''");
  const command = `$profilePath='${quoted}'; $needle='--user-data-dir='+$profilePath; ` +
    `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | ` +
    `Where-Object { $_.CommandLine -and $_.CommandLine.Contains($needle) } | ` +
    `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try { runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(command, 'utf16le').toString('base64')], { timeout: 6500, windowsHide: true }); }
  catch (_) { /* Never fail a meeting solely because WMI is unavailable. */ }
}

function httpJson(port, endpoint) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: endpoint, timeout: 2500 }, res => {
      let buf = '';
      res.on('data', b => { buf += b; if (buf.length > 150000) req.destroy(new Error('Response too large')); });
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('Browser not responding')));
    req.on('error', reject);
  });
}

class CdpConnection {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch (_) { return; }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message || 'Browser command failed'));
      else entry.resolve(message.result || {});
    });
    ws.on('close', () => this.failAll(new Error('Browser connection closed')));
    ws.on('error', e => this.failAll(e));
  }
  failAll(error) {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
  }
  command(method, params = {}, timeout = 6500) {
    if (this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Browser connection unavailable'));
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' timed out')); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  close() { try { this.ws.close(); } catch (_) {} this.failAll(new Error('Stopped')); }
}
async function connectSocket(url) {
  WebSocket ||= require('ws');
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { handshakeTimeout: 4000, perMessageDeflate: false });
    ws.once('open', () => resolve(new CdpConnection(ws)));
    ws.once('error', reject);
  });
}

// The JS runs inside the REAL Chrome/Edge Meet page. A small DOM state reader
// avoids injecting automation plugins or changing Chromium's identity.
const DOM_STATE = String.raw`(() => {
 const txt = (document.body?.innerText || '').toLowerCase();
 const text = e => [e.getAttribute('aria-label'), e.getAttribute('data-tooltip'), e.innerText].filter(Boolean).join(' ').toLowerCase();
 const visible = e => {const r=e.getBoundingClientRect();return r.width>2&&r.height>2&&getComputedStyle(e).visibility!=='hidden';};
 const buttons = [...document.querySelectorAll('button,[role="button"]')].filter(visible);
 if (${BLOCKED_WORDS.toString()}.test(txt)) return {state:'blocked'};
 if (buttons.some(b => /leave call|leave meeting/.test(text(b))) ||
    (txt.includes('meeting details') && txt.includes('people'))) return {state:'joined'};
 if (/asking to be joined|waiting to be admitted|someone will let you in/.test(txt)) return {state:'waiting'};
 if (/accounts\.google\.com/.test(location.hostname)) return {state:'signin'};
 if (/getting ready|you.ll be able to join/.test(txt)) return {state:'loading'};
 const name = [...document.querySelectorAll('input')].find(i => visible(i) && /name/i.test((i.placeholder||'')+' '+(i.getAttribute('aria-label')||'')));
 if(name && !name.value){ const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set; if(set)set.call(name,${JSON.stringify('Zapper Host')});else name.value='Zapper Host'; name.dispatchEvent(new InputEvent('input',{bubbles:true}));}
 // The camera is always disabled before entering. Never automatically unmute
 // once in the call: respect any manual host mute.
 for(const b of buttons){ const label=text(b); if(/turn off camera|turn off video/.test(label)) b.click(); }
 for(const b of buttons){ const label=text(b); if(/turn on microphone|unmute microphone/.test(label)) b.click(); }
 for(const b of buttons){const label=text(b);if(${JSON.stringify(JOIN_WORDS)}.some(p=>label.includes(p))){const r=b.getBoundingClientRect();return {state:'ready',x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};}}
 if(/sign in/.test(txt)&&!/join now|ask to join/.test(txt))return {state:'signin'};
 return {state:'loading'};
})()`;

class HostBrowserController {
  constructor({ profileDir, onStatus = () => {}, browserPath = findBrowser(), shell = null, spawnBrowser = spawn } = {}) {
    if (!profileDir) throw new Error('Host browser profile directory is required');
    this.profileDir = profileDir;
    this.onStatus = onStatus;
    this.browserPath = browserPath;
    this.shell = shell;
    this.spawnBrowser = spawnBrowser;
    this.child = null;
    this.cdp = null;
    this.browserCdp = null;
    this.timer = null;
    this.currentUrl = '';
    this.generation = 0;
    this.state = '';
    this.startedAt = 0;
    this.lastActionAt = 0;
    this.failedAttempts = 0;
    this.connectionFailures = 0;
    this.joined = false;
    this.stopping = false;
  }
  status(message) { try { this.onStatus(message); } catch (_) {} }
  async stop() {
    this.generation++;
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const page = this.cdp, browser = this.browserCdp, child = this.child;
    this.cdp = null; this.browserCdp = null; this.child = null; this.currentUrl = ''; this.joined = false;
    if (browser) await Promise.race([browser.command('Browser.close').catch(() => {}), sleep(550)]);
    if (page) page.close();
    if (browser) browser.close();
    // Only the process started by THIS Zapper instance is closed. Never use
    // taskkill /IM chrome.exe, which would close unrelated browser windows.
    if (child && child.exitCode == null) { try { child.kill(); } catch (_) {} }
  }
  async start({ meetUrl, name }) {
    if (!MEET.test(String(meetUrl || ''))) throw new Error('Invalid Google Meet URL');
    if (this.currentUrl === meetUrl && !this.stopping) {
      this.status(this.joined ? 'Host meeting is already connected.' : 'Host browser is already opening this room.');
      return true;
    }
    await this.stop();
    this.stopping = false;
    this.currentUrl = meetUrl;
    this.hostName = 'Zapper Host';
    this.hostName = String(name || this.hostName).slice(0, 30);
    const generation = this.generation;
    this.state = ''; this.startedAt = Date.now(); this.lastActionAt = 0; this.failedAttempts = 0;
    if (!this.browserPath) {
      if (!this.shell) throw new Error('Install Google Chrome or Microsoft Edge to join Google Meet.');
      this.status('Supported browser not detected. Opening your default browser; please join Meet manually.');
      await this.shell.openExternal(meetUrl);
      return true;
    }
    const portFile = path.join(this.profileDir, 'DevToolsActivePort');
    fs.mkdirSync(this.profileDir, { recursive: true });
    // Only a stale browser from this dedicated Zapper host profile is eligible.
    stopOrphanHostProfile(this.profileDir);
    try { fs.rmSync(portFile, { force: true }); } catch (_) {}
    this.status('Opening Google Meet in your installed Chrome or Edge…');
    const child = this.spawnBrowser(this.browserPath, [
      '--remote-debugging-port=0', '--user-data-dir=' + this.profileDir,
      '--no-first-run', '--no-default-browser-check', '--new-window', '--app=' + meetUrl,
    ], { stdio: 'ignore', windowsHide: false });
    this.child = child;
    let launchError = null;
    child.on('error', error => { launchError = error; });
    let port = 0;
    const until = Date.now() + CDP_STARTUP_MS;
    while (Date.now() < until && generation === this.generation) {
      if (launchError || child.exitCode !== null) break;
      try {
        const firstLine = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
        port = Number(firstLine);
        if (port > 0 && port <= 65535) break;
      } catch (_) {}
      await sleep(180);
    }
    if (generation !== this.generation) return false;
    if (!port) {
      await this.stop();
      throw new Error(launchError ? 'Could not start Chrome/Edge: ' + launchError.message : 'Chrome/Edge failed to start its host connection. Close its Zapper Host window and try again.');
    }
    let target;
    for (let i = 0; i < 24; i++) {
      if (generation !== this.generation) return false;
      const targets = await httpJson(port, '/json/list').catch(() => []);
      target = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl && (t.url || '').includes('meet.google.com')) ||
        targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
      await sleep(250);
    }
    if (!target) { await this.stop(); throw new Error('Host browser opened, but Meet page could not be controlled.'); }
    try {
      this.cdp = await connectSocket(target.webSocketDebuggerUrl);
      try {
        const info = await httpJson(port, '/json/version');
        if (info.webSocketDebuggerUrl) this.browserCdp = await connectSocket(info.webSocketDebuggerUrl);
      } catch (_) { /* Page CDP works even without browser-level CDP. */ }
      await this.cdp.command('Runtime.enable');
      this.timer = setInterval(() => { void this.tick(generation); }, HEARTBEAT_MS);
      this.status('Meet opened in your supported browser. Sign in here once if Google asks; Zapper will join when ready.');
      void this.tick(generation);
      return true;
    } catch (error) {
      await this.stop();
      throw new Error('Host browser connection failed: ' + error.message);
    }
  }
  async evaluate(expression) {
    if (!this.cdp) return null;
    const result = await this.cdp.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error('Meet page execution failed');
    return result.result?.value;
  }
  async click(x, y) {
    for (const [type, params] of [
      ['mouseMoved', { x, y }], ['mousePressed', { x, y, button: 'left', clickCount: 1 }], ['mouseReleased', { x, y, button: 'left', clickCount: 1 }]
    ]) await this.cdp.command('Input.dispatchMouseEvent', { type, ...params });
  }
  async tick(generation) {
    if (this.stopping || generation !== this.generation || !this.cdp || this._busy) return;
    this._busy = true;
    try {
      const result = await this.evaluate(DOM_STATE.replace('\"Zapper Host\"', JSON.stringify(this.hostName)));
      if (!result || generation !== this.generation) return;
      this.connectionFailures = 0;
      if (result.state !== this.state) {
        this.state = result.state;
        if (result.state === 'joined') { this.joined = true; this.status('Host has joined Google Meet. You may minimize the host browser window.'); }
        else if (result.state === 'signin') this.status('Please sign in to Google in the host Chrome/Edge window (first time only).');
        else if (result.state === 'waiting') this.status('Host is waiting for admission to the meeting.');
        else if (result.state === 'blocked') this.status('Google Meet rejected this room. Check the Meet link and your Google account.');
      }
      if (result.state === 'joined' || result.state === 'signin' || result.state === 'waiting') return;
      if (result.state === 'ready') {
        if (Date.now() - this.lastActionAt < 5000) return;
        this.lastActionAt = Date.now();
        this.status('Joining Google Meet as host…');
        await this.click(result.x, result.y);
      } else if (result.state === 'blocked') {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
      } else if (Date.now() - this.startedAt > JOIN_TIMEOUT_MS) {
        if (this.failedAttempts++ < 1) {
          this.startedAt = Date.now();
          this.status('Meet is still preparing. Reloading this room once…');
          await this.cdp.command('Page.navigate', { url: this.currentUrl }).catch(() => {});
        } else {
          this.status('Host could not join automatically. Use the visible Chrome/Edge window to sign in or click Join; Zapper will not retry endlessly.');
          clearInterval(this.timer); this.timer = null;
        }
      }
    } catch (error) {
      if (!this.stopping && generation === this.generation && ++this.connectionFailures >= 3) {
        this.status('Meet browser closed or disconnected. Reopen the host meeting from Zapper to reconnect.');
        clearInterval(this.timer); this.timer = null;
      }
    } finally { this._busy = false; }
  }
  async setMic(on) {
    if (!this.cdp || this.stopping) return false;
    const want = on ? 'turn on microphone|unmute microphone' : 'turn off microphone|mute microphone';
    const expr = `(() => {const buttons=[...document.querySelectorAll('button,[role="button"]')];const b=buttons.find(e=>new RegExp(${JSON.stringify(want)},'i').test((e.getAttribute('aria-label')||'')+' '+(e.getAttribute('data-tooltip')||''))); if(!b)return false;b.click();return true;})()`;
    return Boolean(await this.evaluate(expr).catch(() => false));
  }
  async show() {
    // Chrome app windows are user-owned windows. Avoid invisible/opacity hacks:
    // focus is best-effort, and the user can use the Windows taskbar.
    if (!this.cdp) return false;
    await this.cdp.command('Page.bringToFront').catch(() => {});
    return true;
  }
}

module.exports = { HostBrowserController, findBrowser, browserCandidates, stopOrphanHostProfile, MEET, JOIN_TIMEOUT_MS };
