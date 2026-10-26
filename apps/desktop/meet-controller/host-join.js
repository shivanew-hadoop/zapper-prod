// meet-controller/host-join.js — Host mode.
// Launched by the web portal through zapper://host-join?meet=<link>&name=<name> right after
// Create Session. Joins the freshly created Google Meet AS THE HOST: camera OFF, microphone ON,
// clicks Join automatically and keeps the window open so the host's voice is in the meeting.
// Participants then join with the PIN and the existing caption pipeline does the rest.
// This never sends microphone audio to Zapper servers or to Deepgram: the audio goes only to Meet.
const { BrowserWindow, screen, session, systemPreferences } = require('electron');

const HOST_PARTITION = 'persist:zapper-host-meet'; // separate from the participant profile
const MEET_URL = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

let hostWindow = null;
let hostTimer = null;

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
  return { meetUrl, name: sanitizeName(parsed.searchParams.get('name')) };
}

// zapper://host-mic?state=on|off and zapper://host-leave — the web portal's Mute button and
// End Session control the host's Meet window through these.
function parseHostControlUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl || '')); } catch (_) { return null; }
  if (parsed.protocol !== 'zapper:') return null;
  const host = parsed.hostname.toLowerCase();
  if (host === 'host-leave') return { type: 'leave' };
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
    window.__zapperHostEnforce = (window.__zapperHostEnforce || 0) + 1;
    if (window.__zapperHostEnforce <= 3) enforceDevices();
    return { state: 'joined', ticks: window.__zapperHostEnforce };
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

// Google's sign-in offers "Choose a passkey" (Windows Hello / security key) and then waits for it
// forever inside this embedded window. Hide passkey support from the page so Google falls back to
// the normal email + password sign-in. Host window only.
function disablePasskeys(win) {
  const script = `(() => {
    try { delete window.PublicKeyCredential; } catch (_) {}
    try { window.PublicKeyCredential = undefined; } catch (_) {}
    try {
      const reject = () => Promise.reject(new DOMException('Passkeys are not available here.', 'NotAllowedError'));
      Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get: reject, create: reject, store: reject, preventSilentAccess: () => Promise.resolve() } });
    } catch (_) {}
  })();`;
  try {
    const dbg = win.webContents.debugger;
    dbg.attach('1.3');
    dbg.sendCommand('Page.enable').catch(() => {});
    dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: script }).catch(() => {});
  } catch (_) {
    win.webContents.on('did-start-navigation', () => { win.webContents.executeJavaScript(script, true).catch(() => {}); });
  }
}

function stopHostTimer() {
  if (hostTimer) clearInterval(hostTimer);
  hostTimer = null;
}

async function joinAsHost({ meetUrl, name }, onStatus = () => {}, internal = {}) {
  if (!MEET_URL.test(String(meetUrl || ''))) throw new Error('Invalid Google Meet link.');
  const say = msg => { try { onStatus(msg); } catch (_) {} };

  if (hostWindow && !hostWindow.isDestroyed()) {
    // Already hosting this room? Just bring it forward; otherwise replace it.
    if (hostWindow.__zapperMeetUrl === meetUrl && !internal.fresh) return true; // already hosting it (stays hidden)
    stopHostTimer();
    try { hostWindow.destroy(); } catch (_) {}
    hostWindow = null;
  }

  if (process.platform === 'darwin' && systemPreferences?.askForMediaAccess) {
    await systemPreferences.askForMediaAccess('microphone').catch(() => {});
  }
  allowMediaForHostSession();

  const display = screen.getPrimaryDisplay();
  const width = 520, height = 400;
  const win = new BrowserWindow({
    width, height,
    x: display.workArea.x + display.workArea.width - width - 12,
    y: display.workArea.y + display.workArea.height - height - 12,
    show: false,
    skipTaskbar: true,
    title: 'Zapper Host — Google Meet',
    autoHideMenuBar: true,
    backgroundColor: '#202124',
    webPreferences: {
      partition: HOST_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.webContents.setUserAgent(USER_AGENT, 'en-IN,en;q=0.9');
  win.__zapperMeetUrl = meetUrl;
  // Joining happens out of sight: the window is rendered but see-through, with no taskbar button.
  // (Meet needs a rendered window to finish "Getting ready".) Only the one-time Google sign-in
  // makes it visible.
  win.setOpacity(0.01);
  win.setContentProtection(true);
  win.__zapperHidden = true;
  disablePasskeys(win);
  win.showInactive();
  hostWindow = win;
  win.on('closed', () => {
    if (hostWindow === win) { hostWindow = null; stopHostTimer(); stopHostChatWatcher(); }
  });

  // Google refuses anonymous guests ("You can't join this video call"), so the host window
  // is signed in ONCE and remembered (persistent profile). First launch goes straight to the
  // Google sign-in page and returns to the Meet by itself; every later launch is already signed in.
  let askedSignIn = false;
  if (await hostSignedIn()) {
    say('Host mode: opening your Google Meet…');
    await win.loadURL(meetUrl, { userAgent: USER_AGENT }).catch(() => {});
  } else {
    askedSignIn = true;
    showHostWindow(win);
    say('Host mode: sign in to Google once in the Zapper Host window. It is remembered afterwards.');
    await win.loadURL('https://accounts.google.com/ServiceLogin?continue=' + encodeURIComponent(meetUrl), { userAgent: USER_AGENT }).catch(() => {});
  }

  let busy = false;
  let lastClickAt = 0;
  let joinedTicks = 0;
  let lastNavAt = Date.now();
  let lastSignInPromptAt = 0;
  let lastProgressAt = Date.now();
  let lastState = '';
  let reloads = 0;
  const roomCode = meetUrl.split('/').pop();
  // "You can't join this video call": close this window and start again with a brand-new one.
  let restarting = false;
  const restartFresh = () => {
    if (restarting) return;
    restarting = true;
    const attempt = (internal.restarts || 0) + 1;
    stopHostTimer();
    if (hostWindow === win) hostWindow = null;
    try { win.destroy(); } catch (_) {}
    setTimeout(() => {
      joinAsHost({ meetUrl, name }, onStatus, { fresh: true, restarts: attempt }).catch(() => {});
    }, 400);
  };
  const reopenRoom = async () => {
    if (win.isDestroyed() || Date.now() - lastNavAt < 1500) return; // retry almost immediately
    lastNavAt = Date.now();
    reloads += 1;
    await win.loadURL(meetUrl, { userAgent: USER_AGENT }).catch(() => {});
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
      // Signed in (or never needed sign-in): everything after this happens out of sight.
      if (!win.__zapperHidden && !win.__zapperUserShown) concealHostWindow(win);

      const result = await win.webContents.executeJavaScript(`(${hostAutomation.toString()})(${JSON.stringify(sanitizeName(name))})`, true);
      if (result.state !== lastState) { lastState = result.state; lastProgressAt = Date.now(); }

      if (result.state === 'joined') {
        joinedTicks += 1;
        if (joinedTicks === 1) say('Host mode: you are in the meeting with your microphone on and camera off.');
        if (joinedTicks > 4) { stopHostTimer(); startHostChatWatcher(win, say); hideHostWindow(win); }
      } else if (result.state === 'ready') {
        if (Date.now() - lastClickAt > 4000) {
          lastClickAt = Date.now();
          say('Host mode: joining the meeting…');
          await nativeClick(win, result.x, result.y);
        }
      } else if (result.state === 'waiting') {
        say('Host mode: waiting to be admitted to the meeting…');
      } else if (result.state === 'cant_join' || result.state === 'signin_required') {
        const signedIn = await hostSignedIn();
        if (!signedIn) {
          // Google will not let an anonymous guest in: sign in ONCE in this window.
          if (!askedSignIn || Date.now() - lastSignInPromptAt > 20000) {
            askedSignIn = true;
            lastSignInPromptAt = Date.now();
            showHostWindow(win);
            say('Host mode: sign in to Google in the Zapper Host window (one time). It continues automatically afterwards.');
            await win.loadURL('https://accounts.google.com/ServiceLogin?continue=' + encodeURIComponent(meetUrl), { userAgent: USER_AGENT }).catch(() => {});
          }
        } else if (result.state === 'cant_join' && (internal.restarts || 0) < 60) {
          // Signed in but Meet still bounced us: throw this window away and try again with a new one.
          restartFresh();
          return;
        } else if (reloads < 80) {
          await reopenRoom();
        }
      } else if (Date.now() - lastProgressAt > 30000 && reloads < 6) {
        // Stuck on the pre-join page for 30 s: reload the room and try again.
        lastProgressAt = Date.now();
        await reopenRoom();
      }
    } catch (error) {
      console.error('[HostJoin]', error.message);
    } finally {
      busy = false;
    }
  }, 1000);
  return true;
}

// The host stays in the meeting with the window completely out of sight (see-through, click-through,
// no taskbar button). Press Ctrl+Shift+H to bring it up, for example to read or send chat.
function concealHostWindow(win) {
  try {
    if (!win || win.isDestroyed()) return;
    win.__zapperHidden = true;
    win.setContentProtection(true);
    win.setSkipTaskbar(true);
    win.setOpacity(0.01);
  } catch (_) {}
}

function hideHostWindow(win) {
  try {
    if (!win || win.isDestroyed()) return;
    concealHostWindow(win);
    win.setIgnoreMouseEvents(true, { forward: true });
  } catch (_) {}
}

function showHostWindow(win) {
  try {
    if (!win || win.isDestroyed()) return;
    win.__zapperHidden = false;
    win.setIgnoreMouseEvents(false);
    win.setContentProtection(false);
    win.setOpacity(1);
    win.setSkipTaskbar(false);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.flashFrame(false);
  } catch (_) {}
}

async function hostSignedIn() {
  try {
    const ses = session.fromPartition(HOST_PARTITION);
    const cookies = await ses.cookies.get({ name: 'SAPISID' });
    // Write the sign-in to disk now so the next launch is already signed in.
    if (cookies.length) ses.cookies.flushStore().catch(() => {});
    return cookies.length > 0;
  } catch (_) { return false; }
}

function toggleHostWindow() {
  const win = hostWindow;
  if (!win || win.isDestroyed()) return false;
  if (win.__zapperHidden) { win.__zapperUserShown = true; showHostWindow(win); }
  else { win.__zapperUserShown = false; hideHostWindow(win); }
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

// After joining: open the chat panel once so it is ready when the host restores the window,
// and flash the taskbar button when a new chat message arrives from a participant.
let hostChatTimer = null;
function stopHostChatWatcher() {
  if (hostChatTimer) clearInterval(hostChatTimer);
  hostChatTimer = null;
}
function startHostChatWatcher(win, say) {
  stopHostChatWatcher();
  let lastCount = -1;
  let openedChat = false;
  hostChatTimer = setInterval(async () => {
    if (!win || win.isDestroyed()) { stopHostChatWatcher(); return; }
    try {
      const info = await win.webContents.executeJavaScript(`(() => {
        const count = document.querySelectorAll('[data-message-id]').length;
        const chatBtn = [...document.querySelectorAll('button, div[role="button"]')].find(b =>
          /chat with everyone|in-call messages/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('data-tooltip') || '')));
        const open = !!chatBtn && (chatBtn.getAttribute('aria-pressed') === 'true' || chatBtn.getAttribute('aria-expanded') === 'true');
        return { count, hasChatButton: !!chatBtn, open };
      })()`, true);
      if (info.hasChatButton && !info.open && !openedChat) {
        openedChat = true;
        await win.webContents.executeJavaScript(`(() => {
          const b = [...document.querySelectorAll('button, div[role="button"]')].find(b =>
            /chat with everyone|in-call messages/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('data-tooltip') || '')));
          if (b) b.click();
        })()`, true).catch(() => {});
      }
      if (lastCount >= 0 && info.count > lastCount && win.__zapperHidden) {
        say('Host mode: new chat message in your Meet window (press Ctrl+Shift+H to read and reply).');
      }
      lastCount = info.count;
    } catch (_) {}
  }, 2000);
}

function leaveHost() {
  stopHostChatWatcher();
  stopHostTimer();
  const win = hostWindow;
  hostWindow = null;
  try { if (win && !win.isDestroyed()) win.destroy(); } catch (_) {}
}

function isHostActive() { return Boolean(hostWindow && !hostWindow.isDestroyed()); }

module.exports = { isHostActive, joinAsHost, leaveHost, setHostMic, toggleHostWindow, parseHostControlUrl, parseHostJoinUrl, hostAutomation, sanitizeName, MEET_URL };
