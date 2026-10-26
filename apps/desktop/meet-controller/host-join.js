// meet-controller/host-join.js — Host mode.
// Launched by the web portal through zapper://host-join?meet=<link>&name=<name> right after
// Create Session. Joins the freshly created Google Meet AS THE HOST: camera OFF, microphone ON,
// clicks Join automatically and keeps the window open so the host's voice is in the meeting.
// Participants then join with the PIN and the existing caption pipeline does the rest.
// This never sends microphone audio to Zapper servers or to Deepgram: the audio goes only to Meet.
const { BrowserWindow, screen, session, systemPreferences } = require('electron');
const path = require('path');
const { getMeetUserAgent } = require('./browser-compat');

const HOST_PARTITION = 'persist:zapper-host-meet'; // separate from the participant profile
const MEET_URL = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

let hostWindow = null;
let hostTimer = null;
let hostSelectedMicrophone = '';
let hostJoined = false;
let hostOpening = null;

function sanitizeName(value) {
  const name = String(value || '').replace(/[^\p{L}\p{N} ._'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 30);
  return name || 'Host';
}

function parseHostJoinUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl || '')); } catch (_) { return null; }
  if (parsed.protocol !== 'zapper:' || parsed.hostname.toLowerCase() !== 'host-join') return null;
  const meetUrl = String(parsed.searchParams.get('meet') || '').trim().toLowerCase();
  if (!MEET_URL.test(meetUrl)) return null; // never open anything but a Meet room link
  const token = String(parsed.searchParams.get('captureToken') || '');
  const microphone = String(parsed.searchParams.get('mic') || '').trim().slice(0, 250);
  return { meetUrl, name: sanitizeName(parsed.searchParams.get('name')),
    ...(token && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? { captureToken: token } : {}),
    ...(microphone ? { microphone } : {}) };
}

// zapper://host-mic?state=on|off and zapper://host-leave — the web portal's Mute button and
// End Session control the host's Meet window through these.
function parseHostControlUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl || '')); } catch (_) { return null; }
  if (parsed.protocol !== 'zapper:') return null;
  const host = parsed.hostname.toLowerCase();
  if (host === 'host-leave') return { type: 'leave' };
  if (host === 'host-device') return { type: 'device', microphone: String(parsed.searchParams.get('mic') || '').trim().slice(0, 250) };
  if (host === 'host-mic') {
    const state = String(parsed.searchParams.get('state') || '').toLowerCase();
    if (state === 'on' || state === 'off') return { type: 'mic', on: state === 'on' };
  }
  return null;
}

// Runs INSIDE the Meet page. Pre-join: fills the name for guests, turns the camera off,
// turns the microphone on, and reports the Join button position. After joining it makes
// sure (a few times only) that the microphone is on, so a manual mute is never fought.
async function hostAutomation(hostName) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const visible = el => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const labelOf = el => [el.getAttribute('aria-label'), el.getAttribute('data-tooltip'), el.innerText]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const buttons = () => [...document.querySelectorAll('button, div[role="button"], span[role="button"], a[role="button"]')].filter(visible);
  const CAMERA_ON = /turn off camera|turn off video/;
  const MIC_OFF = /turn on microphone|unmute microphone/;
  const bodyText = () => (document.body && document.body.innerText || '').toLowerCase();

  function enforceDevices() {
    let changed = false;
    for (const b of buttons()) {
      const l = labelOf(b);
      if (CAMERA_ON.test(l) || MIC_OFF.test(l)) { try { b.click(); changed = true; } catch (_) {} }
    }
    return changed;
  }

  // In the meeting already?
  if (document.querySelector('[aria-label*="Leave call" i]')) {
    // Once joined, never override the host's manual mute/unmute choice.
    return { state: 'joined' };
  }

  // Dismiss informational dialogs; accept Meet's own "use microphone" prompt (never "without").
  for (const b of buttons()) {
    const l = labelOf(b);
    if (/^(got it|dismiss|understood)$/.test(l) || /^(use microphone|allow microphone)/.test(l)) { try { b.click(); } catch (_) {} }
  }

  // Guest name field.
  const input = [...document.querySelectorAll('input[type="text"], input:not([type])')]
    .filter(visible).find(i => /name/i.test((i.placeholder || '') + ' ' + (i.getAttribute('aria-label') || '')));
  if (input && !input.value) {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, hostName); else input.value = hostName;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: hostName }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(150);
  }

  if (enforceDevices()) await sleep(450);

  const text = bodyText();
  // Google refused / bounced an anonymous guest ("You can't join this video call",
  // "Returning to home screen"): the desktop side signs in or reloads the room.
  if (/this browser version is no longer supported|upgrade to a supported browser|your browser isn.t supported|unsupported browser/.test(text)) return { state: 'browser_unsupported' };
  if (/returning to (the )?home screen|you can.t join this video call|check your meeting code/.test(text)) return { state: 'cant_join' };
  if (/getting ready|you.ll be able to join/.test(text)) return { state: 'getting_ready' };
  if (/asking to be joined|waiting to be admitted|someone will let you in|you.ll join when someone lets you in/.test(text)) return { state: 'waiting' };

  // Do not join until the camera is off and the microphone is on.
  const stillWrong = buttons().some(b => CAMERA_ON.test(labelOf(b)) || MIC_OFF.test(labelOf(b)));
  if (stillWrong) return { state: 'preparing' };

  const PATTERNS = ['join now', 'ask to join', 'request to join', 'join meeting', 'join this call', 'join call', 'switch here', 'join here'];
  for (const b of buttons()) {
    if (b.disabled || b.getAttribute('aria-disabled') === 'true') continue;
    const l = labelOf(b);
    if (PATTERNS.some(p => l.includes(p))) {
      try { b.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
      const r = b.getBoundingClientRect();
      return { state: 'ready', text: l, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }
  }
  if (/sign in/.test(text) && !/join/.test(text)) return { state: 'signin_required' };
  return { state: 'searching' };
}

function allowMediaForHostSession() {
  const ses = session.fromPartition(HOST_PARTITION);
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'microphone', 'camera', 'notifications'].includes(permission));
  });
  try { ses.setPermissionCheckHandler((_wc, permission) => ['media', 'microphone', 'camera', 'notifications'].includes(permission)); } catch (_) {}
  return ses;
}

async function nativeClick(win, x, y) {
  const wc = win.webContents;
  try { wc.focus(); } catch (_) {}
  await new Promise(r => setTimeout(r, 200));
  wc.sendInputEvent({ type: 'mouseMove', x, y });
  await new Promise(r => setTimeout(r, 80));
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, 110));
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}

function stopHostTimer() {
  if (hostTimer) clearInterval(hostTimer);
  hostTimer = null;
}

async function joinAsHost({ meetUrl, name, microphone = '' }, onStatus = () => {}) {
  if (!MEET_URL.test(String(meetUrl || ''))) throw new Error('Invalid Google Meet link.');
  const say = msg => { try { onStatus(msg); } catch (_) {} };

  if (hostWindow && !hostWindow.isDestroyed()) {
    // Already hosting this room? Just bring it forward; otherwise replace it.
    if (hostWindow.__zapperMeetUrl === meetUrl) {
      if (microphone) await selectHostMicrophone(microphone);
      if (hostOpening) await hostOpening.catch(() => {});
      if (hostJoined) say('Host mode: joined and verified.');
      else showHostWindow(hostWindow); // Do not claim joined while still on prejoin.
      return true;
    }
    stopHostTimer();
    try { hostWindow.destroy(); } catch (_) {}
    hostWindow = null;
  }

  if (process.platform === 'darwin' && systemPreferences?.askForMediaAccess) {
    await systemPreferences.askForMediaAccess('microphone').catch(() => {});
  }
  const hostSession = allowMediaForHostSession();
  const meetUserAgent = getMeetUserAgent(hostSession.getUserAgent());
  hostJoined = false;
  hostSelectedMicrophone = String(microphone || '').trim();

  const display = screen.getPrimaryDisplay();
  const width = 520, height = 400;
  const win = new BrowserWindow({
    width, height,
    x: display.workArea.x + display.workArea.width - width - 12,
    y: display.workArea.y + display.workArea.height - height - 12,
    show: true,
    title: 'Zapper Host — Google Meet',
    autoHideMenuBar: true,
    backgroundColor: '#202124',
    webPreferences: {
      partition: HOST_PARTITION,
      preload: path.join(__dirname, 'host-preload.js'),
      additionalArguments: ['--zapper-host-mode', '--zapper-host-mic=' + encodeURIComponent(hostSelectedMicrophone)],
      contextIsolation: false, // Meet preload patches getUserMedia before Meet startup
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) say('Host mode: Meet navigation failed (' + code + '): ' + String(description).slice(0, 120));
  });
  win.webContents.on('render-process-gone', () => {
    say('Host mode: browser process stopped unexpectedly. Reopen the session to retry.');
    stopHostTimer();
    showHostWindow(win);
  });
  win.__zapperMeetUrl = meetUrl;
  hostWindow = win;
  win.on('closed', () => {
    if (hostWindow === win) { hostWindow = null; hostJoined = false; stopHostTimer(); }
  });

  say('Host mode: opening your Google Meet…');
  hostOpening = win.loadURL(meetUrl, { userAgent: meetUserAgent });
  try { await hostOpening; }
  catch (error) {
    // A failed navigation must not leave a phantom host meeting. A later
    // Create Session / retry must be allowed to create a fresh window.
    if (hostWindow === win) { hostWindow = null; hostJoined = false; }
    try { if (!win.isDestroyed()) win.destroy(); } catch (_) {}
    throw error;
  } finally { hostOpening = null; }

  let busy = false;
  let lastClickAt = 0;
  const earliestFirstJoinAt = Date.now() + 2500; // let a newly created Meet room become available
  let joinedTicks = 0;
  let askedSignIn = false;
  let lastNavAt = Date.now();
  let lastProgressAt = Date.now();
  let lastState = '';
  let reloads = 0;
  let failedAttempts = 0;
  let readyReloads = 0;
  const roomCode = meetUrl.split('/').pop();
  const reopenRoom = async () => {
    if (win.isDestroyed() || Date.now() - lastNavAt < 5000) return;
    lastNavAt = Date.now();
    reloads += 1;
    await win.loadURL(meetUrl, { userAgent: meetUserAgent }).catch(() => {});
  };
  stopHostTimer();
  hostTimer = setInterval(async () => {
    if (busy || win.isDestroyed()) return;
    busy = true;
    try {
      const currentUrl = win.webContents.getURL() || '';
      const onGoogleSignIn = /^https:\/\/accounts\.google\.com\//.test(currentUrl);
      const onRoom = currentUrl.includes(roomCode);
      // Bounced to the Meet home / landing page (e.g. "Returning to home screen"): go back.
      if (!onGoogleSignIn && !onRoom && /^https:\/\/meet\.google\.com\//.test(currentUrl)) { await reopenRoom(); return; }
      // Signed in through Google (one-time): return to the room afterwards.
      if (!onGoogleSignIn && !onRoom && /^https:\/\/(myaccount|www)\.google\.com\//.test(currentUrl)) { await reopenRoom(); return; }
      if (onGoogleSignIn) { lastProgressAt = Date.now(); return; } // let the host sign in undisturbed

      const result = await win.webContents.executeJavaScript(`(${hostAutomation.toString()})(${JSON.stringify(sanitizeName(name))})`, true);
      if (result.state !== lastState) { lastState = result.state; lastProgressAt = Date.now(); }
      if (result.state === 'browser_unsupported') {
        say('Host mode: Google Meet rejected this browser. Rebuild/reinstall Zapper with the updated Electron runtime.');
        stopHostTimer();
        showHostWindow(win);
        return;
      }
      if (result.state === 'joined') {
        failedAttempts = 0;
        if (!hostJoined) { hostJoined = true; say('Host mode: joined and verified.'); }
      }

      if (result.state === 'joined') {
        joinedTicks += 1;
        if (joinedTicks === 1) say('Host mode: Google Meet joined successfully.');
        if (joinedTicks > 4) { stopHostTimer(); hideHostWindow(win); }
      } else if (result.state === 'ready') {
        if (Date.now() >= earliestFirstJoinAt && Date.now() - lastClickAt > 4000) {
          lastClickAt = Date.now();
          say('Host mode: joining the meeting…');
          await nativeClick(win, result.x, result.y);
        }
      } else if (result.state === 'waiting') {
        say('Host mode: waiting to be admitted to the meeting…');
      } else if (result.state === 'cant_join' || result.state === 'signin_required') {
        // A brand-new Google-generated Meet room can briefly reject the first
        // anonymous request. Never treat that transient bounce as a Google
        // sign-in failure on the very first attempt.
        if (result.state === 'cant_join' && failedAttempts < 3) {
          if (Date.now() - lastNavAt >= 6000) {
            failedAttempts++;
            say('Host mode: new Meet room not ready; retrying (' + failedAttempts + '/3 initial attempts)…');
            await reopenRoom();
          }
        } else {
          const signedIn = await hostSignedIn();
          if (!signedIn && !askedSignIn) {
            askedSignIn = true;
            showHostWindow(win);
            say('Host mode: Google sign-in required. If Google blocks embedded sign-in, open Meet in a regular Chrome browser; Electron sign-in may be disallowed.');
            await win.loadURL('https://accounts.google.com/ServiceLogin?continue=' + encodeURIComponent(meetUrl)).catch(() => {});
          } else if (Date.now() - lastNavAt >= 6000) {
            failedAttempts++;
            if (failedAttempts <= 9) {
              say('Host mode: Meet rejected the join; retrying (' + failedAttempts + '/9)…');
              await reopenRoom();
            } else {
              say('Host mode: Meet still refuses the call. Open the host window (Ctrl+Shift+H) to see the Google Meet message.');
              stopHostTimer();
              showHostWindow(win);
            }
          }
        }
      } else if (result.state === 'getting_ready' && Date.now() - lastProgressAt > 18000) {
        // Explicit cap: a permanently spinning Meet page must not loop forever.
        if (readyReloads < 3) {
          readyReloads += 1;
          say('Host mode: Meet is stuck on Getting ready; reloading (' + readyReloads + '/3)…');
          lastProgressAt = Date.now();
          await reopenRoom();
        } else {
          say('Host mode: Meet could not finish loading. Check the visible window and Google sign-in; automatic retries stopped.');
          stopHostTimer();
          showHostWindow(win);
        }
      } else if (Date.now() - lastProgressAt > 30000) {
        if (reloads >= 6) {
          say('Host mode: Meet did not complete joining after six reloads. Automatic retries stopped.');
          stopHostTimer();
          showHostWindow(win);
        } else {
          lastProgressAt = Date.now();
          await reopenRoom();
        }
      }
    } catch (error) {
      console.error('[HostJoin]', error.message);
    } finally {
      busy = false;
    }
  }, 1500);
  return true;
}

// The host stays in the meeting but the window is kept out of the way (same technique as
// the participant Meet window): nearly invisible and click-through. Ctrl+Shift+H shows it.
function hideHostWindow(win) {
  try {
    if (!win || win.isDestroyed()) return;
    win.__zapperHidden = true;
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setOpacity(0.01);
    win.setSkipTaskbar(true);
    win.setAlwaysOnTop(false);
  } catch (_) {}
}

function showHostWindow(win) {
  try {
    if (!win || win.isDestroyed()) return;
    win.__zapperHidden = false;
    win.setIgnoreMouseEvents(false);
    win.setOpacity(1);
    win.setSkipTaskbar(false);
    win.show();
    win.focus();
  } catch (_) {}
}

async function hostSignedIn() {
  try {
    const cookies = await session.fromPartition(HOST_PARTITION).cookies.get({ name: 'SAPISID' });
    return cookies.length > 0;
  } catch (_) { return false; }
}

function toggleHostWindow() {
  const win = hostWindow;
  if (!win || win.isDestroyed()) return false;
  if (win.__zapperHidden) {
    win.__zapperHidden = false;
    win.setIgnoreMouseEvents(false);
    win.setOpacity(1);
    win.setSkipTaskbar(false);
    win.show();
    win.focus();
  } else {
    hideHostWindow(win);
  }
  return true;
}

// Mute / unmute the host's microphone in the Meet call.
async function setHostMic(on) {
  const win = hostWindow;
  if (!win || win.isDestroyed()) return false;
  const want = on ? 'turn on microphone' : 'turn off microphone';
  return await win.webContents.executeJavaScript(`(() => {
    const btn = [...document.querySelectorAll('button, div[role="button"]')].find(b =>
      ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('data-tooltip') || '')).toLowerCase().includes(${JSON.stringify(want)}));
    if (!btn) return false;
    btn.click();
    return true;
  })()`, true).catch(() => false);
}

async function selectHostMicrophone(label) {
  hostSelectedMicrophone = String(label || '').trim().slice(0, 250);
  if (!hostWindow || hostWindow.isDestroyed()) return false;
  hostWindow.webContents.send('host-mic-device', hostSelectedMicrophone);
  return true; // confirmation is issued by preload after replacement or on capture
}
function isHostWebContents(webContents) {
  return Boolean(hostWindow && !hostWindow.isDestroyed() && hostWindow.webContents === webContents);
}
function getHostWindow() { return hostWindow && !hostWindow.isDestroyed() ? hostWindow : null; }
function isHostMeetingActive() { return hostJoined && Boolean(hostWindow && !hostWindow.isDestroyed()); }
function leaveHost() {
  stopHostTimer();
  hostJoined = false;
  const win = hostWindow;
  hostWindow = null;
  try { if (win && !win.isDestroyed()) win.destroy(); } catch (_) {}
}

module.exports = { joinAsHost, leaveHost, setHostMic, selectHostMicrophone, isHostWebContents, isHostMeetingActive, getHostWindow, toggleHostWindow, parseHostControlUrl, parseHostJoinUrl, hostAutomation, sanitizeName, MEET_URL };
