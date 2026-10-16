import { mountHowItWorks } from './how-it-works.jsx';
import { startHostMicrophone, listMicrophones, recordMicrophoneTest } from './host-microphone.js';
import { getDeviceSessionId, selectDeviceSession, saveDeviceSessionId, clearDeviceSessionId } from './host-session-selection.js';
const API_BASE = String(import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const DEFAULT_RELEASE_URL = 'https://github.com/shivanew-hadoop/zapper-downloads/releases/latest/download/Zapper-Setup-x64.exe';
const configuredReleaseUrl = String(import.meta.env.VITE_DESKTOP_DOWNLOAD_URL || '').trim();
// Migrate safely from the old source-repository release URL. This keeps the
// public Download Zapper button working even if Vercel still has the legacy
// zapper-prod release URL cached in its environment settings.
const DESKTOP_DOWNLOAD_URL = (!configuredReleaseUrl || /github\.com\/shivanew-hadoop\/zapper-prod\/releases\//i.test(configuredReleaseUrl))
  ? DEFAULT_RELEASE_URL
  : configuredReleaseUrl;

let mode = 'login';
let token = localStorage.getItem('zapperToken') || '';
let account = null;
let adminUsers = [];
let editingUser = null;
let searchTimer = null;
let currentSessionId = '';
let currentSessionPin = '';
let currentSessionOwnerId = '';
let sessionLoadGeneration = 0;
let hostMicCapture = null;
let hostMicSessionId = '';
let hostMicRequestGeneration = 0;
let activeSessionStartedAt = 0;
let sessionTimerInterval = null;
let microphoneTestRunning = false;
let micTestObjectUrl = '';
let hostSessionCreating = false;

let googleMeetConnected = false;
let googleMeetAvailable = false;
let resetToken = new URLSearchParams(window.location.search).get('reset') || '';
const $ = id => document.getElementById(id);
function finishAuthRestore() { document.documentElement.classList.remove('auth-restoring'); }

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}
function fmt(ms) {
  return ms ? new Date(Number(ms)).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}
function durationLabel(started, ended = Date.now()) {
  const seconds = Math.max(0, Math.floor((Number(ended) - Number(started)) / 1000));
  if (!Number.isFinite(seconds) || !started) return '—';
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
function updateSessionClock() {
  document.querySelectorAll('#otherHostSessions [data-started-at]').forEach(label => {
    label.textContent = durationLabel(Number(label.dataset.startedAt));
  });
  const seconds = activeSessionStartedAt ? Math.max(0, Math.floor((Date.now() - activeSessionStartedAt) / 1000)) : 0;
  const h = Math.floor(seconds / 3600);
  $('sessionClock').textContent = `${h ? `${h}:` : ''}${String(Math.floor(seconds / 60) % (h ? 60 : Infinity)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function stopSessionClock() {
  if (sessionTimerInterval) clearInterval(sessionTimerInterval);
  sessionTimerInterval = null;
  activeSessionStartedAt = 0;
  updateSessionClock();
}
function startSessionClock(startedAt) {
  if (sessionTimerInterval && activeSessionStartedAt === Number(startedAt)) return;
  stopSessionClock();
  activeSessionStartedAt = Number(startedAt) || Date.now();
  startClockDisplay();
}
function startClockDisplay() {
  updateSessionClock();
  if (!sessionTimerInterval) sessionTimerInterval = setInterval(updateSessionClock, 1000); // display only; no network polling
}
function applyCreateSessionAvailability() {
  const enabled = account?.role !== 'admin' && account?.subscriptionStatus === 'active' &&
    !currentSessionId && !hostSessionCreating;
  $('googleMeetCreateBtn').disabled = !enabled;
  $('createSessionBtn').disabled = !enabled;
}
function setMicLevel(level) {
  const percent = Math.max(0, Math.min(100, Math.round((Number(level) || 0) * 140)));
  $('hostMicLevelBar').style.width = `${percent}%`;
  $('hostMicLevel').setAttribute('aria-valuenow', String(percent));
}
async function refreshMicrophoneChoices() {
  const selected = $('hostMicDevice').value || $('hostMicTestDevice').value;
  try {
    const devices = await listMicrophones();
    for (const id of ['hostMicDevice', 'hostMicTestDevice']) {
      const element = $(id);
      element.replaceChildren(...devices.map(device => {
        const option = document.createElement('option');
        option.value = device.deviceId; option.textContent = device.label; return option;
      }));
      if (devices.some(device => device.deviceId === selected)) element.value = selected;
    }
  } catch (_) { /* Labels may remain private until permission is granted. */ }
}
function fmtDate(ms) {
  return ms ? new Date(Number(ms)).toLocaleDateString([], { dateStyle: 'medium' }) : '—';
}
function toLocalInput(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}
function hostMeetStorageKey() {
  const email = String(account?.email || '').trim().toLowerCase();
  return email ? `zapperLastMeetUrl:${email}` : '';
}
function restoreLastMeetUrl() {
  const key = hostMeetStorageKey();
  const input = $('meetUrl');
  if (!key || !input) return;
  const saved = String(localStorage.getItem(key) || '').trim();
  // Always bind the field to the current account. This prevents a Meet URL left
  // in the SPA DOM by a previous host login from leaking into another host.
  input.value = saved;
}
function rememberMeetUrl(value) {
  const key = hostMeetStorageKey();
  const normalized = String(value || '').trim();
  if (!key || !normalized) return;
  localStorage.setItem(key, normalized);
}
async function api(path, opts = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = data.code || '';
    error.data = data;
    throw error;
  }
  return data;
}

function setDownloadLinks() {
  document.querySelectorAll('[data-download]').forEach(link => {
    link.href = DESKTOP_DOWNLOAD_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
}
function launchDesktop() {
  const message = $('launchMessage');
  if (message) {
    message.textContent = 'Opening Zapper. If nothing opens, use Download Zapper and run it once.';
    message.classList.remove('hidden');
  }
  window.location.href = 'zapper://launch';
}
document.querySelectorAll('[data-launch]').forEach(button => button.addEventListener('click', launchDesktop));
setDownloadLinks();
mountHowItWorks();

function refreshHeaderState() {
  const loggedIn = Boolean(token && account);
  ['navLogin', 'mobileLoginBtn'].forEach(id => $(id)?.classList.toggle('hidden', loggedIn));
  ['navSignup', 'mobileSignupBtn'].forEach(id => $(id)?.classList.toggle('hidden', loggedIn));
  ['dashboardBtn', 'mobileDashboardBtn'].forEach(id => $(id)?.classList.toggle('hidden', !loggedIn));
  const hostLoggedIn = loggedIn && account.role !== 'admin';
  $('hostHomeDashboardBtn')?.classList.toggle('hidden', !hostLoggedIn);
  $('homePrimaryActions')?.classList.toggle('hostDashboardVisible', hostLoggedIn);
  ['navLogout', 'mobileLogoutBtn'].forEach(id => $(id)?.classList.toggle('hidden', !loggedIn));
}
function closeMobileNav() {
  $('mobileNav')?.classList.add('hidden');
  $('mobileMenuBtn')?.setAttribute('aria-expanded', 'false');
}
function toggleMobileNav() {
  const panel = $('mobileNav');
  const button = $('mobileMenuBtn');
  if (!panel || !button) return;
  const opening = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !opening);
  button.setAttribute('aria-expanded', opening ? 'true' : 'false');
}
function showPublic(section = '') {
  $('publicSite').classList.remove('hidden');
  $('hostPortal').classList.add('hidden');
  $('adminPortal').classList.add('hidden');
  refreshHeaderState();
  if (section) requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
function hideAuth() { $('authModal').classList.add('hidden'); }
function openAuth(nextMode = 'login') {
  closeMobileNav();
  setMode(nextMode);
  $('authModal').classList.remove('hidden');
  const target = nextMode === 'reset' ? $('password') : $('email');
  setTimeout(() => target?.focus(), 50);
}
function setMode(next) {
  mode = next;
  $('trialWelcomePanel')?.classList.add('hidden');
  $('authForm')?.classList.remove('hidden');
  const loginMode = mode === 'login';
  const registerMode = mode === 'register';
  const forgotMode = mode === 'forgot';
  const resetMode = mode === 'reset';
  $('authTabs').classList.toggle('hidden', forgotMode || resetMode);
  $('loginTab').classList.toggle('active', loginMode);
  $('registerTab').classList.toggle('active', registerMode);
  $('name').classList.toggle('hidden', !registerMode);
  $('email').classList.toggle('hidden', resetMode);
  $('password').classList.toggle('hidden', forgotMode);
  $('resetConfirm').classList.toggle('hidden', !resetMode);
  $('forgotPasswordBtn').classList.toggle('hidden', !loginMode);
  $('backToLoginBtn').classList.toggle('hidden', loginMode || registerMode);
  $('name').required = registerMode;
  $('email').required = !resetMode;
  $('password').required = !forgotMode;
  $('resetConfirm').required = resetMode;
  $('password').autocomplete = loginMode ? 'current-password' : 'new-password';
  $('authSubmit').textContent = loginMode ? 'Login' : registerMode ? 'Create account' : forgotMode ? 'Generate reset link' : 'Set new password';
  $('authTitle').textContent = loginMode ? 'Sign in to Zapper' : registerMode ? 'Create a host account' : forgotMode ? 'Reset your password' : 'Choose a new password';
  $('authLead').textContent = loginMode ? 'Hosts and administrators use the same secure sign-in.' : registerMode ? 'Create your host account and get one free 24-hour trial, starting immediately.' : forgotMode ? 'Enter your registered email. If the account exists, Zapper will generate a secure reset link.' : 'Enter and confirm your new password.';
  $('authError').textContent = '';
  $('authSuccess').textContent = '';
}
function showTrialWelcome(user) {
  // Keep registration separate from login and clear any previous account token.
  token = '';
  account = null;
  localStorage.removeItem('zapperToken');
  refreshHeaderState();
  $('authTabs').classList.add('hidden');
  $('authForm').classList.add('hidden');
  $('trialWelcomePanel').classList.remove('hidden');
  $('authTitle').textContent = 'Account created — trial activated';
  $('authLead').textContent = `${user?.email || 'Your account'} is ready to sign in.`;
  $('trialExpiry').textContent = user?.trialEndsAt ? fmt(user.trialEndsAt) : '24 hours from registration';
  $('authModal').classList.remove('hidden');
}
function logout() {
  stopHostMicrophone('Microphone stopped on logout.', true);
  stopSessionClock();
  closeMobileNav();
  token = ''; account = null; localStorage.removeItem('zapperToken');
  // A session selection belongs to this browser tab and account, never a shared host login.
  currentSessionId = ''; currentSessionPin = ''; currentSessionOwnerId = '';
  ++sessionLoadGeneration;
  hostSessionCreating = false;
  if ($('meetUrl')) $('meetUrl').value = '';
  refreshHeaderState(); showPublic('home');
}
function openPublicSection(section) { closeMobileNav(); showPublic(section); }

$('navLogin').onclick = () => openAuth('login');
$('footerLogin').onclick = () => openAuth('login');
$('navSignup').onclick = () => openAuth('register');
$('pricingSignup').onclick = () => openAuth('register');
$('loginTab').onclick = () => setMode('login');
$('registerTab').onclick = () => setMode('register');
$('forgotPasswordBtn').onclick = () => setMode('forgot');
$('backToLoginBtn').onclick = () => setMode('login');
$('trialBackToLogin').onclick = () => setMode('login');
$('dashboardBtn').onclick = () => loadPortal();
$('hostHomeDashboardBtn').onclick = () => loadPortal();
$('navLogout').onclick = logout;
$('mobileMenuBtn').onclick = toggleMobileNav;
$('mobileLoginBtn').onclick = () => openAuth('login');
$('mobileSignupBtn').onclick = () => openAuth('register');
$('mobileDashboardBtn').onclick = () => { closeMobileNav(); loadPortal(); };
$('mobileLogoutBtn').onclick = logout;
document.querySelectorAll('[data-section]').forEach(el => el.addEventListener('click', () => openPublicSection(el.dataset.section)));
document.querySelectorAll('[data-close-auth]').forEach(el => el.addEventListener('click', hideAuth));
document.getElementById('hostLogout')?.addEventListener('click', logout);
document.getElementById('adminLogout')?.addEventListener('click', logout);

$('authForm').onsubmit = async event => {
  event.preventDefault();
  $('authError').textContent = ''; $('authSuccess').textContent = '';
  try {
    if (mode === 'forgot') {
      const data = await api('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: $('email').value.trim() }) });
      $('authSuccess').innerHTML = escapeHTML(data.message || 'If that email is registered, a reset link has been generated.');
      if (data.resetLink) $('authSuccess').innerHTML += `<br><a href="${escapeHTML(data.resetLink)}">Open reset link</a>`;
      return;
    }
    if (mode === 'reset') {
      if ($('password').value.length < 8) throw new Error('Password must contain at least 8 characters.');
      if ($('password').value !== $('resetConfirm').value) throw new Error('Passwords do not match.');
      const data = await api('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: resetToken, password: $('password').value }) });
      resetToken = ''; history.replaceState({}, '', window.location.pathname);
      setMode('login'); $('authSuccess').textContent = data.message || 'Password updated. Sign in with your new password.';
      return;
    }
    const data = await api(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email: $('email').value.trim(), password: $('password').value, name: $('name').value.trim() }) });
    if (mode === 'register') {
      // Never display 'trial activated' unless the backend returned both dates.
      if (data.user?.subscriptionStatus !== 'active' || !data.user?.subscriptionStartedAt ||
          !data.user?.subscriptionValidUntil || !data.user?.trialEndsAt) {
        throw new Error('Your account was created, but its trial is not active. Please contact Zapper support; do not register again.');
      }
      // Registration succeeds immediately, but sign-in remains a separate step.
      $('email').value = data.user?.email || $('email').value.trim();
      showTrialWelcome(data.user);
      return;
    }
    token = data.token; localStorage.setItem('zapperToken', token); hideAuth(); await loadPortal();
  } catch (error) {
    $('authError').textContent = error.message;
  }
};

async function loadAccount() {
  const data = await api('/api/account');
  account = data.user;
  return data;
}

async function loadHostPortal() {
  const accountId = String(account?.id || '');
  if (currentSessionOwnerId !== accountId) {
    // Do not inherit a previous account's selection when the SPA changes hosts.
    stopHostMicrophone('', true);
    currentSessionId = ''; currentSessionPin = '';
    currentSessionOwnerId = accountId;
  }
  $('publicSite').classList.add('hidden');
  $('adminPortal').classList.add('hidden');
  refreshHeaderState();
  $('hostPortal').classList.remove('hidden');
  $('welcome').textContent = `Welcome${account.name ? `, ${account.name}` : ''}`;
  const start = account.subscriptionStartedAt ? fmt(account.subscriptionStartedAt) : 'not set';
  const until = account.subscriptionValidUntil ? fmt(account.subscriptionValidUntil) : 'not activated';
  const active = account.subscriptionStatus === 'active';
  const onTrial = active && account.trialEndsAt && account.subscriptionValidUntil === account.trialEndsAt;
  $('subText').textContent = `${account.email} · ${onTrial ? 'Free 24-hour trial' : 'Subscription ' + account.subscriptionStatus} · ${start} → ${until}`;
  $('planBadge').textContent = onTrial ? 'Trial active' : active ? 'Active' : account.subscriptionStatus;
  $('planBadge').className = `statusBadge ${active ? 'active' : 'inactive'}`;
  applyCreateSessionAvailability();
  googleMeetConnected = false;
  googleMeetAvailable = false;
  $('autoMeetDetails').classList.add('hidden');
  $('googleMeetCreateBtn').disabled = true;
  $('googleMeetStatus').textContent = active ? 'Checking Google Meet connection…' : 'Your subscription must be active to create a Google Meet.';
  $('manualMeetCreateLink').classList.add('hidden');
  $('sessionError').textContent = !active ? 'Your trial or subscription has ended. Contact the Zapper administrator to renew access.' : '';
  restoreLastMeetUrl();
  await Promise.all([loadSessions(), loadTranscripts()]);
  if (active) void refreshGoogleMeetAvailability();
  window.scrollTo({ top: 0 });
}

// A created Google Meet room is only a link: it cannot supply microphone
// audio by itself. With explicit browser permission, capture the HOST's own
// microphone and use the existing /stt -> Deepgram -> transcript/PDF pipeline.
function updateHostMicButtons(recording = false) {
  $('hostMicToggle').disabled = microphoneTestRunning;
  $('hostMicToggle').textContent = recording ? 'Mute' : 'Unmute';
  $('hostMicToggle').setAttribute('aria-pressed', String(recording));
  $('hostMicTest').disabled = microphoneTestRunning;
}

function stopHostMicrophone(message = '', hide = false) {
  ++hostMicRequestGeneration; // Discard a pending microphone permission request.
  if (hostMicCapture) hostMicCapture.stop();
  hostMicCapture = null;
  if (hide) hostMicSessionId = '';
  updateHostMicButtons();
  setMicLevel(0);
  if (message) $('hostMicStatus').textContent = message;
  if (hide) {
    $('hostMicStatus').classList.add('hidden'); $('micTestReplay').classList.add('hidden');
    $('hostMicTestAudio').pause(); $('hostMicTestAudio').removeAttribute('src');
    if (micTestObjectUrl) URL.revokeObjectURL(micTestObjectUrl);
    micTestObjectUrl = '';
  }
}

function showHostMicPanel(session) {
  if (!session?.googleCreated || session?.status !== 'active' || session?.active === false) {
    stopHostMicrophone('', true);
    return;
  }
  if (hostMicSessionId && hostMicSessionId !== session.id) stopHostMicrophone('', true);
  hostMicSessionId = session.id;
  $('sessionToolbar').classList.remove('hidden');
  updateHostMicButtons(Boolean(hostMicCapture));
  if (!hostMicCapture && !$('hostMicStatus').textContent.trim()) {
    $('hostMicStatus').textContent = 'Unmute to transmit your voice to PIN-connected participants.';
  }
}

async function startHostMicForSession(sessionId) {
  if (!sessionId || hostMicCapture && hostMicSessionId === sessionId) return;
  // Stop any previous recording, without changing the session/PIN lifecycle.
  stopHostMicrophone();
  hostMicSessionId = sessionId;
  const generation = ++hostMicRequestGeneration;
  $('sessionToolbar').classList.remove('hidden');
  $('hostMicToggle').disabled = true;
  $('hostMicToggle').textContent = 'Connecting…';
  $('hostMicStatus').classList.remove('hidden');
  $('hostMicStatus').textContent = 'Waiting for microphone permission. Your camera will not be used.';
  try {
    const capture = await startHostMicrophone({
      apiBase: API_BASE,
      sessionId,
      deviceId: $('hostMicDevice').value,
      onLevel: level => { if (generation === hostMicRequestGeneration) setMicLevel(level); },
      fetchCaptureToken: async id => (await api(`/api/sessions/${encodeURIComponent(id)}/host-audio-token`, { method: 'POST' })).captureToken,
      // Live captions continue through the API relay and saved PDF pipeline.
      // They are intentionally not rendered in the host dashboard.
      onStatus: text => {
        if (generation !== hostMicRequestGeneration) return;
        $('hostMicStatus').textContent = /(?:connected|active|listening)/i.test(text)
          ? 'Microphone active. Speech is sent to PIN devices and saved for PDF.'
          : text;
      },
      onStopped: reason => {
        if (generation !== hostMicRequestGeneration) return;
        hostMicCapture = null;
        updateHostMicButtons();
        if (reason) $('hostMicStatus').textContent = reason;
      },
    });
    if (generation !== hostMicRequestGeneration || hostMicSessionId !== sessionId) {
      capture.stop();
      return;
    }
    hostMicCapture = capture;
    void refreshMicrophoneChoices();
    updateHostMicButtons(true);
  } catch (error) {
    if (generation !== hostMicRequestGeneration) return;
    hostMicCapture = null;
    updateHostMicButtons();
    $('hostMicStatus').textContent = error.name === 'NotAllowedError'
      ? 'Microphone permission was denied. Allow the microphone for zapperapp.in in your browser, then click Unmute.'
      : `Microphone could not start: ${error.message}`;
  }
}

$('hostMicToggle').onclick = () => {
  if (hostMicCapture) stopHostMicrophone('Microphone muted. Your speech is not transmitted. The session PIN remains active.');
  else if (hostMicSessionId) void startHostMicForSession(hostMicSessionId);
};

function selectMicrophoneForThisBrowser(deviceId) {
  $('hostMicDevice').value = deviceId;
  $('hostMicTestDevice').value = deviceId;
  if (microphoneTestRunning || !hostMicSessionId || !hostMicCapture) return;
  const selectedSession = hostMicSessionId;
  stopHostMicrophone('Switching microphone…');
  void startHostMicForSession(selectedSession);
}
$('hostMicDevice').addEventListener('change', () => selectMicrophoneForThisBrowser($('hostMicDevice').value));
$('hostMicTestDevice').addEventListener('change', () => selectMicrophoneForThisBrowser($('hostMicTestDevice').value));
if (navigator.mediaDevices?.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => void refreshMicrophoneChoices());
void refreshMicrophoneChoices();
$('hostMicTest').onclick = async () => {
  if (microphoneTestRunning) return;
  if (hostMicCapture) stopHostMicrophone('Microphone muted for test; click Unmute after testing.');
  const testedSessionId = hostMicSessionId;
  microphoneTestRunning = true;
  $('hostMicTest').disabled = true;
  $('hostMicToggle').disabled = true;
  $('micTestReplay').classList.remove('hidden');
  $('micTestStatus').textContent = 'Speak normally for 2.5 seconds…';
  $('hostMicReplay').disabled = true;
  try {
    const clip = await recordMicrophoneTest({ deviceId: $('hostMicTestDevice').value, onLevel: setMicLevel });
    if (testedSessionId !== hostMicSessionId) return; // Session ended or this tab switched rooms.
    if (micTestObjectUrl) URL.revokeObjectURL(micTestObjectUrl);
    micTestObjectUrl = URL.createObjectURL(clip);
    $('hostMicTestAudio').src = micTestObjectUrl;
    $('hostMicReplay').disabled = false;
    $('micTestStatus').textContent = 'Recorded locally. Click Replay test to check microphone clarity.';
    await refreshMicrophoneChoices();
  } catch (error) {
    $('micTestStatus').textContent = `Microphone test failed: ${error.message}`;
  } finally {
    microphoneTestRunning = false;
    updateHostMicButtons();
    setMicLevel(0);
  }
};
$('hostMicReplay').onclick = () => { if (micTestObjectUrl) $('hostMicTestAudio').play().catch(() => { $('micTestStatus').textContent = 'Audio playback was blocked by the browser.'; }); };

async function endHostSession(sessionId, pin = '', button = null) {
  if (!sessionId) return false;
  const label = pin ? `PIN ${pin}` : 'this session';
  // Cancel must not disable the End Session button or touch the active PIN.
  if (!window.confirm(`End ${label}? The PIN will become invalid immediately.`)) return false;
  if (button) button.disabled = true;
  try {
    await api(`/api/sessions/${encodeURIComponent(sessionId)}/end`, { method: 'POST' });
    if (hostMicSessionId === sessionId) stopHostMicrophone('Session ended. Microphone stopped.', true);
    if (currentSessionId === sessionId) {
      $('pinStatus').textContent = 'Session ended. This PIN is no longer valid.';
      $('endCurrentSession').disabled = true;
      $('sessionToolbar').classList.add('hidden');
      $('micTestReplay').classList.add('hidden');
      stopSessionClock();
      currentSessionId = ''; currentSessionPin = '';
      clearDeviceSessionId(localStorage, account?.id);
      clearDeviceSessionId(sessionStorage, account?.id);
    }
    await loadSessions();
    return true;
  } catch (error) {
    if (button) button.disabled = false;
    throw error;
  }
}

function focusDeviceSession(session, startMicrophone = false) {
  if (currentSessionId && currentSessionId !== session.id) stopHostMicrophone('', true);
  currentSessionId = session.id;
  currentSessionPin = session.pin;
  saveDeviceSessionId(localStorage, account?.id, session.id);
  saveDeviceSessionId(sessionStorage, account?.id, session.id); // one-time v4.1.6 compatibility
  $('pinValue').textContent = session.pin;
  startSessionClock(session.createdAt);
  $('sessionToolbar').classList.remove('hidden');
  $('pinMeet').textContent = session.meetUrl;
  showAutoMeetUrl(session);
  showHostMicPanel(session);
  if (startMicrophone && session.googleCreated) void startHostMicForSession(session.id);
  $('pinStatus').textContent = 'Active — this PIN stays valid until you click End Session.';
  $('endCurrentSession').disabled = false;
  $('pinBox').classList.remove('hidden');
  applyCreateSessionAvailability();
}

function showOtherActiveSessions(sessions, selectedId) {
  const ordered = [...sessions].sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
  const others = ordered.filter(session => session.active !== false && session.status === 'active' && session.id !== selectedId);
  $('otherSessionsPanel').classList.toggle('hidden', others.length === 0);
  $('otherHostSessions').innerHTML = others.map(session => `
    <div class="otherSessionRow"><strong>Session ${ordered.indexOf(session) + 1}</strong><span>In progress</span><time data-started-at="${Number(session.createdAt) || 0}">${escapeHTML(durationLabel(session.createdAt))}</time></div>
  `).join('');
  if (others.length) startClockDisplay();
}

async function loadSessions() {
  const generation = ++sessionLoadGeneration;
  const ownerId = String(account?.id || '');
  const data = await api('/api/sessions');
  if (generation !== sessionLoadGeneration || ownerId !== String(account?.id || '')) return;
  const sessions = data.sessions || [];
  if (data.usage) $('hostCallSummary').textContent = `${data.usage.sessionCount} calls · ${data.usage.callDurationMinutes} total minutes used`;
  // Persist one active room per browser profile/device. Other computers have
  // independent browser storage even when they use the same Zapper login.
  // The old sessionStorage key is honored once when upgrading from v4.1.6.
  const savedId = getDeviceSessionId(localStorage, account?.id);
  const selectedId = savedId || currentSessionId || getDeviceSessionId(sessionStorage, account?.id);
  const selected = selectDeviceSession(sessions, selectedId);
  if (selected) {
    focusDeviceSession(selected);
  } else {
    if (savedId || currentSessionId || selectedId) {
      clearDeviceSessionId(localStorage, account?.id);
      clearDeviceSessionId(sessionStorage, account?.id);
      currentSessionId = ''; currentSessionPin = '';
    }
    stopHostMicrophone('', true);
    $('pinBox').classList.add('hidden');
    $('sessionToolbar').classList.add('hidden');
    stopSessionClock();
    $('autoMeetDetails').classList.add('hidden');
  }
  showOtherActiveSessions(sessions, selected?.id || '');
  // Other running calls are status-only: no PIN copy, switching, or End Session
  // buttons outside the current device's Create Session controls.
  $('sessions').replaceChildren();
  applyCreateSessionAvailability();
}

async function loadTranscripts() {
  const data = await api('/api/transcripts');
  $('transcripts').innerHTML = data.sessions.length ? `<div class="savedSectionLabel">Completed calls & PDFs</div>` + data.sessions.map(session => `
    <div class="dataRow">
      <div><strong>${escapeHTML(fmt(session.startedAt))} → ${escapeHTML(fmt(session.endedAt))}</strong><div class="meta"><span>PIN ${escapeHTML(session.pin)}</span><span>Call ${escapeHTML(durationLabel(session.startedAt, session.endedAt))}</span></div></div>
      <button class="ghostBtn compact" data-pdf="${escapeHTML(session.id)}" type="button">Download PDF</button>
    </div>`).join('') : '<p class="empty">No saved transcripts yet.</p>';
  $('transcripts').querySelectorAll('[data-pdf]').forEach(button => {
    button.onclick = async () => {
      const response = await fetch(`${API_BASE}/api/transcripts/${encodeURIComponent(button.dataset.pdf)}/pdf`, { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        alert(data.error || 'Could not download PDF.');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="?([^";]+)"?/i);
      anchor.download = match?.[1] || 'Zapper-Transcript.pdf';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    };
  });
}

async function refreshGoogleMeetAvailability() {
  const eligible = account?.role !== 'admin' && account?.subscriptionStatus === 'active';
  try {
    const data = await api('/api/google/meet/status');
    googleMeetAvailable = Boolean(data.enabled);
    googleMeetConnected = Boolean(data.enabled && data.connected);
    applyCreateSessionAvailability();
    $('manualMeetCreateLink').classList.toggle('hidden', googleMeetAvailable || !eligible);
    document.querySelector('.meetManualOption')?.classList.toggle('hidden', googleMeetAvailable || !eligible);
    $('googleMeetStatus').classList.toggle('visuallyHidden', googleMeetAvailable && eligible);
    $('googleMeetStatus').textContent = !eligible
      ? 'Your trial or subscription must be active to create a session.'
      : googleMeetAvailable
        ? (googleMeetConnected
          ? 'Your Google account is connected to this host profile. New sessions do not require another Google login unless Google requests it.'
          : 'Click Create Session to connect your own Google account. Zapper and Google sign-ins remain separate.')
        : 'Automatic meeting creation needs a one-time Google OAuth configuration for Zapper (not a shared Google account). You can open Google Meet with your own account now, but must copy the link into the manual field below.';
  } catch (_) {
    googleMeetAvailable = false;
    googleMeetConnected = false;
    applyCreateSessionAvailability();
    $('manualMeetCreateLink').classList.toggle('hidden', !eligible);
    document.querySelector('.meetManualOption')?.classList.toggle('hidden', !eligible);
    $('googleMeetStatus').classList.remove('visuallyHidden');
    $('googleMeetStatus').textContent = eligible
      ? 'Automatic meeting creation is unavailable on this backend. You can open Google Meet with your own account and paste the link below.'
      : 'Your trial or subscription must be active to create a session.';
  }
}

function showAutoMeetUrl(session) {
  const generated = session?.googleCreated === true;
  $('autoMeetDetails').classList.toggle('hidden', !generated);
  if (!generated) return;
  $('autoMeetUrl').value = session.meetUrl;
  $('openAutoMeet').href = session.meetUrl;
}

function showCreatedSession(session) {
  focusDeviceSession(session, true);
  // The manual fallback keeps its own editable link; Google-created links
  // are displayed separately in the non-editable field above.
  if (!session.googleCreated) {
    $('meetUrl').value = session.meetUrl;
    rememberMeetUrl(session.meetUrl);
  }
  $('pinStatus').textContent = 'Active — share your six-digit PIN with Zapper participants.';
  $('endCurrentSession').disabled = false;
  $('pinBox').classList.remove('hidden');
  applyCreateSessionAvailability();
}

$('googleMeetCreateBtn').onclick = async () => {
  if (currentSessionId || getDeviceSessionId(localStorage, account?.id) || hostSessionCreating) return;
  $('sessionError').textContent = '';
  if (!googleMeetAvailable) {
    // A signed-in Google browser session cannot authorize cross-origin Meet API
    // access. This is a transparent assisted/manual path, never fake automation.
    const manual = document.querySelector('.meetManualOption');
    if (manual) manual.open = true;
    $('googleMeetStatus').textContent = 'Google Meet is opening in another tab. Sign in with your own Google account, create a meeting, then copy its link into the field below to generate your Zapper PIN. The link cannot be copied automatically without Google OAuth setup.';
    window.open('https://meet.google.com/new', '_blank', 'noopener,noreferrer');
    return;
  }
  const button = $('googleMeetCreateBtn');
  // Open before fetch only for a first-time Google connection: mobile and
  // desktop browsers may block popups started after an async request.
  const popup = googleMeetConnected ? null : window.open('about:blank', '_blank');
  if (!googleMeetConnected && !popup) {
    $('sessionError').textContent = 'Please allow the Google sign-in popup from Zapper.';
    return;
  }
  if (popup) popup.document.body.textContent = 'Connecting to Google…';
  hostSessionCreating = true;
  applyCreateSessionAvailability();
  const requestId = crypto.randomUUID();
  const expectedOrigin = new URL(API_BASE).origin;
  button.disabled = true;
  let finished = false;
  const onResult = async event => {
    if (finished || !popup || event.origin !== expectedOrigin || event.source !== popup ||
        event.data?.type !== 'zapper-google-meet-result' || event.data?.requestId !== requestId) return;
    finished = true;
    if (popupWatcher) clearInterval(popupWatcher);
    hostSessionCreating = false;
    window.removeEventListener('message', onResult);
    applyCreateSessionAvailability();
    if (!event.data.ok) {
      $('sessionError').textContent = event.data.error || 'Google Meet could not be created.';
      if (event.data.code === 'SUBSCRIPTION_INACTIVE') await loadAccount().then(loadHostPortal).catch(() => {});
      return;
    }
    showCreatedSession({ ...event.data.session, googleCreated: true });
    googleMeetConnected = false; // status will reflect whether Google returned a reusable refresh token
    await refreshGoogleMeetAvailability();
    await loadSessions().catch(error => { $('sessionError').textContent = error.message; });
  };
  if (popup) window.addEventListener('message', onResult);
  const popupWatcher = popup ? setInterval(() => {
    if (finished || !popup.closed) return;
    finished = true;
    hostSessionCreating = false;
    clearInterval(popupWatcher);
    window.removeEventListener('message', onResult);
    applyCreateSessionAvailability();
  }, 800) : null;
  try {
    const result = await api('/api/google/meet/start', { method: 'POST', body: JSON.stringify({ requestId }) });
    if (result.session) {
      // Saved Google connection: backend already created the room and PIN.
      finished = true;
      if (popupWatcher) clearInterval(popupWatcher);
      hostSessionCreating = false;
      window.removeEventListener('message', onResult);
      showCreatedSession({ ...result.session, googleCreated: true });
      await loadSessions();
      return;
    }
    if (result.requiresGoogleSignIn && result.url) {
      // Google is in charge of the popup; release the temporary UI lock if
      // the user closes the popup without finishing authorization.
      googleMeetConnected = false;
      if (popup) {
        popup.location.replace(result.url);
      } else {
        // The refresh token expired; a synchronous popup on the next click
        // avoids popup blockers and keeps the current page/session intact.
        $('sessionError').textContent = 'Google needs to reconnect. Click Create Session again to sign in.';
      }
      return;
    }
    throw new Error('Google Meet did not return a session or sign-in request.');
  } catch (error) {
    finished = true;
    if (popupWatcher) clearInterval(popupWatcher);
    hostSessionCreating = false;
    window.removeEventListener('message', onResult);
    $('sessionError').textContent = error.message;
    if (error.code === 'SUBSCRIPTION_INACTIVE') await loadAccount().then(loadHostPortal).catch(() => {});
  } finally {
    if (popup && finished) popup.close();
    applyCreateSessionAvailability();
  }
};

$('meetUrl').addEventListener('input', () => rememberMeetUrl($('meetUrl').value));
$('sessionForm').onsubmit = async event => {
  event.preventDefault();
  if (currentSessionId || getDeviceSessionId(localStorage, account?.id) || hostSessionCreating) return;
  hostSessionCreating = true;
  applyCreateSessionAvailability();
  $('sessionError').textContent = '';
  try {
    const requestedMeetUrl = $('meetUrl').value.trim();
    rememberMeetUrl(requestedMeetUrl);
    const data = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ meetUrl: requestedMeetUrl }) });
    showCreatedSession(data.session);
    await loadSessions();
  } catch (error) {
    $('sessionError').textContent = error.message;
    if (error.code === 'SUBSCRIPTION_INACTIVE') await loadAccount().then(loadHostPortal).catch(() => {});
  } finally {
    hostSessionCreating = false;
    applyCreateSessionAvailability();
  }
};
$('copyPin').onclick = async () => {
  const pin = $('pinValue').textContent.trim();
  if (/^\d{6}$/.test(pin)) await navigator.clipboard.writeText(pin);
  $('copyPin').title = 'PIN copied'; setTimeout(() => { $('copyPin').title = 'Copy six-digit PIN'; }, 1200);
};
$('endCurrentSession').onclick = async () => {
  if (!currentSessionId) return;
  try { await endHostSession(currentSessionId, currentSessionPin, $('endCurrentSession')); }
  catch (error) { $('sessionError').textContent = error.message; }
};
$('refreshTranscripts').onclick = async () => { await Promise.all([loadSessions(), loadTranscripts()]); };
window.addEventListener('storage', event => {
  if (!account || event.key !== `zapperHostSession:${account.id}`) return;
  if (!$('hostPortal').classList.contains('hidden')) void loadSessions().catch(() => {});
});

function monthEquivalent(start, end) {
  if (!start || !end || end <= start) return '—';
  const days = (end - start) / 86400000;
  return `${(days / 30.4375).toFixed(1)} mo`;
}

async function loadAdminUsers(query = '') {
  const suffix = query ? `?q=${encodeURIComponent(query)}` : '';
  const data = await api(`/api/admin/users${suffix}`);
  adminUsers = data.users || [];
  $('adminUserCount').textContent = String(adminUsers.length);
  $('adminActiveCount').textContent = String(adminUsers.filter(user => user.subscriptionStatus === 'active').length);
  $('adminSessionCount').textContent = String(adminUsers.reduce((sum, user) => sum + Number(user.sessionCount || 0), 0));
  $('adminUsers').innerHTML = adminUsers.length ? `
    <table class="adminTable"><thead><tr><th>User</th><th>Subscription</th><th>Activity</th><th>Account</th><th></th></tr></thead><tbody>
      ${adminUsers.map(user => `<tr>
        <td><strong>${escapeHTML(user.name || 'Unnamed')}</strong><small>${escapeHTML(user.email)}</small><small>${escapeHTML(user.role)}</small></td>
        <td><span class="statusBadge ${user.subscriptionStatus === 'active' ? 'active' : 'inactive'}">${escapeHTML(user.subscriptionStatus)}</span><small>${escapeHTML(fmt(user.subscriptionStartedAt))} → ${escapeHTML(fmt(user.subscriptionValidUntil))}</small><small>${escapeHTML(user.trialEndsAt && user.subscriptionValidUntil === user.trialEndsAt ? 'One-time 24-hour trial' : monthEquivalent(user.subscriptionStartedAt, user.subscriptionValidUntil))}</small></td>
        <td><span>${user.sessionCount} sessions · ${user.transcriptCount} PDFs · ${escapeHTML(user.callDurationMinutes)} min calls</span><small>Last: ${escapeHTML(fmt(user.lastActivityAt))}</small></td>
        <td><span class="pill">${escapeHTML(user.status)}</span><small>Joined ${escapeHTML(fmtDate(user.createdAt))}</small></td>
        <td><button class="ghostBtn compact" data-edit-user="${user.id}" type="button">Manage</button></td>
      </tr>`).join('')}
    </tbody></table>` : '<p class="empty">No users found.</p>';
  $('adminUsers').querySelectorAll('[data-edit-user]').forEach(button => button.onclick = () => openAdminEdit(Number(button.dataset.editUser)));
}

async function loadAdminPortal() {
  $('publicSite').classList.add('hidden');
  $('hostPortal').classList.add('hidden');
  refreshHeaderState();
  $('adminPortal').classList.remove('hidden');
  $('adminWelcome').textContent = `Welcome${account.name ? `, ${account.name}` : ''}`;
  await loadAdminUsers();
  window.scrollTo({ top: 0 });
}

async function openAdminEdit(userId) {
  editingUser = adminUsers.find(user => Number(user.id) === Number(userId));
  if (!editingUser) return;
  $('editUserTitle').textContent = editingUser.name || editingUser.email;
  $('editUserMeta').textContent = `${editingUser.email} · ${editingUser.sessionCount} sessions · ${editingUser.callDurationMinutes} minutes · ${editingUser.transcriptCount} transcripts`;
  $('editSubStatus').value = editingUser.subscriptionStatus === 'active' ? 'active' : 'inactive';
  $('editAccountStatus').value = ['active', 'disabled'].includes(editingUser.status) ? editingUser.status : 'active';
  $('editStart').value = toLocalInput(editingUser.subscriptionStartedAt || null);
  $('editEnd').value = toLocalInput(editingUser.subscriptionValidUntil || null);
  $('editError').textContent = '';
  $('adminNewPassword').value = '';
  $('adminPasswordStatus').textContent = '';
  $('editActivity').textContent = 'Loading...';
  $('adminEditModal').classList.remove('hidden');
  try {
    const activity = await api(`/api/admin/users/${editingUser.id}/activity`);
    $('editActivity').innerHTML = `
      <div class="activityStats"><span><strong>${activity.sessions.length}</strong> retained sessions</span><span><strong>${activity.transcripts.length}</strong> retained PDFs</span></div>
      <div class="activityList">${activity.sessions.map(s => `<div><strong>PIN ${escapeHTML(s.pin)} · ${escapeHTML(durationLabel(s.createdAt, s.active ? Date.now() : (s.endedAt || Date.now())))} call</strong><span>${escapeHTML(fmt(s.createdAt))}</span><small>${escapeHTML(s.meetUrl)}</small></div>`).join('') || '<p class="empty">No session activity.</p>'}</div>`;
  } catch (error) { $('editActivity').textContent = error.message; }
}
function closeAdminEdit() { $('adminEditModal').classList.add('hidden'); editingUser = null; }
document.querySelectorAll('[data-close-admin]').forEach(el => el.addEventListener('click', closeAdminEdit));

function adjustEnd(days) {
  const current = fromLocalInput($('editEnd').value) || Date.now();
  $('editEnd').value = toLocalInput(current + days * 86400000);
}
$('minus30').onclick = () => adjustEnd(-30);
$('plus30').onclick = () => adjustEnd(30);
$('saveUser').onclick = async () => {
  if (!editingUser) return;
  $('editError').textContent = '';
  try {
    await api(`/api/admin/users/${editingUser.id}/subscription`, {
      method: 'POST',
      body: JSON.stringify({ subscriptionStatus: $('editSubStatus').value, startedAt: fromLocalInput($('editStart').value), validUntil: fromLocalInput($('editEnd').value) }),
    });
    if (editingUser.role !== 'admin') {
      await api(`/api/admin/users/${editingUser.id}/status`, { method: 'POST', body: JSON.stringify({ status: $('editAccountStatus').value }) });
    }
    closeAdminEdit();
    await loadAdminUsers($('adminSearch').value.trim());
  } catch (error) { $('editError').textContent = error.message; }
};
$('adminResetPassword').onclick = async () => {
  if (!editingUser) return;
  $('adminPasswordStatus').textContent = ''; $('editError').textContent = '';
  const password = $('adminNewPassword').value;
  if (password.length < 8) { $('editError').textContent = 'New password must contain at least 8 characters.'; return; }
  try {
    const data = await api(`/api/admin/users/${editingUser.id}/password`, { method: 'POST', body: JSON.stringify({ password }) });
    $('adminNewPassword').value = ''; $('adminPasswordStatus').textContent = data.message || 'Password reset successfully.';
  } catch (error) { $('editError').textContent = error.message; }
};
$('adminSearch').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadAdminUsers($('adminSearch').value.trim()).catch(error => alert(error.message)), 300);
});
$('refreshAdmin').onclick = () => loadAdminUsers($('adminSearch').value.trim());

async function loadPortal() {
  try {
    await loadAccount();
    hideAuth();
    if (account.role === 'admin') await loadAdminPortal();
    else await loadHostPortal();
    finishAuthRestore();
  } catch (error) {
    token = '';
    account = null;
    localStorage.removeItem('zapperToken');
    showPublic();
    openAuth('login');
    $('authError').textContent = error.message;
    finishAuthRestore();
  }
}

refreshHeaderState();
if (resetToken) { showPublic('home'); openAuth('reset'); finishAuthRestore(); }
else if (token) loadPortal();
else { showPublic('home'); finishAuthRestore(); }
