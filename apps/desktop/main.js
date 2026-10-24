// main.js — Electron main process
const { app, BrowserWindow, ipcMain, screen, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_BACKEND_URL = 'https://api.zapperapp.in';
let APP_CONFIG = {};
try { APP_CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'app-config.json'), 'utf8')); } catch (_) {}
const BACKEND_URL = String(APP_CONFIG.backendUrl || DEFAULT_BACKEND_URL).trim().replace(/\/+$/, '');
const DEFAULT_DOWNLOAD_URL = 'https://github.com/shivanew-hadoop/zapper-downloads/releases/latest/download/Zapper-Setup-x64.exe';
const DOWNLOAD_URL = String(APP_CONFIG.downloadUrl || DEFAULT_DOWNLOAD_URL).trim();

// Permanent app data folder. Keep this value unchanged so Google cookies/session persist
// across app restarts, packaging, and future builds on the same machine.
app.setPath('userData', path.join(app.getPath('appData'), 'ZapperPlatformProfile'));

// Per-installation ID is used only to avoid counting a rejoined desktop twice
// against the four Zapper PIN slots in Google-created meetings. It is not an
// account credential and does not alter Google cookies or sign-in behavior.
function installationDeviceId() {
  const folder = app.getPath('userData');
  const file = path.join(folder, 'zapper-install-device-id');
  try {
    const stored = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stored)) return stored;
  } catch (_) {}
  const created = crypto.randomUUID();
  try { fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(file, created, { flag: 'wx', mode: 0o600 }); }
  catch (_) {
    try { return fs.readFileSync(file, 'utf8').trim() || created; } catch (_) {}
  }
  return created;
}
const ZAPPER_DEVICE_ID = installationDeviceId();

// Makes Task Manager/app metadata show the product name after packaged install.
app.setName('Zapper');

// Browser portal launch target. The portal can call zapper://launch; the app simply
// opens/focuses the protected overlay, then Google Sign-In + PIN remain the gates.
if (process.defaultApp) {
  if (process.argv.length >= 2) app.setAsDefaultProtocolClient('zapper', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('zapper');
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.show();
      overlayWindow.focus();
      enforceOverlayPrivacyAndTopmost();
    }
  });
}

const { startAudioWSServer, onAudioChunk, stopAudioWSServer } = require('./audio-ws/server');
const {
  joinMeet,
  leaveMeet,
  toggleMeetDebug,
  openGoogleSignIn,
  closeGoogleSignInWindow,
  clearGoogleProfile,
  isGoogleLoggedIn,
  sendMeetChatToMeeting,
  getGoogleAccountEmail
} = require('./meet-controller/index');

const {
  startRemoteTranscriptStream,
  sendAudioChunk,
  sendLocalCaption,
  stopRemoteTranscriptStream
} = require('./transcriber/remoteDeepgram');

app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'IsolateOrigins,site-per-process');

let overlayWindow = null;
let privateCursorWindow = null;
let started = false;
let remoteSttStarted = false;
let audioRelayStarted = false;
let transcriptLimitReached = false;
let overlayTopmostGuard = null;
let overlayPointerGuard = null;
let overlayResizeGuard = null;
let overlayResizeState = null;
let sessionStatusPoller = null;
let forceExitScheduled = false;
let activeCaptureSessionId = '';
let activeCaptureSessionToken = '';
let activeCaptureGoogleEmail = '';
let captureStopInProgress = false;
let localCaptionReady = false;
let localCaptionAdmitted = false;
let localCaptionLastAt = 0;
let localCaptionLastText = '';
let localCaptionLastWasFinal = false;
let deepgramFallbackActive = false;
let captionFallbackTimer = null;
let audibleWithoutCaptionSince = 0;

// TEMPORARY DIAGNOSTIC BUILD: prove Google Meet DOM captions end-to-end.
// While true, Zapper never activates Deepgram fallback and never sends Meet PCM
// audio to the backend. The existing /stt socket remains open only so validated
// local captions can still be persisted to the host PDF / relayed to the session.
const GOOGLE_CAPTIONS_ONLY_TEST = false;
let meetOnlyFallbackNoticeSent = false;


// Keep the overlay private from supported OS capture APIs and continuously
// reinforce its top-most z-order without stealing keyboard focus.
function enforceOverlayPrivacyAndTopmost() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  try { overlayWindow.setContentProtection(true); } catch (_) {}
  try { overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1); } catch (_) {}
  try { overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {}
  try { if (overlayWindow.isVisible()) overlayWindow.moveTop(); } catch (_) {}
}

function startOverlayTopmostGuard() {
  if (overlayTopmostGuard) clearInterval(overlayTopmostGuard);
  // Z-order protection is independent of STT/audio and does not steal focus.
  // Reassert frequently so ordinary Windows/app focus changes cannot bury Zapper.
  overlayTopmostGuard = setInterval(enforceOverlayPrivacyAndTopmost, 250);
  overlayTopmostGuard.unref?.();
}

function stopOverlayTopmostGuard() {
  if (!overlayTopmostGuard) return;
  clearInterval(overlayTopmostGuard);
  overlayTopmostGuard = null;
}

function createPrivateCursorWindow() {
  if (privateCursorWindow && !privateCursorWindow.isDestroyed()) return privateCursorWindow;

  privateCursorWindow = new BrowserWindow({
    width: 30,
    height: 40,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const cursorMarkup = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;cursor:none!important;user-select:none}
    svg{display:block;width:24px;height:32px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.65))}
  </style></head><body><svg viewBox="0 0 24 32" aria-hidden="true">
    <path d="M2 1.5V25.5L8.2 19.8L12.8 30.2L17 28.3L12.4 18H21.4L2 1.5Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/>
  </svg></body></html>`;

  privateCursorWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(cursorMarkup)}`);
  try { privateCursorWindow.setIgnoreMouseEvents(true, { forward: true }); } catch (_) {}
  try { privateCursorWindow.setContentProtection(true); } catch (_) {}
  try { privateCursorWindow.setAlwaysOnTop(true, 'screen-saver', 2); } catch (_) {}
  try { privateCursorWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {}

  privateCursorWindow.on('closed', () => { privateCursorWindow = null; });
  return privateCursorWindow;
}

function showPrivateCursorAt(point) {
  const win = createPrivateCursorWindow();
  if (!win || win.isDestroyed()) return;
  // Keep the arrow hotspot at the true OS pointer while allowing the rest of
  // the protected cursor to extend outside the overlay without clipping.
  try { win.setBounds({ x: Math.round(point.x - 2), y: Math.round(point.y - 2), width: 30, height: 40 }, false); } catch (_) {}
  try { win.setContentProtection(true); } catch (_) {}
  try { win.setAlwaysOnTop(true, 'screen-saver', 2); } catch (_) {}
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {}
  try { if (!win.isVisible()) win.showInactive(); } catch (_) {}
}

function hidePrivateCursorWindow() {
  if (!privateCursorWindow || privateCursorWindow.isDestroyed()) return;
  try { privateCursorWindow.hide(); } catch (_) {}
}

function destroyPrivateCursorWindow() {
  if (!privateCursorWindow || privateCursorWindow.isDestroyed()) { privateCursorWindow = null; return; }
  try { privateCursorWindow.destroy(); } catch (_) {}
  privateCursorWindow = null;
}

function startOverlayPointerGuard() {
  if (overlayPointerGuard) clearInterval(overlayPointerGuard);

  overlayPointerGuard = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) {
      hidePrivateCursorWindow();
      return;
    }

    try {
      const point = screen.getCursorScreenPoint();
      const bounds = overlayWindow.getBounds();
      // Inclusive right/bottom edge is intentional. During manual resize the OS
      // pointer commonly sits exactly on the moving border; treating that pixel
      // as outside was the reason the private cursor disappeared at the edges.
      const inside =
        point.x >= bounds.x && point.x <= bounds.x + bounds.width &&
        point.y >= bounds.y && point.y <= bounds.y + bounds.height;

      if (inside) showPrivateCursorAt(point);
      else hidePrivateCursorWindow();

      // Keep the renderer notification for compatibility with older overlay code.
      overlayWindow.webContents.send('private-pointer-position', {
        inside,
        x: Math.max(0, Math.min(bounds.width - 1, point.x - bounds.x)),
        y: Math.max(0, Math.min(bounds.height - 1, point.y - bounds.y))
      });
    } catch (_) {}
  }, 16);
}

function stopOverlayPointerGuard() {
  if (overlayPointerGuard) clearInterval(overlayPointerGuard);
  overlayPointerGuard = null;
  hidePrivateCursorWindow();
}

function stopOverlayManualResize() {
  if (overlayResizeGuard) clearInterval(overlayResizeGuard);
  overlayResizeGuard = null;
  overlayResizeState = null;
}

function startOverlayManualResize(direction) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return false;
  stopOverlayManualResize();
  const dir = String(direction || '').toLowerCase();
  if (!/^(n|s|e|w|ne|nw|se|sw)$/.test(dir)) return false;
  const startBounds = overlayWindow.getBounds();
  const startPoint = screen.getCursorScreenPoint();
  overlayResizeState = { dir, startBounds, startPoint, lastPoint: startPoint, lastMoveAt: Date.now() };

  overlayResizeGuard = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed() || !overlayResizeState) return stopOverlayManualResize();
    const point = screen.getCursorScreenPoint();
    const state = overlayResizeState;
    if (point.x !== state.lastPoint.x || point.y !== state.lastPoint.y) {
      state.lastPoint = point;
      state.lastMoveAt = Date.now();
    }

    const dx = point.x - state.startPoint.x;
    const dy = point.y - state.startPoint.y;
    let { x, y, width, height } = state.startBounds;
    const minWidth = 420;
    const minHeight = 120;

    if (state.dir.includes('e')) width = Math.max(minWidth, state.startBounds.width + dx);
    if (state.dir.includes('s')) height = Math.max(minHeight, state.startBounds.height + dy);
    if (state.dir.includes('w')) {
      width = Math.max(minWidth, state.startBounds.width - dx);
      x = state.startBounds.x + (state.startBounds.width - width);
    }
    if (state.dir.includes('n')) {
      height = Math.max(minHeight, state.startBounds.height - dy);
      y = state.startBounds.y + (state.startBounds.height - height);
    }

    try {
      overlayWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }, false);
    } catch (_) {}
    enforceOverlayPrivacyAndTopmost();

    // Safety fallback when mouse-up occurs outside Chromium.
    if (Date.now() - state.lastMoveAt > 1200) stopOverlayManualResize();
  }, 16);
  return true;
}

function normalizeGoogleMeetUrl(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw) return null;

  // Accept the three forms users commonly paste/type:
  //   abc-defg-hij
  //   meet.google.com/abc-defg-hij
  //   https://meet.google.com/abc-defg-hij
  // Always hand the Meet controller one canonical HTTPS URL.
  const directCode = raw.match(/^([a-z]{3}-[a-z]{3,4}-[a-z]{3})(?:[/?#].*)?$/i);
  if (directCode) return `https://meet.google.com/${directCode[1].toLowerCase()}`;

  let candidate = raw;
  if (/^(?:www\.)?meet\.google\.com(?:[/:?#]|$)/i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!/^https?:$/.test(parsed.protocol) || hostname !== 'meet.google.com') return null;

    const code = parsed.pathname.split('/').filter(Boolean)[0] || '';
    if (!/^[a-z]{3}-[a-z]{3,4}-[a-z]{3}$/i.test(code)) return null;

    return `https://meet.google.com/${code.toLowerCase()}`;
  } catch (_) {
    return null;
  }
}

function resetRuntimeFlags() {
  stopSessionStatusPoller();
  started = false;
  remoteSttStarted = false;
  audioRelayStarted = false;
  transcriptLimitReached = false;
  activeCaptureSessionId = '';
  activeCaptureSessionToken = '';
  activeCaptureGoogleEmail = '';
  localCaptionReady = false;
  localCaptionAdmitted = false;
  localCaptionLastAt = 0;
  localCaptionLastText = '';
  localCaptionLastWasFinal = false;
  deepgramFallbackActive = false;
  if (captionFallbackTimer) clearTimeout(captionFallbackTimer);
  captionFallbackTimer = null;
  audibleWithoutCaptionSince = 0;
}

function normalizeBackendHttpUrl(rawUrl) {
  let url = String(rawUrl || '').trim().replace(/\/+$/, '');

  if (!url) throw new Error('Backend URL is empty');

  if (url.startsWith('ws://')) url = url.replace('ws://', 'http://');
  if (url.startsWith('wss://')) url = url.replace('wss://', 'https://');

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }

  return url;
}

function getAppConfig() {
  return { backendUrl: BACKEND_URL, downloadUrl: DOWNLOAD_URL };
}

function sendStatus(msg) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('status', msg);
  }
}

function sendTranscriptionSource(source) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('transcription-source', source);
  }
}


function sendMeetChat(payload) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.webContents.send('meet-chat', payload);
}

ipcMain.on('meet-chat-message', (_, payload) => {
  if (!payload || !payload.message) return;
  sendMeetChat({
    sender: String(payload.sender || 'Host').trim() || 'Host',
    message: String(payload.message || '').trim(),
    meetTime: String(payload.meetTime || '').trim(),
    chatKey: String(payload.chatKey || '').trim(),
    timestamp: payload.timestamp || Date.now()
  });
});


function activateDeepgramFallback(reason = '') {
  if (GOOGLE_CAPTIONS_ONLY_TEST) {
    deepgramFallbackActive = false;
    if (!meetOnlyFallbackNoticeSent) {
      meetOnlyFallbackNoticeSent = true;
      sendTranscriptionSource('detecting');
      sendStatus(`Google Meet captions-only test mode. Deepgram is disabled${reason ? ` (${reason})` : ''}.`);
    }
    return;
  }
  if (!started || localCaptionReady || deepgramFallbackActive) return;
  deepgramFallbackActive = true;
  sendTranscriptionSource('deepgram');
  sendStatus(`Google Meet captions unavailable${reason ? ` (${reason})` : ''}. Using Deepgram fallback...`);
}

function scheduleDeepgramFallbackCheck() {
  // Do not activate paid STT merely because Meet has not rendered a caption row
  // yet. Before anyone speaks there is nothing to transcribe. Fallback is armed
  // by actual audible Meet audio below and starts only after 10 seconds without
  // a validated Google caption update.
  if (captionFallbackTimer) clearTimeout(captionFallbackTimer);
  captionFallbackTimer = null;
}

ipcMain.on('meet-caption-state', (_, payload) => {
  if (!started || !payload) return;
  const state = String(payload.state || '');
  if (state === 'admitted') {
    localCaptionAdmitted = true;
    scheduleDeepgramFallbackCheck();
    return;
  }
  if (state === 'ready') {
    localCaptionReady = true;
    deepgramFallbackActive = false;
    if (captionFallbackTimer) clearTimeout(captionFallbackTimer);
    captionFallbackTimer = null;
    sendTranscriptionSource('meet-captions');
    sendStatus('Google Meet captions connected. Local low-latency transcription active.');
  }
});

ipcMain.on('meet-caption-message', (_, payload) => {
  if (!started || !payload) return;
  const text = String(payload.text || '').trim();
  if (!text) return;
  localCaptionReady = true;
  localCaptionLastAt = Number(payload.capturedAt) || Date.now();
  localCaptionLastText = text;
  localCaptionLastWasFinal = Boolean(payload.isFinal);
  audibleWithoutCaptionSince = 0;
  deepgramFallbackActive = false;
  if (captionFallbackTimer) clearTimeout(captionFallbackTimer);
  captionFallbackTimer = null;
  sendTranscriptionSource('meet-captions');

  // Local-first render: no backend round-trip before the user sees the caption.
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('transcript', { text, isFinal: Boolean(payload.isFinal), source: 'meet-captions' });
  }
  // Backend receives text only for session-level PDF persistence and other PIN
  // viewers. This does not invoke Deepgram.
  sendLocalCaption({ text, isFinal: Boolean(payload.isFinal), capturedAt: payload.capturedAt || Date.now() });
});

ipcMain.handle('send-meet-chat-message', async (_, message) => {
  const text = String(message || '').trim();
  if (!text) return { success: false, error: 'Empty chat message' };
  return await sendMeetChatToMeeting(text);
});

function sendLoginRequired(msg) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  overlayWindow.webContents.send(
    'login-required',
    msg || 'Google login required or expired. Please sign in once, then join again.'
  );
}

async function redeemSessionPin(pin) {
  const base = normalizeBackendHttpUrl(BACKEND_URL);
  const res = await fetch(`${base}/api/desktop/redeem-pin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: String(pin || '').replace(/\D/g, '').slice(0, 6), deviceId: ZAPPER_DEVICE_ID })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) return { success: false, error: data.error || `Session PIN failed (${res.status})` };
  return { success: true, ...data };
}

async function saveSessionTranscript({ sessionToken, transcriptText, transcriptSegments, startedAt, endedAt, googleEmail }) {
  const base = normalizeBackendHttpUrl(BACKEND_URL);
  const res = await fetch(`${base}/api/desktop/transcripts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${String(sessionToken || '')}` },
    body: JSON.stringify({ transcriptText, transcriptSegments, startedAt, endedAt, googleEmail })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) return { success: false, error: data.error || `Transcript save failed (${res.status})` };
  return { success: true, ...data };
}

async function endBackendSession(sessionToken) {
  const base = normalizeBackendHttpUrl(BACKEND_URL);
  const res = await fetch(`${base}/api/desktop/end-session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${String(sessionToken || '')}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) return { success: false, error: data.error || `Session end failed (${res.status})` };
  return { success: true, ...data };
}

async function getBackendSessionStatus(sessionToken) {
  const base = normalizeBackendHttpUrl(BACKEND_URL);
  const res = await fetch(`${base}/api/desktop/session-status`, {
    headers: { authorization: `Bearer ${String(sessionToken || '')}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) return { success: false, active: false, error: data.error || `Session status failed (${res.status})` };
  return { success: true, ...data };
}

function stopSessionStatusPoller() {
  if (sessionStatusPoller) clearInterval(sessionStatusPoller);
  sessionStatusPoller = null;
}

async function stopActiveCaptureRuntime(statusText = 'Stopped') {
  if (captureStopInProgress) return;
  captureStopInProgress = true;
  try {
    stopSessionStatusPoller();
    onAudioChunk(() => {});
    // Flush the latest Meet interim into the session ledger before closing the
    // authenticated socket. The API accepts a short grace window after host End.
    if (localCaptionLastText && !localCaptionLastWasFinal) {
      sendLocalCaption({ text: localCaptionLastText, isFinal: true, capturedAt: localCaptionLastAt || Date.now() });
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    stopRemoteTranscriptStream();
    await leaveMeet().catch(() => {});
    resetRuntimeFlags();
    sendTranscriptionSource('idle');
    sendStatus(statusText);
  } finally {
    captureStopInProgress = false;
  }
}

function startSessionStatusPoller(sessionToken) {
  stopSessionStatusPoller();
  const token = String(sessionToken || '');
  if (!token) return;
  let checking = false;
  sessionStatusPoller = setInterval(async () => {
    if (checking || !overlayWindow || overlayWindow.isDestroyed()) return;
    checking = true;
    try {
      const state = await getBackendSessionStatus(token);
      if (!state.success) return; // network/auth glitches must never end a host-controlled session locally
      if (state.active) return;
      const message = state.endReason === 'host_ended'
        ? 'The host ended this Zapper session. This PIN is no longer valid.'
        : 'This Zapper session is no longer active. Ask the host for a new PIN.';
      overlayWindow.webContents.send('session-ended', message);
      await stopActiveCaptureRuntime('Host ended session.');
    } catch (_) {
      // A temporary network error must not terminate a valid meeting.
    } finally {
      checking = false;
    }
  }, 10000);
  sessionStatusPoller.unref?.();
}

async function terminateApplicationCompletely() {
  if (forceExitScheduled) return;
  forceExitScheduled = true;

  resetRuntimeFlags();
  stopSessionStatusPoller();
  onAudioChunk(() => {});

  // Do not let a slow Meet/Google renderer keep the Electron process alive.
  await Promise.race([
    leaveMeet().catch(() => {}),
    new Promise(resolve => setTimeout(resolve, 300))
  ]);

  try { closeGoogleSignInWindow(); } catch (_) {}
  stopRemoteTranscriptStream();
  stopAudioWSServer();
  stopOverlayTopmostGuard();
  stopOverlayPointerGuard();
  stopOverlayManualResize();
  destroyPrivateCursorWindow();
  try { globalShortcut.unregisterAll(); } catch (_) {}

  // Close/destroy every Electron window, including hidden Meet/sign-in windows.
  for (const win of BrowserWindow.getAllWindows()) {
    try { if (!win.isDestroyed()) win.destroy(); } catch (_) {}
  }

  // app.exit() is intentional here. The overlay X means "Exit Zapper", not
  // "hide to background". This guarantees the single-instance lock and all
  // background resources are released before the user launches Zapper again.
  setTimeout(() => {
    try { app.exit(0); } catch (_) { process.exit(0); }
  }, 25);
}

function createOverlayWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const overlayWidth = 625; // existing default width
  const overlayHeight = 320; // existing default height
  // Default launch position: horizontally centered near the top of the primary
  // display, directly below the usual webcam/camera area. Users can still drag
  // and resize the overlay normally after launch.
  const defaultX = Math.round(workArea.x + (workArea.width - overlayWidth) / 2);
  const defaultY = Math.round(workArea.y + 90);

  overlayWindow = new BrowserWindow({
    width: overlayWidth,
    height: overlayHeight,
    minWidth: 420,
    minHeight: 44,
    x: defaultX,
    y: defaultY,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    roundedCorners: false,
    thickFrame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Privacy must be enabled before the renderer is ever shown. This prevents
  // the header or any first-painted content from briefly appearing in a
  // supported screen/window capture source.
  overlayWindow.setMovable(true);
  overlayWindow.setResizable(false);
  try { overlayWindow.setContentProtection(true); } catch (_) {}
  try { overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1); } catch (_) {}
  try { overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {}
  try { overlayWindow.setFullScreenable(false); } catch (_) {}

  global.overlayWindow = overlayWindow;
  createPrivateCursorWindow();
  overlayWindow.loadFile(path.join(__dirname, 'overlay', 'index.html'));

  overlayWindow.once('ready-to-show', () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    enforceOverlayPrivacyAndTopmost();
    overlayWindow.showInactive();
    startOverlayTopmostGuard();
    startOverlayPointerGuard();
  });

  // Some Windows/app transitions can disturb z-order/capture affinity.
  // Reassert both without stealing keyboard focus.
  ['show', 'restore', 'focus', 'blur', 'move', 'resize'].forEach((eventName) => {
    overlayWindow.on(eventName, enforceOverlayPrivacyAndTopmost);
  });
  // Zapper uses its own collapse control. If Windows/native code minimizes the
  // overlay, restore it immediately without taking keyboard focus.
  overlayWindow.on('minimize', () => {
    setImmediate(() => {
      if (!overlayWindow || overlayWindow.isDestroyed()) return;
      try { overlayWindow.restore(); } catch (_) {}
      try { overlayWindow.showInactive(); } catch (_) {}
      enforceOverlayPrivacyAndTopmost();
    });
  });
  overlayWindow.webContents.on('did-finish-load', enforceOverlayPrivacyAndTopmost);
  overlayWindow.on('always-on-top-changed', (_, isAlwaysOnTop) => {
    if (!isAlwaysOnTop) setImmediate(enforceOverlayPrivacyAndTopmost);
  });

  overlayWindow.on('closed', () => {
    stopOverlayTopmostGuard();
    stopOverlayPointerGuard();
    stopOverlayManualResize();
    hidePrivateCursorWindow();
    overlayWindow = null;
  });
}

ipcMain.handle('get-app-config', async () => getAppConfig());
ipcMain.handle('get-app-version', async () => app.getVersion());
ipcMain.handle('open-latest-download', async () => {
  if (!/^https:\/\//i.test(DOWNLOAD_URL)) return { success: false, error: 'Download URL is not configured.' };
  await shell.openExternal(DOWNLOAD_URL);
  return { success: true };
});

ipcMain.handle('redeem-session-pin', async (_, pin) => {
  try { return await redeemSessionPin(pin); }
  catch (err) { return { success: false, error: err.message || 'Could not reach the Zapper backend.' }; }
});

ipcMain.handle('save-session-transcript', async (_, data) => {
  try { return await saveSessionTranscript(data || {}); }
  catch (err) { return { success: false, error: err.message || 'Could not save transcript.' }; }
});

ipcMain.handle('end-backend-session', async (_, sessionToken) => {
  try { return await endBackendSession(sessionToken); }
  catch (err) { return { success: false, error: err.message || 'Could not end backend session.' }; }
});

ipcMain.handle('google-signin', async () => {
  await openGoogleSignIn(sendStatus, true);
  return { success: true };
});

ipcMain.handle('clear-google-profile', async () => {
  await clearGoogleProfile(sendStatus);
  return { success: true };
});

ipcMain.handle('check-google-login', async () => {
  const loggedIn = await isGoogleLoggedIn();
  return { loggedIn };
});

function pcmLooksAudible(pcmBuffer) {
  if (!pcmBuffer || pcmBuffer.length < 2) return false;
  // Sample sparsely; this stays off the UI thread's critical rendering path.
  let peak = 0;
  for (let i = 0; i + 1 < pcmBuffer.length; i += 64) {
    const sample = pcmBuffer.readInt16LE(i - (i % 2));
    const abs = Math.abs(sample);
    if (abs > peak) peak = abs;
    if (peak >= 900) return true;
  }
  return false;
}

ipcMain.handle('join-meet', async (_, { meetUrl, guestName, sessionToken, sessionId }) => {
  if (started) {
    if (String(sessionId || '') && String(sessionId || '') === activeCaptureSessionId) {
      return { success: true, started: true, resumed: true, googleEmail: activeCaptureGoogleEmail };
    }
    return {
      success: false,
      backgroundSessionActive: true,
      error: 'Another Zapper session is still capturing in the background until its host ends it. Reopen that same PIN or close Zapper before starting a different session.'
    };
  }

  try {
    if (!String(sessionToken || '').trim()) return { success: false, sessionRequired: true, error: 'Enter a valid 6-digit Zapper session PIN.' };

    const validatedMeetUrl = normalizeGoogleMeetUrl(meetUrl);
    if (!validatedMeetUrl) {
      started = false;
      return {
        success: false,
        invalidMeetUrl: true,
        error: 'Enter a valid Google Meet URL, for example https://meet.google.com/abc-defg-hij.'
      };
    }

    // Google authentication is required before Meet is opened.
    const loggedIn = await isGoogleLoggedIn().catch(() => false);
    if (!loggedIn) {
      const loginMessage = 'You must log in with your Google account before joining. Opening Google Sign-In now.';
      sendLoginRequired(loginMessage);
      sendStatus(loginMessage);
      await openGoogleSignIn(sendStatus, true).catch(() => {});
      return {
        success: false,
        loginRequired: true,
        error: loginMessage
      };
    }

    const googleEmail = await getGoogleAccountEmail().catch(() => '');
    started = true;
    activeCaptureSessionId = String(sessionId || '');
    activeCaptureSessionToken = String(sessionToken || '');
    activeCaptureGoogleEmail = String(googleEmail || '');

    meetOnlyFallbackNoticeSent = false;
    sendTranscriptionSource('detecting');
    sendStatus(GOOGLE_CAPTIONS_ONLY_TEST
      ? 'Session verified. Opening Meet... Google Meet captions-only test mode; Deepgram disabled.'
      : 'Session verified. Opening Meet...');
    startSessionStatusPoller(sessionToken);

    startAudioWSServer();
    audioRelayStarted = true;

    let firstAudioSeen = false;

    // Open the PIN-authorized caption socket BEFORE any Meet audio arrives.
    // Without this, a silent desktop cannot receive the host's browser
    // microphone captions until someone on Meet first speaks.
    remoteSttStarted = true;
    startRemoteTranscriptStream({ backendUrl: BACKEND_URL, sessionToken, googleEmail }, payload => {
      if (!overlayWindow || overlayWindow.isDestroyed()) return;

      if (payload.error) {
        // In Meet-captions-only test mode no PCM is ever sent to Deepgram. Keep
        // backend/session errors visible, but suppress provider-only noise if an
        // older backend instance reports it unexpectedly.
        const errorText = String(payload.error || '');
        if (GOOGLE_CAPTIONS_ONLY_TEST && /deepgram|transcription credentials/i.test(errorText)) return;
        overlayWindow.webContents.send('status', 'Transcription error: ' + errorText);
        return;
      }

      if (payload.type === 'status') {
        overlayWindow.webContents.send('status', payload.text);
        return;
      }

      if (payload.type === 'session_ended') {
        overlayWindow.webContents.send('session-ended', payload.text || 'This Zapper session is no longer active.');
        stopActiveCaptureRuntime('Host ended session.').catch(() => {});
        return;
      }

      if (payload.type === 'limit_reached') {
        transcriptLimitReached = true;
        overlayWindow.webContents.send('status', payload.text || 'Transcript limit reached. Captions disconnected.');
        stopRemoteTranscriptStream();
        return;
      }

      if (payload.type === 'speech_started') {
        overlayWindow.webContents.send('speech-started');
        return;
      }

      // If this desktop has Meet captions, render those directly and ignore
      // backend relay echoes/other viewers to prevent duplicate lines. Deepgram
      // transcripts are accepted only while fallback is explicitly active.
      if (GOOGLE_CAPTIONS_ONLY_TEST && payload.source === 'deepgram') return;
      if (localCaptionReady && payload.source !== 'deepgram') return;
      if (payload.source === 'deepgram' && !deepgramFallbackActive) return;
      overlayWindow.webContents.send('transcript', {
        text: payload.text,
        isFinal: payload.isFinal,
        source: payload.source || 'backend'
      });
    });

    onAudioChunk(pcmBuffer => {
      if (!pcmBuffer || !pcmBuffer.length || transcriptLimitReached) return;

      // Diagnostic guarantee: this build must never send Meet PCM to Deepgram.
      // Audio capture may still exist for the unchanged Meet controller, but the
      // bytes stop here and never leave the desktop process.
      if (GOOGLE_CAPTIONS_ONLY_TEST) return;

      // Deepgram is a true fallback: do not start it because a caption DOM node
      // has not appeared while the meeting is quiet. Start only after admitted
      // Meet audio is actually audible for 10 seconds without a validated Google
      // caption update. Any later Meet caption immediately disables fallback and
      // closes its Deepgram stream on the backend.
      if (localCaptionAdmitted && !deepgramFallbackActive) {
        if (pcmLooksAudible(pcmBuffer)) {
          if (!audibleWithoutCaptionSince) audibleWithoutCaptionSince = Date.now();
          const lastCaptionReference = localCaptionLastAt || audibleWithoutCaptionSince;
          if (Date.now() - Math.max(lastCaptionReference, audibleWithoutCaptionSince) >= 10000) {
            const hadMeetCaptions = localCaptionReady || Boolean(localCaptionLastAt);
            localCaptionReady = false;
            activateDeepgramFallback(hadMeetCaptions
              ? 'no Meet caption updates during audible speech'
              : 'no Meet caption text during audible speech');
          }
        } else {
          audibleWithoutCaptionSince = 0;
        }
      }

      // Normal path never sends Meet audio off the device. Audio is forwarded
      // only if the local Meet-caption observer failed after admission.
      if (!deepgramFallbackActive || localCaptionReady) return;
      if (!firstAudioSeen) {
        firstAudioSeen = true;
        sendStatus('Deepgram fallback active. Streaming Meet audio for transcription...');
      }
      sendAudioChunk(pcmBuffer);
    });

    sendStatus('Meet opened. Click Ask to Join manually when ready.');

    joinMeet(validatedMeetUrl, guestName, sendStatus).catch(err => {
      console.error('[Main] joinMeet background error:', err);
      sendStatus('Meet join error: ' + err.message);
    });

    return {
      success: true,
      started: true,
      googleEmail
    };

  } catch (err) {
    stopRemoteTranscriptStream();
    onAudioChunk(() => {});
    resetRuntimeFlags();
    console.error('[Main] join-meet error:', err);

    return {
      success: false,
      error: err.message
    };
  }
});

ipcMain.handle('detach-live-session', async () => {
  // Participant Leave only detaches the overlay view. The hidden Meet/audio/STT
  // capture stays alive until the host explicitly ends the session in the portal.
  // This keeps the session-level PDF complete without putting persistence work
  // in the live-caption path.
  if (started) sendStatus('Live view left. Transcript capture continues in the background until the host ends the session.');
  return { success: true, capturing: started, sessionId: activeCaptureSessionId };
});

ipcMain.handle('leave-meet', async () => {
  await stopActiveCaptureRuntime('Stopped');
  return { success: true };
});

ipcMain.handle('close-overlay', async () => {
  // The X button is a true application exit. No tray/background Electron
  // process is intentionally retained after this action.
  terminateApplicationCompletely().catch(() => {
    try { app.exit(0); } catch (_) { process.exit(0); }
  });
  return { success: true };
});

ipcMain.handle('close-google-signin-window', async () => {
  closeGoogleSignInWindow();
  return { success: true };
});

ipcMain.handle('countdown-auto-close-ready', async () => {
  // Called when countdown reaches 0 - just for logging
  console.log('[IPC] Countdown auto-close triggered');
  return { success: true };
});

ipcMain.handle('overlay-set-collapsed', async (_, collapsed) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return true;

  const b = overlayWindow.getBounds();

  if (collapsed) {
    overlayWindow.setResizable(false);
    overlayWindow.setBounds({
      x: b.x,
      y: b.y,
      width: b.width,
      height: 48
    });
  } else {
    overlayWindow.setResizable(false);
    overlayWindow.setBounds({
      x: b.x,
      y: b.y,
      width: b.width,
      height: Math.max(320, b.height)
    });
  }

  enforceOverlayPrivacyAndTopmost();

  return true;
});

ipcMain.handle('overlay-resize-start', (_, direction) => startOverlayManualResize(direction));
ipcMain.handle('overlay-resize-stop', () => { stopOverlayManualResize(); return true; });

ipcMain.handle('overlay-click-through', (_, enabled) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(!!enabled, { forward: true });
  }

  return true;
});

app.whenReady().then(async () => {
  // Keep one stable localhost audio relay for the whole desktop process.
  // Individual Leave/Rejoin cycles replace only the audio callback.
  startAudioWSServer();
  audioRelayStarted = true;

  // Renderer owns the startup sequence: Google Sign-In first, then 6-digit session PIN.
  createOverlayWindow();

  globalShortcut.register('CommandOrControl+Shift+T', () => {
    if (!overlayWindow) return;

    overlayWindow.isVisible()
      ? overlayWindow.hide()
      : overlayWindow.show();

    enforceOverlayPrivacyAndTopmost();
  });

  globalShortcut.register('CommandOrControl+Shift+M', () => {
    toggleMeetDebug();
  });

  globalShortcut.register('CommandOrControl+Shift+G', () => {
    openGoogleSignIn(sendStatus);
  });
});

app.on('will-quit', () => {
  stopOverlayTopmostGuard();
  stopOverlayPointerGuard();
  destroyPrivateCursorWindow();
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', async () => {
  resetRuntimeFlags();
  await leaveMeet().catch(() => {});
  stopRemoteTranscriptStream();
  stopAudioWSServer();
  app.quit();
});