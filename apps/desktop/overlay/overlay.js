const form = document.getElementById('joinForm');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const signinBtn = document.getElementById('signinBtn');
const closeBtn = document.getElementById('closeBtn');
const collapseBtn = document.getElementById('collapseBtn');
const appEl = document.getElementById('app');
const livePanel = document.getElementById('livePanel');
const joinPanel = document.getElementById('joinPanel');
const statusEl = document.getElementById('status');
const loginAlert = document.getElementById('loginAlert');
const countdownPanel = document.getElementById('countdownPanel');
const countdownTimer = document.getElementById('countdownTimer');
const skipBtn = document.getElementById('skipBtn');
const retainBtn = document.getElementById('retainBtn');
const transcriptEl = document.getElementById('transcript');
const fontDown = document.getElementById('fontDown');
const fontUp = document.getElementById('fontUp');
const fontSizeLabel = document.getElementById('fontSizeLabel');
const chatMessagesEl = document.getElementById('chatMessages');
const chatClearBtn = document.getElementById('chatClearBtn');
const chatSendForm = document.getElementById('chatSendForm');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
let privateCursor = null;

let finalLines = [];
let transcriptArchive = [];
let interimText = '';
let chatMessages = [];
const recentOutgoingChat = [];
let currentPanel = 'join';
let activeSessionToken = '';
let activeSessionId = '';
let activeMeetUrl = '';
let sessionStartedAt = 0;
let activeGoogleEmail = '';
let countdownInterval = null;
const MAX_LINES = 100;
const MAX_CHAT_MESSAGES = 60;
const OUTGOING_ECHO_SUPPRESS_MS = 20000;
const MIN_FONT = 10;
const MAX_FONT = 34;
const DEFAULT_FONT = 14;
const DEFAULT_BACKEND_URL = 'https://api.zapperapp.in';
const TRANSCRIPT_BOTTOM_THRESHOLD_PX = 24;
let transcriptAutoScroll = true;
let transcriptScrollTopLock = 0;
let transcriptRenderRestoring = false;
let transcriptUserScrollIntent = false;
let transcriptRenderVersion = 0;


function normalizeGoogleMeetInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

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

function removeHoverTooltips() {
  document.querySelectorAll('[title]').forEach((el) => el.removeAttribute('title'));
}

removeHoverTooltips();
new MutationObserver(removeHoverTooltips).observe(document.documentElement, {
  subtree: true,
  attributes: true,
  attributeFilter: ['title']
});

function initPrivateCursor() {
  privateCursor = document.getElementById('privateCursor');
  if (!privateCursor) return;

  const paintPrivateCursor = ({ inside = true, x, y } = {}) => {
    if (!privateCursor) return;

    if (!inside || !Number.isFinite(x) || !Number.isFinite(y)) {
      privateCursor.classList.remove('visible');
      return;
    }

    privateCursor.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    privateCursor.classList.add('visible');
  };

  // Renderer movement gives immediate local feedback over normal controls.
  // The main-process screen-point feed remains the fallback for draggable
  // header regions/native window movement where renderer mouse events can pause.
  document.addEventListener('mousemove', (event) => {
    paintPrivateCursor({ inside: true, x: event.clientX, y: event.clientY });
  }, { passive: true, capture: true });
  document.addEventListener('mouseenter', (event) => {
    paintPrivateCursor({ inside: true, x: event.clientX, y: event.clientY });
  }, { passive: true, capture: true });
  document.addEventListener('mouseleave', () => {
    privateCursor?.classList.remove('visible');
  }, { passive: true, capture: true });

  if (window.electronAPI?.onPrivatePointerPosition) {
    window.electronAPI.onPrivatePointerPosition(paintPrivateCursor);
  }

  // Only hide the native cursor after the replacement cursor exists and its
  // listeners are installed. This prevents an invisible-pointer failure mode.
  document.documentElement.classList.add('private-cursor-ready');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPrivateCursor, { once: true });
} else {
  initPrivateCursor();
}

const SHORT_AMERICAN_NAMES = ['Liam', 'Noah', 'Emma', 'Ava', 'Mia', 'Ella', 'Jack', 'Luke', 'Ryan', 'Owen', 'Evan', 'Nora'];

let transcriptFont = Number(localStorage.getItem('transcriptFontPx') || DEFAULT_FONT);
if (!Number.isFinite(transcriptFont)) transcriptFont = DEFAULT_FONT;

function applyFontSize() {
  transcriptFont = Math.max(MIN_FONT, Math.min(MAX_FONT, transcriptFont));
  document.documentElement.style.setProperty('--transcript-font', `${transcriptFont}px`);
  fontSizeLabel.textContent = String(transcriptFont);
  localStorage.setItem('transcriptFontPx', String(transcriptFont));
}
fontDown.addEventListener('click', () => { transcriptFont -= 2; applyFontSize(); });
fontUp.addEventListener('click', () => { transcriptFont += 2; applyFontSize(); });
applyFontSize();

// Auto-follow live text only while the user is at the bottom. Once the user
// scrolls up, freeze the exact pixel position until the user themselves returns
// to the bottom. Incoming final/interim transcript updates must never advance it.
function transcriptIsNearBottom() {
  const distance = transcriptEl.scrollHeight - transcriptEl.clientHeight - transcriptEl.scrollTop;
  return distance <= TRANSCRIPT_BOTTOM_THRESHOLD_PX;
}

function trimTranscriptHistoryIfFollowing() {
  if (!transcriptAutoScroll || finalLines.length <= MAX_LINES) return false;
  finalLines = finalLines.slice(-MAX_LINES);
  return true;
}

function pauseTranscriptFollow() {
  if (!transcriptAutoScroll) return;
  transcriptAutoScroll = false;
  transcriptScrollTopLock = transcriptEl.scrollTop;
}

function resumeTranscriptFollow() {
  if (transcriptAutoScroll) return;
  transcriptAutoScroll = true;
  trimTranscriptHistoryIfFollowing();
  renderTranscript();
}

// Wheel is the primary reading interaction. Capture the position after the
// browser has applied the wheel delta, not before it.
transcriptEl.addEventListener('wheel', (event) => {
  transcriptUserScrollIntent = true;
  if (event.deltaY < 0) pauseTranscriptFollow();

  requestAnimationFrame(() => {
    if (transcriptIsNearBottom() && event.deltaY > 0) {
      resumeTranscriptFollow();
    } else if (!transcriptAutoScroll) {
      transcriptScrollTopLock = transcriptEl.scrollTop;
    }
    transcriptUserScrollIntent = false;
  });
}, { passive: true });

// Also support scrollbar dragging, touch/pointer scrolling and keyboard scrolls.
transcriptEl.addEventListener('pointerdown', () => {
  transcriptUserScrollIntent = true;
}, { passive: true });
window.addEventListener('pointerup', () => {
  if (transcriptUserScrollIntent) {
    if (transcriptIsNearBottom()) resumeTranscriptFollow();
    else {
      pauseTranscriptFollow();
      transcriptScrollTopLock = transcriptEl.scrollTop;
    }
  }
  transcriptUserScrollIntent = false;
}, { passive: true });
transcriptEl.addEventListener('keydown', (event) => {
  if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) {
    transcriptUserScrollIntent = true;
    pauseTranscriptFollow();
  } else if (['ArrowDown', 'PageDown', 'End'].includes(event.key)) {
    transcriptUserScrollIntent = true;
  }
  requestAnimationFrame(() => {
    if (transcriptUserScrollIntent) {
      if (transcriptIsNearBottom()) resumeTranscriptFollow();
      else if (!transcriptAutoScroll) transcriptScrollTopLock = transcriptEl.scrollTop;
    }
    transcriptUserScrollIntent = false;
  });
});

transcriptEl.addEventListener('scroll', () => {
  // Any scroll event outside our render-restoration window is user-driven
  // (wheel, scrollbar drag, touchpad/touch or keyboard). This also covers
  // native scrollbar drags that do not reliably emit pointer events on Windows.
  if (transcriptRenderRestoring) return;

  if (transcriptIsNearBottom()) {
    resumeTranscriptFollow();
  } else {
    pauseTranscriptFollow();
    transcriptScrollTopLock = transcriptEl.scrollTop;
  }
}, { passive: true });

function getRandomGuestName() {
  return SHORT_AMERICAN_NAMES[Math.floor(Math.random() * SHORT_AMERICAN_NAMES.length)];
}

function showJoin() {
  currentPanel = 'join';
  joinPanel.classList.remove('hidden');
  livePanel.classList.add('hidden');
  leaveBtn.classList.add('hidden');
}

function setSessionInfo(text, cls = '') {
  const el = document.getElementById('sessionInfo');
  if (!el) return;
  el.className = 'licenseStatus' + (cls ? ` ${cls}` : '');
  el.textContent = text || '';
}

(async function loadDefaultConfig() {
  const cfg = await window.electronAPI.getAppConfig().catch(() => ({}));
  localStorage.setItem('backendUrl', cfg.backendUrl || DEFAULT_BACKEND_URL);
  showJoin();
  const login = await window.electronAPI.checkGoogleLogin().catch(() => ({ loggedIn: false }));
  if (login.loggedIn) {
    loginAlert.classList.add('hidden');
    setSessionInfo('Google is signed in. Enter the 6-digit session PIN.', 'ok');
    return;
  }
  showJoinError('You must log in with your Google account before joining. Google Sign-In is opening now.');
  setTimeout(() => signinBtn.click(), 250);
})();

let overlayCollapsed = localStorage.getItem('overlayCollapsed') === 'true';

async function applyOverlayCollapsed() {
  appEl.classList.toggle('collapsed', overlayCollapsed);
  collapseBtn.textContent = overlayCollapsed ? '+' : '−';
  collapseBtn.removeAttribute('title');
  localStorage.setItem('overlayCollapsed', String(overlayCollapsed));
  if (window.electronAPI.setOverlayCollapsed) {
    await window.electronAPI.setOverlayCollapsed(overlayCollapsed).catch(() => {});
  }
}

collapseBtn.addEventListener('click', async () => {
  overlayCollapsed = !overlayCollapsed;
  await applyOverlayCollapsed();
});
setTimeout(() => { applyOverlayCollapsed(); }, 250);
closeBtn.addEventListener('click', async () => { await window.electronAPI.closeOverlay(); });

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatChatTime(ts, displayTime = '') {
  if (displayTime) return String(displayTime);
  const d = ts ? new Date(ts) : new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderMeetChat() {
  if (!chatMessagesEl) return;
  if (!chatMessages.length) {
    chatMessagesEl.textContent = 'No host chat yet.';
    return;
  }

  chatMessagesEl.innerHTML = chatMessages.map(item => `
    <div class="chatMsg ${item.outgoing ? 'outgoing' : 'incoming'}">
      <div class="chatMeta"><span class="chatSender">${escapeHtml(item.outgoing ? 'You' : (item.sender || 'Host'))}</span><span>${escapeHtml(formatChatTime(item.timestamp, item.meetTime))}</span></div>
      <div class="chatText">${escapeHtml(item.message || '')}</div>
    </div>
  `).join('');

  requestAnimationFrame(() => { chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight; });
}

if (chatClearBtn) {
  chatClearBtn.addEventListener('click', () => {
    chatMessages = [];
    renderMeetChat();
  });
}

function isClockText(t) {
  return /^\d{1,2}:\d{2}(\s?[AP]M)?$/i.test(String(t || '').trim());
}

function isMeetControlText(value) {
  const t = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t || isClockText(t)) return true;
  const exactNoise = new Set([
    'ready to join?', 'ask to join', 'join now', 'meeting_room', 'present', 'present now', 'present_to_all',
    'share screen', 'computer_arrow_up', 'show fewer options', 'show more options', 'more options', 'more_vert',
    'expand_less', 'expand_more', 'keyboard_arrow_up', 'keyboard_return', 'chevron_right', 'mic', 'mic_none',
    'microphone', 'audio settings', 'video settings', 'easycamera', 'camera', 'videocam', 'leave call',
    'call_end', 'send a reaction', 'mood', 'closed_caption_off', 'back_hand', 'apps', 'meeting tools',
    'people', 'activities', 'chat', 'in-call messages', 'meeting details', 'google meet', 'meet chat forwarded',
    'companion mode', 'ask to use companion mode', 'pin message', 'pin messages', 'pinned message', 'pinned messages',
    'close', 'send', 'send message', 'chat_bubble', 'frame_person', 'reframe', 'visual_effects',
    'backgrounds and effects', 'captions controls', 'online trainings', 'keep', 'sent', 'sending', 'message sent', 'could not send message'
  ]);
  if (exactNoise.has(t)) return true;
  return /^(microphone array.*|turn off microphone.*|turn on microphone.*|turn off camera.*|turn on camera.*|turn on captions.*|turn off captions.*|raise hand.*|loading invitees.*|view everyone in this call|\d+ joined|chat with everyone.*|continuous chat is turned off.*|messages will not be saved.*|captions controls.*)$/i.test(t);
}


function isParticipantOrPanelNoise(value) {
  const t = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return true;
  return /^(loading invitees|view everyone in this call|\d+ joined|show everyone|people in this call|add people|pin messages?|pinned messages?|online trainings|chevron_right|expand_less|expand_more)$/i.test(t);
}

function rememberOutgoingChat(message) {
  const clean = String(message || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!clean) return;
  const now = Date.now();
  recentOutgoingChat.push({ text: clean, ts: now });
  while (recentOutgoingChat.length > 20) recentOutgoingChat.shift();
}

function isRecentOutgoingEcho(message) {
  const clean = String(message || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!clean) return false;
  const now = Date.now();
  for (let i = recentOutgoingChat.length - 1; i >= 0; i -= 1) {
    const item = recentOutgoingChat[i];
    if (now - item.ts > OUTGOING_ECHO_SUPPRESS_MS) continue;
    if (item.text === clean) return true;
  }
  return false;
}

function isDuplicateChat(payload) {
  const chatKey = String(payload?.chatKey || '').trim();
  if (chatKey) return chatMessages.some(item => String(item.chatKey || '') === chatKey);

  const cleanSender = String(payload?.sender || '').trim().toLowerCase();
  const cleanMessage = String(payload?.message || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const cleanTime = String(payload?.meetTime || '').trim().toLowerCase();
  return chatMessages.some(item =>
    String(item.sender || '').trim().toLowerCase() === cleanSender &&
    String(item.message || '').replace(/\s+/g, ' ').trim().toLowerCase() === cleanMessage &&
    String(item.meetTime || '').trim().toLowerCase() === cleanTime
  );
}

function isIncomingHostChat(payload) {
  const sender = String(payload?.sender || '').trim();
  const message = String(payload?.message || '').trim();
  if (!message || !sender) return false;
  if (/^(you|me)$/i.test(sender)) return false;
  if (isMeetControlText(sender) || isMeetControlText(message)) return false;
  // Only reject panel noise when it is the sender/exact whole message. Do not drop real long messages
  // just because they contain words like joined/loading inside normal text.
  if (isParticipantOrPanelNoise(sender)) return false;
  if (/^(loading invitees|view everyone in this call|\d+ joined|show everyone|people in this call|add people|pin messages?|pinned messages?)$/i.test(message)) return false;
  if (/^(sent|sending|message sent|could not send message|keep)$/i.test(message)) return false;
  if (/^(keep)$/i.test(sender)) return false;
  if (isRecentOutgoingEcho(message)) return false;
  return true;
}

if (chatSendForm) {
  chatSendForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = String(chatInput?.value || '').trim();
    if (!message) return;

    if (chatSendBtn) chatSendBtn.disabled = true;
    try {
      const res = await window.electronAPI.sendMeetChatMessage(message);
      if (res && res.success) {
        rememberOutgoingChat(message);
        chatMessages.push({ sender: 'You', message, timestamp: Date.now(), outgoing: true });
        if (chatMessages.length > MAX_CHAT_MESSAGES) chatMessages = chatMessages.slice(-MAX_CHAT_MESSAGES);
        renderMeetChat();
        if (chatInput) chatInput.value = '';
        statusEl.textContent = 'Chat message sent to Meet host.';
      } else {
        statusEl.textContent = (res && res.error) || 'Could not send Meet chat message.';
      }
    } catch (err) {
      statusEl.textContent = err?.message || 'Could not send Meet chat message.';
    } finally {
      setTimeout(() => { if (chatSendBtn) chatSendBtn.disabled = false; }, 500);
    }
  });
}

function renderTranscript() {
  const text = [...finalLines, interimText].filter(Boolean).join('\n');
  const shouldFollowLive = transcriptAutoScroll;
  const renderVersion = ++transcriptRenderVersion;

  transcriptRenderRestoring = true;
  transcriptEl.textContent = text || 'Waiting for host to speak...';

  const restorePosition = () => {
    if (renderVersion !== transcriptRenderVersion) return;

    if (shouldFollowLive && transcriptAutoScroll) {
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    } else if (!transcriptAutoScroll) {
      // Use the current global lock, not a stale value captured by an earlier
      // transcript render. That way a user wheel/drag always wins immediately.
      const maxTop = Math.max(0, transcriptEl.scrollHeight - transcriptEl.clientHeight);
      transcriptEl.scrollTop = Math.min(transcriptScrollTopLock, maxTop);
    }
  };

  // Restore synchronously and after layout. Interim text can reflow as words are
  // appended; repeated restoration plus overflow-anchor:none makes the reading
  // position deterministic until the user deliberately returns to the bottom.
  restorePosition();
  requestAnimationFrame(() => {
    restorePosition();
    requestAnimationFrame(() => {
      restorePosition();
      if (renderVersion === transcriptRenderVersion) transcriptRenderRestoring = false;
    });
  });
}

function showJoinError(msg) {
  showJoin();
  loginAlert.textContent = msg || 'Unable to join the meeting.';
  loginAlert.classList.remove('hidden');
  leaveBtn.classList.add('hidden');
  joinBtn.disabled = false;
}

function showLoginRequired(msg) {
  showJoinError(msg || 'You must log in with your Google account before joining.');
}

function showLive(status) {
  currentPanel = 'live';
  loginAlert.classList.add('hidden');
  countdownPanel.classList.add('hidden');
  joinPanel.classList.add('hidden');
  livePanel.classList.remove('hidden');
  leaveBtn.classList.remove('hidden');
  statusEl.textContent = status;
}

function showCountdownTimer(durationSeconds = 5) {
  // Show countdown panel and hide others
  countdownPanel.classList.remove('hidden');
  loginAlert.classList.add('hidden');
  joinPanel.classList.add('hidden');
  livePanel.classList.add('hidden');
  leaveBtn.classList.add('hidden');

  let secondsLeft = durationSeconds;
  countdownTimer.textContent = String(secondsLeft);

  // Clear any existing countdown
  if (countdownInterval) clearInterval(countdownInterval);

  countdownInterval = setInterval(() => {
    secondsLeft--;
    countdownTimer.textContent = String(secondsLeft);

    if (secondsLeft <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      // Auto-close: hide countdown panel
      hideCountdownTimer();
      // Signal that user allowed auto-close (via message to main process)
      window.electronAPI.countdownAutoCloseReady();
    }
  }, 1000);
}

function hideCountdownTimer() {
  countdownPanel.classList.add('hidden');
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

// Skip button - cancel auto-close and keep window open
skipBtn.addEventListener('click', () => {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;
  hideCountdownTimer();
  setSessionInfo('Google Sign-In window left open. Enter the session PIN when ready.', 'ok');
  showJoin();
});

retainBtn.addEventListener('click', () => {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;
  hideCountdownTimer();
  window.electronAPI.closeGoogleSignInWindow();
  setSessionInfo('Google signed in. Enter the 6-digit session PIN.', 'ok');
  showJoin();
});

signinBtn.addEventListener('click', async () => {
  signinBtn.disabled = true;
  showJoin();
  loginAlert.classList.add('hidden');
  setSessionInfo('Complete Google Sign-In in the opened window. This PIN screen will stay here.', 'ok');
  await window.electronAPI.googleSignIn().catch(() => null);
  // Completion is delivered asynchronously by onGoogleSignInComplete after the
  // persistent Google profile really contains authentication cookies.
  setTimeout(() => { signinBtn.disabled = false; }, 1000);
});

if (window.electronAPI.onGoogleSignInComplete) {
  window.electronAPI.onGoogleSignInComplete(() => {
    hideCountdownTimer();
    showJoin();
    loginAlert.classList.add('hidden');
    setSessionInfo('Google signed in. Enter the 6-digit session PIN and click Start Session.', 'ok');
    signinBtn.disabled = false;
    const pinInput = document.getElementById('sessionPin');
    if (pinInput) {
      requestAnimationFrame(() => {
        try { pinInput.focus({ preventScroll: true }); } catch (_) { try { pinInput.focus(); } catch (_) {} }
      });
    }
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const login = await window.electronAPI.checkGoogleLogin().catch(() => ({ loggedIn: false }));
  if (!login.loggedIn) {
    showJoinError('You must log in with your Google account before joining. Google Sign-In is opening now.');
    await window.electronAPI.googleSignIn().catch(() => null);
    return;
  }

  const pinInput = document.getElementById('sessionPin');
  const pin = String(pinInput?.value || '').replace(/\D/g, '').slice(0, 6);
  if (!/^\d{6}$/.test(pin)) {
    showJoinError('Enter the valid 6-digit session PIN created by the host in Zapper.in.');
    return;
  }

  joinBtn.disabled = true;
  loginAlert.classList.add('hidden');
  setSessionInfo('Checking session PIN...');
  const redeemed = await window.electronAPI.redeemSessionPin(pin).catch(e => ({ success: false, error: e.message }));
  if (!redeemed.success) {
    showJoinError(redeemed.error || 'Session PIN is invalid or expired.');
    return;
  }

  activeSessionToken = redeemed.sessionToken;
  activeSessionId = redeemed.sessionId;
  activeMeetUrl = redeemed.meetUrl;
  sessionStartedAt = Date.now();
  transcriptArchive = [];
  finalLines = [];
  interimText = '';
  transcriptAutoScroll = true;
  transcriptScrollTopLock = 0;
  showLive('Session verified. Preparing Google Meet...');

  const res = await window.electronAPI.joinMeet({
    guestName: getRandomGuestName(),
    meetUrl: activeMeetUrl,
    sessionToken: activeSessionToken,
  });
  if (!res.success) {
    activeSessionToken = '';
    activeSessionId = '';
    activeMeetUrl = '';
    sessionStartedAt = 0;
    activeGoogleEmail = '';
    if (res.loginRequired) return showLoginRequired(res.error);
    if (res.invalidMeetUrl) return showJoinError(res.error || 'The host session contains an invalid Google Meet URL.');
    return showJoinError(res.error || 'Failed to start the meeting transcription.');
  }
  activeGoogleEmail = String(res.googleEmail || '').trim();
});

leaveBtn.addEventListener('click', async () => {
  const endedAt = Date.now();
  const transcriptText = transcriptArchive.join('\n').trim();
  if (activeSessionToken && transcriptText) {
    statusEl.textContent = 'Saving transcript...';
    const saved = await window.electronAPI.saveSessionTranscript({
      sessionToken: activeSessionToken,
      transcriptText,
      startedAt: sessionStartedAt || endedAt,
      endedAt,
      googleEmail: activeGoogleEmail
    }).catch(e => ({ success: false, error: e.message }));
    if (!saved.success) statusEl.textContent = `Transcript save warning: ${saved.error || 'Could not save transcript.'}`;
  }
  if (activeSessionToken && window.electronAPI.endBackendSession) {
    await window.electronAPI.endBackendSession(activeSessionToken).catch(() => null);
  }
  await window.electronAPI.leaveMeet();
  finalLines = [];
  transcriptArchive = [];
  interimText = '';
  chatMessages = [];
  activeSessionToken = '';
  activeSessionId = '';
  activeMeetUrl = '';
  sessionStartedAt = 0;
  activeGoogleEmail = '';
  renderTranscript();
  renderMeetChat();
  statusEl.textContent = 'Stopped';
  showJoin();
  setSessionInfo('Session ended. Enter another 6-digit PIN to start again.');
  joinBtn.disabled = false;
});

window.electronAPI.onStatus((msg) => {
  statusEl.textContent = msg;
  if (/google login required|sign-in required|session expired/i.test(msg || '')) showLoginRequired(msg);
});
if (window.electronAPI.onLoginRequired) window.electronAPI.onLoginRequired((msg) => showLoginRequired(msg));
window.electronAPI.onSpeechStart(() => { statusEl.textContent = 'Speech detected...'; });
window.electronAPI.onTranscript(({ text, isFinal }) => {
  if (!text) return;
  if (isFinal) {
    const cleanFinal = text.trim();
    transcriptArchive.push(cleanFinal);
    finalLines.push(cleanFinal);
    // Never delete lines from the top while the user is reading older text.
    // Top-trimming was the hidden cause of the view moving down one line for
    // every new final transcript line even though auto-scroll was disabled.
    trimTranscriptHistoryIfFollowing();
    interimText = '';
  } else {
    interimText = text.trim();
  }
  renderTranscript();
});


if (window.electronAPI.onMeetChat) {
  window.electronAPI.onMeetChat((payload) => {
    if (!isIncomingHostChat(payload)) return;
    if (isDuplicateChat(payload)) return;
    chatMessages.push({
      sender: payload.sender || 'Host',
      message: payload.message,
      meetTime: payload.meetTime || '',
      chatKey: payload.chatKey || '',
      timestamp: payload.timestamp || Date.now()
    });
    if (chatMessages.length > MAX_CHAT_MESSAGES) chatMessages = chatMessages.slice(-MAX_CHAT_MESSAGES);
    renderMeetChat();
  });
}

// Listen for countdown timer start signal from main process
if (window.electronAPI.onCountdownStart) {
  window.electronAPI.onCountdownStart(() => {
    // Backward-compatible guard for older main-process builds: even if a stale
    // countdown event arrives, keep the participant PIN form visible.
    hideCountdownTimer();
    showJoin();
    setSessionInfo('Google signed in. Enter the 6-digit session PIN and click Start Session.', 'ok');
  });
}

renderMeetChat();

