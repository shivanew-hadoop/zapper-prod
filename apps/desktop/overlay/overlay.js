const form = document.getElementById('joinForm');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const signinBtn = document.getElementById('signinBtn');
const backToLiveBtn = document.getElementById('backToLiveBtn');
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
const appVersionEl = document.getElementById('appVersion');
const latestVersionBtn = document.getElementById('latestVersionBtn');
let privateCursor = null;

async function initAppVersionAndDownload() {
  try {
    const version = await window.electronAPI.getAppVersion();
    if (appVersionEl) appVersionEl.textContent = version ? `v${version}` : 'v—';
  } catch (_) {
    if (appVersionEl) appVersionEl.textContent = 'v—';
  }

  latestVersionBtn?.addEventListener('click', async () => {
    const previousText = latestVersionBtn.textContent;
    latestVersionBtn.disabled = true;
    latestVersionBtn.textContent = 'Opening…';
    try {
      const result = await window.electronAPI.openLatestDownload();
      if (!result?.success) throw new Error(result?.error || 'Could not open the latest installer.');
    } catch (err) {
      loginAlert.textContent = err?.message || 'Could not open the latest Zapper installer.';
      loginAlert.classList.remove('hidden');
    } finally {
      latestVersionBtn.disabled = false;
      latestVersionBtn.textContent = previousText || 'Get latest';
    }
  });
}


let finalLines = [];
let transcriptArchive = [];
let transcriptSegments = [];
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
const OUTGOING_ECHO_SUPPRESS_MS = 20000;
const MIN_FONT = 10;
const MAX_FONT = 34;
const DEFAULT_FONT = 16;
const DEFAULT_BACKEND_URL = 'https://api.zapperapp.in';
const TRANSCRIPT_BOTTOM_THRESHOLD_PX = 24;
let transcriptAutoScroll = true;
let transcriptScrollTopLock = 0;
let transcriptRenderRestoring = false;
let transcriptUserScrollIntent = false;
let transcriptRenderVersion = 0;
let finalizingSession = false;
let hostMirrorActive = false;
let lastFinalCaptionAt = 0;
let lastFinalCaptionOrigin = '';

// Source status is intentionally not shown in the overlay.
function setTranscriptionSource(_source) {}


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
initAppVersionAndDownload();
new MutationObserver(removeHoverTooltips).observe(document.documentElement, {
  subtree: true,
  attributes: true,
  attributeFilter: ['title']
});

function initPrivateCursor() {
  // The native cursor is hidden only while it is over the overlay.
  // A separate, capture-protected main-process cursor window now paints the
  // local-only pointer so it cannot be clipped by the overlay edges.
  privateCursor = document.getElementById('privateCursor');
  privateCursor?.classList.remove('visible');
  document.documentElement.classList.add('private-cursor-ready');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPrivateCursor, { once: true });
} else {
  initPrivateCursor();
}

// Resize through renderer-owned protected hit zones instead of native Windows
// resize borders. The visible pointer remains the protected private cursor.
document.querySelectorAll('[data-resize]').forEach((handle) => {
  handle.addEventListener('pointerdown', async (event) => {
    if (overlayCollapsed) return;
    event.preventDefault();
    event.stopPropagation();
    try { handle.setPointerCapture(event.pointerId); } catch (_) {}
    await window.electronAPI.startOverlayResize(handle.dataset.resize).catch(() => null);
  });
  const stop = async (event) => {
    try { if (event?.pointerId != null && handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); } catch (_) {}
    await window.electronAPI.stopOverlayResize().catch(() => null);
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
});
window.addEventListener('blur', () => window.electronAPI.stopOverlayResize?.().catch(() => null));

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

function pauseTranscriptFollow() {
  if (!transcriptAutoScroll) return;
  transcriptAutoScroll = false;
  transcriptScrollTopLock = transcriptEl.scrollTop;
}

function resumeTranscriptFollow() {
  if (transcriptAutoScroll) return;
  transcriptAutoScroll = true;
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

function showJoin({ force = false } = {}) {
  // Never let Google Sign-In or a stale UI event kick an active transcription
  // back to the PIN screen. The active session remains authoritative until the
  // participant leaves or the host ends it. Host startup may also race
  // with async config: never return an active host overlay to the PIN panel.
  if (!force && (hostMirrorActive || (activeSessionToken && currentPanel === 'live'))) {
    backToLiveBtn?.classList.add('hidden');
    return false;
  }
  currentPanel = 'join';
  appEl.classList.remove('session-active');
  joinPanel.classList.remove('hidden');
  livePanel.classList.add('hidden');
  leaveBtn.classList.add('hidden');
  backToLiveBtn?.classList.toggle('hidden', !activeSessionToken);
  return true;
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
  // Zapper session authorization is the PIN. Google login is optional for
  // meetings which allow guests; avoid launching Google Sign-In automatically.
  const login = await window.electronAPI.checkGoogleLogin().catch(() => ({ loggedIn: false }));
  loginAlert.classList.add('hidden');
  setSessionInfo(login.loggedIn
    ? 'Google is signed in. Enter the 6-digit session PIN.'
    : 'Enter your session PIN. Google sign-in is optional; Meet may require admission.', 'ok');
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

// Append only. Chat history stays intact instead of repainting every message
// whenever another participant sends to the group.
let chatRenderedCount = 0;
function renderMeetChat() {
  if (!chatMessagesEl) return;
  if (!chatMessages.length) {
    chatMessagesEl.textContent = 'No messages yet.';
    chatRenderedCount = 0;
    return;
  }
  if (chatRenderedCount > chatMessages.length) chatRenderedCount = 0;
  if (!chatRenderedCount) chatMessagesEl.textContent = '';
  const incoming = chatMessages.slice(chatRenderedCount);
  if (!incoming.length) return;
  chatMessagesEl.insertAdjacentHTML('beforeend', incoming.map(item => `
    <div class="chatMsg ${item.outgoing ? 'outgoing' : 'incoming'}">
      <div class="chatMeta"><span class="chatSender">${escapeHtml(item.outgoing ? 'You' : (item.sender || 'Participant'))}</span><span>${escapeHtml(formatChatTime(item.timestamp, item.meetTime))}</span></div>
      <div class="chatText">${escapeHtml(item.message || '')}</div>
    </div>
  `).join(''));
  chatRenderedCount = chatMessages.length;
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
  if (chatKey && chatMessages.some(item => String(item.chatKey || '') === chatKey)) return true;

  const cleanSender = String(payload?.sender || '').trim().toLowerCase();
  const cleanMessage = String(payload?.message || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const cleanTime = String(payload?.meetTime || '').trim().toLowerCase();
  return chatMessages.some(item => {
    if (String(item.message || '').replace(/\s+/g, ' ').trim().toLowerCase() !== cleanMessage) return false;
    const sameSender = String(item.sender || '').trim().toLowerCase() === cleanSender;
    const sameMeetTime = cleanTime && String(item.meetTime || '').trim().toLowerCase() === cleanTime;
    const closeArrival = Math.abs((item.timestamp || 0) - (payload?.timestamp || 0)) < 4000;
    return (sameSender && (sameMeetTime || closeArrival)) || (sameMeetTime && closeArrival);
  });
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
        renderMeetChat();
        if (chatInput) chatInput.value = '';
        statusEl.textContent = 'Group message accepted by Zapper.';
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

// Completed lines are append-only DOM nodes. Provisional text consists of
// immutable confirmed-prefix *word* nodes plus one changing tail. Meet may
// correct the last two interim words without repainting any settled words.
let renderedFinalLines = [];
let liveStableWordNodes = [];
let liveMutableNode = null;
let placeholderNode = null;
let previousLiveWords = [];
let frozenLiveWords = [];
function clearProvisionalPrefix() {
  for (const node of liveStableWordNodes) {
    if (transcriptEl.contains(node)) transcriptEl.removeChild(node);
  }
  liveStableWordNodes = [];
  frozenLiveWords = [];
  previousLiveWords = [];
}
function renderTranscript() {
  const samePrefix = renderedFinalLines.length <= finalLines.length &&
    renderedFinalLines.every((line, index) => line === finalLines[index]);
  if (!liveMutableNode || !transcriptEl.contains(liveMutableNode) || !samePrefix) {
    transcriptEl.textContent = '';
    renderedFinalLines = [];
    previousLiveWords = [];
    frozenLiveWords = [];
    liveStableWordNodes = [];
    placeholderNode = document.createTextNode('');
    liveMutableNode = document.createTextNode('');
    transcriptEl.append(placeholderNode, liveMutableNode);
  }
  let newFinalAdded = false;
  for (let i = renderedFinalLines.length; i < finalLines.length; i++) {
    const line = document.createTextNode((i ? '\n' : '') + finalLines[i]);
    transcriptEl.insertBefore(line, liveStableWordNodes[0] || liveMutableNode);
    renderedFinalLines.push(finalLines[i]);
    newFinalAdded = true;
  }
  // Transfer an interim sentence to its final node in the SAME synchronous
  // render pass. No blank intermediate frame, no full transcript replacement.
  // A final replaces only the provisional tail; completed lines stay untouched.
  if (newFinalAdded || !interimText) clearProvisionalPrefix();
  const words = String(interimText || '').split(/\s+/).filter(Boolean);
  let nextFrozen = frozenLiveWords;
  if (words.length && previousLiveWords.length) {
    let match = 0;
    while (match < Math.min(words.length, previousLiveWords.length) &&
           words[match] === previousLiveWords[match]) match++;
    const lockUpTo = Math.max(0, Math.min(match, words.length - 2));
    if (nextFrozen.every((word, i) => word === words[i])) {
      if (lockUpTo > nextFrozen.length) nextFrozen = words.slice(0, lockUpTo);
    } else {
      // Meet can revise its rolling caption. Keep already displayed stable words
      // instead of deleting/repainting them. Only the uncommitted tail changes.
      nextFrozen = frozenLiveWords;
    }
  }
  if (nextFrozen.length > frozenLiveWords.length) {
    for (let i = frozenLiveWords.length; i < nextFrozen.length; i++) {
      const node = document.createTextNode(
        i === 0 ? (finalLines.length ? '\n' : '') + nextFrozen[i] : ' ' + nextFrozen[i]);
      transcriptEl.insertBefore(node, liveMutableNode);
      liveStableWordNodes.push(node);
    }
    frozenLiveWords = nextFrozen;
  }
  // Some Google Meet snapshots temporarily shrink/replace an unfinished row.
  // Avoid blanking or splicing words into previously locked DOM nodes. If
  // a new row is real, the collector emits the old final before the new row.
  const sameDisplayedPrefix = previousLiveWords.every((word, i) => words[i] === word);
  const sameFrozenPrefix = frozenLiveWords.every((word, i) => words[i] === word);
  let displayWords = words;
  if (!sameFrozenPrefix || (previousLiveWords.length && !sameDisplayedPrefix)) {
    // A correction of the last couple of words must not rewrite already
    // printed words. Still append genuinely newer trailing words when the
    // surviving prefix proves it is the same growing caption row.
    let shared = 0;
    while (shared < Math.min(previousLiveWords.length, words.length) &&
           previousLiveWords[shared] === words[shared]) shared++;
    const nearlySameRow = shared >= Math.max(1, previousLiveWords.length - 2);
    displayWords = nearlySameRow && words.length > previousLiveWords.length
      ? previousLiveWords.concat(words.slice(previousLiveWords.length))
      : previousLiveWords;
  }
  previousLiveWords = displayWords;
  const tailWords = displayWords.slice(frozenLiveWords.length);
  const tail = displayWords.length ?
    (frozenLiveWords.length ? ' ' : (finalLines.length ? '\n' : '')) + tailWords.join(' ') : '';
  const placeholder = finalLines.length || displayWords.length ? '' : 'Waiting for host to speak...';
  const changed = newFinalAdded || liveMutableNode.nodeValue !== tail ||
    placeholderNode.nodeValue !== placeholder || nextFrozen.length > frozenLiveWords.length;
  if (liveMutableNode.nodeValue !== tail) liveMutableNode.nodeValue = tail;
  if (placeholderNode.nodeValue !== placeholder) placeholderNode.nodeValue = placeholder;
  if (!changed) return;
  // A single scroll update avoids the old multi-frame jump/flicker.
  if (transcriptAutoScroll) transcriptEl.scrollTop = transcriptEl.scrollHeight;
  else if (!transcriptUserScrollIntent) {
    const maxTop = Math.max(0, transcriptEl.scrollHeight - transcriptEl.clientHeight);
    transcriptEl.scrollTop = Math.min(transcriptScrollTopLock, maxTop);
  }
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
  appEl.classList.add('session-active');
  loginAlert.classList.add('hidden');
  countdownPanel.classList.add('hidden');
  joinPanel.classList.add('hidden');
  livePanel.classList.remove('hidden');
  leaveBtn.classList.remove('hidden');
  backToLiveBtn?.classList.add('hidden');
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
  const sessionInProgress = Boolean(activeSessionToken && currentPanel === 'live');
  loginAlert.classList.add('hidden');
  if (sessionInProgress) {
    statusEl.textContent = 'Google Sign-In opened. Your live transcription remains active.';
  } else {
    showJoin();
    setSessionInfo('Complete Google Sign-In in the opened window. This PIN screen will stay here.', 'ok');
  }
  await window.electronAPI.googleSignIn().catch(() => null);
  setTimeout(() => { signinBtn.disabled = false; }, 1000);
});

if (backToLiveBtn) backToLiveBtn.addEventListener('click', () => {
  if (!activeSessionToken) return showJoin({ force: true });
  showLive('Live session resumed.');
});

if (window.electronAPI.onGoogleSignInComplete) {
  window.electronAPI.onGoogleSignInComplete(() => {
    hideCountdownTimer();
    loginAlert.classList.add('hidden');
    signinBtn.disabled = false;
    if (activeSessionToken) {
      showLive('Google sign-in complete. Live session continues. Close the Google window manually when ready.');
      return;
    }
    showJoin({ force: true });
    setSessionInfo('Google signed in. Close the Google window manually when ready, then enter the 6-digit PIN and click Start Session.', 'ok');
    const pinInput = document.getElementById('sessionPin');
    if (pinInput) requestAnimationFrame(() => { try { pinInput.focus({ preventScroll: true }); } catch (_) { try { pinInput.focus(); } catch (_) {} } });
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  // Do not block captions for a guest who has a valid Zapper PIN. Meet's
  // existing join controller decides whether the meeting admits that guest.
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
    showJoinError(redeemed.error || 'This is not a valid active PIN. Ask the host for a current 6-digit PIN.');
    return;
  }

  activeSessionToken = redeemed.sessionToken;
  activeSessionId = redeemed.sessionId;
  activeMeetUrl = redeemed.meetUrl;
  sessionStartedAt = Date.now();
  transcriptArchive = [];
  transcriptSegments = [];
  finalLines = [];
  interimText = '';
  transcriptAutoScroll = true;
  transcriptScrollTopLock = 0;
  showLive('Session verified. Preparing Google Meet...');

  const res = await window.electronAPI.joinMeet({
    guestName: getRandomGuestName(),
    meetUrl: activeMeetUrl,
    sessionToken: activeSessionToken,
    sessionId: activeSessionId,
  });
  if (!res.success) {
    activeSessionToken = '';
    activeSessionId = '';
    activeMeetUrl = '';
    sessionStartedAt = 0;
    transcriptSegments = [];
    activeGoogleEmail = '';
    if (res.loginRequired) return showLoginRequired(res.error);
    if (res.invalidMeetUrl) return showJoinError(res.error || 'The host session contains an invalid Google Meet URL.');
    return showJoinError(res.error || 'Failed to start the meeting transcription.');
  }
  activeGoogleEmail = String(res.googleEmail || '').trim();
});

async function finalizeActiveSession({
  endBackend = false,
  keepBackgroundCapture = false,
  reason = 'You left this Zapper view. The host session and PIN remain active.'
} = {}) {
  if (finalizingSession) return;
  finalizingSession = true;
  try {
    const endedAt = Date.now();
    const transcriptText = transcriptArchive.join('\n').trim();
    if (activeSessionToken && transcriptText) {
      // Fallback sync only. The backend continuously stores final captions and
      // the host End Session action is the only operation that finalizes the PDF.
      statusEl.textContent = 'Syncing transcript...';
      const saved = await window.electronAPI.saveSessionTranscript({
        sessionToken: activeSessionToken,
        transcriptText,
        transcriptSegments,
        startedAt: sessionStartedAt || endedAt,
        endedAt,
        googleEmail: activeGoogleEmail
      }).catch(e => ({ success: false, error: e.message }));
      if (!saved.success) statusEl.textContent = `Transcript sync warning: ${saved.error || 'Could not sync transcript.'}`;
    }
    if (endBackend && activeSessionToken && window.electronAPI.endBackendSession) {
      await window.electronAPI.endBackendSession(activeSessionToken).catch(() => null);
    }
    if (keepBackgroundCapture && window.electronAPI.detachLiveSession) {
      await window.electronAPI.detachLiveSession().catch(() => null);
    } else {
      await window.electronAPI.leaveMeet();
    }
    finalLines = [];
    transcriptArchive = [];
    transcriptSegments = [];
    interimText = '';
    chatMessages = [];
    activeSessionToken = '';
    activeSessionId = '';
    activeMeetUrl = '';
    sessionStartedAt = 0;
    activeGoogleEmail = '';
    renderTranscript();
    renderMeetChat();
    statusEl.textContent = keepBackgroundCapture ? 'Background capture active' : 'Stopped';
    showJoin();
    setSessionInfo(reason);
    joinBtn.disabled = false;
  } finally {
    finalizingSession = false;
  }
}

leaveBtn.addEventListener('click', async () => finalizeActiveSession({
  endBackend: false,
  keepBackgroundCapture: true,
  reason: 'You left the live view. Transcript capture continues in the background until the host ends this session.'
}));

window.electronAPI.onStatus((msg) => {
  statusEl.textContent = msg;
  if (/google login required|sign-in required|session expired/i.test(msg || '')) showLoginRequired(msg);
});
if (window.electronAPI.onLoginRequired) window.electronAPI.onLoginRequired((msg) => showLoginRequired(msg));
window.electronAPI.onSpeechStart(() => { statusEl.textContent = 'Speech detected...'; });
if (window.electronAPI.onSessionEnded) {
  window.electronAPI.onSessionEnded((message) => {
    finalizeActiveSession({ endBackend: false, reason: message || 'This session is no longer active. Ask the host for a new PIN.' }).catch(() => null);
  });
}
if (window.electronAPI.onTranscriptionSource) {
  window.electronAPI.onTranscriptionSource((source) => setTranscriptionSource(source));
}

// The automatically joined host Meet has a separate, caption-only path.
// It works without an overlay Google login or a second participant PIN.
// A PIN-connected desktop still uses its existing (independent) live view.
window.electronAPI.onHostSessionActive?.(() => {
  if (activeSessionToken) return;
  if (!hostMirrorActive) {
    hostMirrorActive = true;
    transcriptArchive = [];
    transcriptSegments = [];
    finalLines = [];
    interimText = '';
    renderTranscript();
  }
  if (currentPanel !== 'live') showLive('Host Meet captions are live.');
  leaveBtn.classList.add('hidden'); // Host End Session stays in the web portal.
  setTranscriptionSource('meet-captions');
});
window.electronAPI.onHostSessionStopped?.((reason) => {
  if (!hostMirrorActive) return;
  hostMirrorActive = false;
  if (activeSessionToken) return;
  finalLines = [];
  interimText = '';
  transcriptArchive = [];
  transcriptSegments = [];
  renderTranscript();
  showJoin({ force: true });
  setSessionInfo(reason || 'Host session ended.');
});

window.electronAPI.onTranscript(({ text, isFinal, source, origin = '' }) => {
  if (source === 'meet-captions' || source === 'deepgram') setTranscriptionSource(source);
  if (!text) return;
  if (isFinal) {
    const cleanFinal = text.trim();
    const normalizeCaption = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    // After a local -> host relay handoff the same final can arrive twice.
    // Never add/repaint the same finalized sentence within a short window.
    if (origin && lastFinalCaptionOrigin && origin !== lastFinalCaptionOrigin &&
        normalizeCaption(finalLines[finalLines.length - 1]) === normalizeCaption(cleanFinal) &&
        Date.now() - lastFinalCaptionAt < 5000) {
      // A delayed duplicate from the other collector must not erase newer
      // interim speech or force the overlay to blank the last live line.
      return;
    }
    lastFinalCaptionAt = Date.now();
    lastFinalCaptionOrigin = origin;
    // Keep the verbatim recognized final for PDF/backend persistence. For the
    // LIVE VIEW only, do not withdraw a prefix already printed while Meet
    // revises its last couple of provisional words at the sentence boundary.
    let visibleFinal = cleanFinal;
    if (previousLiveWords.length && interimText) {
      const pendingWords = previousLiveWords;
      const finalizedWords = cleanFinal.split(/\s+/).filter(Boolean);
      const lower = word => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      let common = 0;
      while (common < Math.min(pendingWords.length, finalizedWords.length) &&
             lower(pendingWords[common]) === lower(finalizedWords[common])) common++;
      const sameSentence = common >= Math.max(2, Math.ceil(Math.min(pendingWords.length, finalizedWords.length) * 0.7));
      if (sameSentence) {
        // A shorter final cannot retract text; late-added final words can be
        // appended without touching the already visible words.
        visibleFinal = pendingWords.concat(finalizedWords.slice(pendingWords.length)).join(' ');
      }
    }
    transcriptArchive.push(cleanFinal);
    transcriptSegments.push({ text: cleanFinal, at: Date.now() });
    finalLines.push(visibleFinal);
    // If the old final arrives after the NEXT sentence's interim, keep that
    // newer provisional row alive instead of clearing and repainting it.
    const pending = String(interimText || '').trim().toLowerCase();
    const finalized = cleanFinal.toLowerCase();
    const related = !pending || finalized.includes(pending) || pending.includes(finalized);
    if (related) interimText = '';
    // Finalized history is never trimmed while the user scrolls up.
  } else {
    const incoming = text.trim();
    // A delayed caption from another collector must not replace a completed line.
    const normalized = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (finalLines.length && normalized(incoming) === normalized(finalLines[finalLines.length - 1])) return;
    interimText = incoming;
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
    renderMeetChat();
  });
}

// Listen for countdown timer start signal from main process
if (window.electronAPI.onCountdownStart) {
  window.electronAPI.onCountdownStart(() => {
    hideCountdownTimer();
    if (activeSessionToken) {
      showLive('Live session continues. Google Sign-In can be closed manually.');
      return;
    }
    showJoin({ force: true });
    setSessionInfo('Google signed in. Close the Google window manually when ready, then enter the 6-digit PIN and click Start Session.', 'ok');
  });
}

renderMeetChat();

// The portal can launch the host Meet before this overlay renderer has loaded.
// Recover its current active state instead of depending on a one-shot IPC event.
window.electronAPI.getCaptionSessionState?.().then(state => {
  if (state?.hostActive && !activeSessionToken && !hostMirrorActive) {
    hostMirrorActive = true;
    showLive('Host Meet captions are live.');
    leaveBtn.classList.add('hidden');
    renderTranscript();
  }
}).catch(() => {});
