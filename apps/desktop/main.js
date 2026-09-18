// main.js — Electron main process
const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT_BACKEND_URL = 'https://api.zapperapp.in';
let APP_CONFIG = {};
try { APP_CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'app-config.json'), 'utf8')); } catch (_) {}
const BACKEND_URL = String(APP_CONFIG.backendUrl || DEFAULT_BACKEND_URL).trim().replace(/\/+$/, '');

// Permanent app data folder. Keep this value unchanged so Google cookies/session persist
// across app restarts, packaging, and future builds on the same machine.
app.setPath('userData', path.join(app.getPath('appData'), 'ZapperPlatformProfile'));

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
  stopRemoteTranscriptStream
} = require('./transcriber/remoteDeepgram');

app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'IsolateOrigins,site-per-process');

let overlayWindow = null;
let started = false;
let remoteSttStarted = false;
let audioRelayStarted = false;
let transcriptLimitReached = false;
let overlayTopmostGuard = null;
let overlayPointerGuard = null;


// Keep the overlay private from supported OS capture APIs and continuously
// reinforce its top-most z-order without stealing keyboard focus.
function enforceOverlayPrivacyAndTopmost() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  try { overlayWindow.setContentProtection(true); } catch (_) {}
  try { overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1); } catch (_) {}
  try { overlayWindow.moveTop(); } catch (_) {}
}

function startOverlayTopmostGuard() {
  if (overlayTopmostGuard) clearInterval(overlayTopmostGuard);
  overlayTopmostGuard = setInterval(enforceOverlayPrivacyAndTopmost, 750);
}

function stopOverlayTopmostGuard() {
  if (!overlayTopmostGuard) return;
  clearInterval(overlayTopmostGuard);
  overlayTopmostGuard = null;
}


function startOverlayPointerGuard() {
  if (overlayPointerGuard) clearInterval(overlayPointerGuard);

  overlayPointerGuard = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return;

    try {
      const point = screen.getCursorScreenPoint();
      const bounds = overlayWindow.getBounds();
      const inside =
        point.x >= bounds.x && point.x < bounds.x + bounds.width &&
        point.y >= bounds.y && point.y < bounds.y + bounds.height;

      overlayWindow.webContents.send('private-pointer-position', {
        inside,
        x: point.x - bounds.x,
        y: point.y - bounds.y
      });
    } catch (_) {}
  }, 24);
}

function stopOverlayPointerGuard() {
  if (!overlayPointerGuard) return;
  clearInterval(overlayPointerGuard);
  overlayPointerGuard = null;
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
  started = false;
  remoteSttStarted = false;
  audioRelayStarted = false;
  transcriptLimitReached = false;
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
  return { backendUrl: BACKEND_URL };
}

function sendStatus(msg) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('status', msg);
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
    body: JSON.stringify({ pin: String(pin || '').replace(/\D/g, '').slice(0, 6) })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) return { success: false, error: data.error || `Session PIN failed (${res.status})` };
  return { success: true, ...data };
}

async function saveSessionTranscript({ sessionToken, transcriptText, startedAt, endedAt, googleEmail }) {
  const base = normalizeBackendHttpUrl(BACKEND_URL);
  const res = await fetch(`${base}/api/desktop/transcripts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${String(sessionToken || '')}` },
    body: JSON.stringify({ transcriptText, startedAt, endedAt, googleEmail })
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

function createOverlayWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const overlayWidth = 625; // 50% default width

  overlayWindow = new BrowserWindow({
    width: overlayWidth,
    height: 320,
    minWidth: 420,
    minHeight: 44,
    x: workArea.x + workArea.width - overlayWidth - 16,
    y: workArea.y + 90,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    roundedCorners: false,
    thickFrame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
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
  overlayWindow.setResizable(true);
  try { overlayWindow.setContentProtection(true); } catch (_) {}
  try { overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1); } catch (_) {}
  try { overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {}
  try { overlayWindow.setFullScreenable(false); } catch (_) {}

  global.overlayWindow = overlayWindow;
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
  overlayWindow.on('always-on-top-changed', (_, isAlwaysOnTop) => {
    if (!isAlwaysOnTop) setImmediate(enforceOverlayPrivacyAndTopmost);
  });

  overlayWindow.on('closed', () => {
    stopOverlayTopmostGuard();
    stopOverlayPointerGuard();
    overlayWindow = null;
  });
}

ipcMain.handle('get-app-config', async () => getAppConfig());

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

ipcMain.handle('join-meet', async (_, { meetUrl, guestName, sessionToken }) => {
  if (started) return { success: true, started: true };

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

    sendStatus('Session verified. Opening Meet...');

    startAudioWSServer();
    audioRelayStarted = true;

    let firstAudioSeen = false;

    onAudioChunk(pcmBuffer => {
      if (!pcmBuffer || !pcmBuffer.length || transcriptLimitReached) return;

      if (!remoteSttStarted) {
        remoteSttStarted = true;
        sendStatus('Meet audio detected. Connecting to low-latency captions...');

        startRemoteTranscriptStream({ backendUrl: BACKEND_URL, sessionToken }, payload => {
          if (!overlayWindow || overlayWindow.isDestroyed()) return;

          if (payload.error) {
            overlayWindow.webContents.send('status', 'Transcription error: ' + payload.error);
            return;
          }

          if (payload.type === 'status') {
            overlayWindow.webContents.send('status', payload.text);
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

          overlayWindow.webContents.send('transcript', {
            text: payload.text,
            isFinal: payload.isFinal
          });
        });
      }

      if (!firstAudioSeen) {
        firstAudioSeen = true;
        sendStatus('Streaming low-latency captions...');
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
    stopAudioWSServer();
    resetRuntimeFlags();
    console.error('[Main] join-meet error:', err);

    return {
      success: false,
      error: err.message
    };
  }
});

ipcMain.handle('leave-meet', async () => {
  resetRuntimeFlags();

  await leaveMeet();
  stopRemoteTranscriptStream();
  stopAudioWSServer();

  sendStatus('Stopped');

  return { success: true };
});

ipcMain.handle('close-overlay', async () => {
  resetRuntimeFlags();

  await leaveMeet().catch(() => {});
  stopRemoteTranscriptStream();
  stopAudioWSServer();

  app.quit();

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
    overlayWindow.setResizable(true);
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

ipcMain.handle('overlay-click-through', (_, enabled) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(!!enabled, { forward: true });
  }

  return true;
});

app.whenReady().then(async () => {
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
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', async () => {
  resetRuntimeFlags();
  await leaveMeet().catch(() => {});
  stopRemoteTranscriptStream();
  stopAudioWSServer();
  app.quit();
});