import { mountHowItWorks } from './how-it-works.jsx';
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
let resetToken = new URLSearchParams(window.location.search).get('reset') || '';
const $ = id => document.getElementById(id);
function finishAuthRestore() { document.documentElement.classList.remove('auth-restoring'); }

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}
function fmt(ms) {
  return ms ? new Date(Number(ms)).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
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
  closeMobileNav();
  token = ''; account = null; localStorage.removeItem('zapperToken');
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
  $('createSessionBtn').disabled = !active;
  $('googleMeetCreateBtn').disabled = true;
  $('googleMeetStatus').textContent = active ? 'Checking Google Meet connection…' : 'Your subscription must be active to create a Google Meet.';
  $('sessionError').textContent = !active ? 'Your trial or subscription has ended. Contact the Zapper administrator to renew access.' : '';
  restoreLastMeetUrl();
  await Promise.all([loadSessions(), loadTranscripts()]);
  if (active) void refreshGoogleMeetAvailability();
  window.scrollTo({ top: 0 });
}

async function endHostSession(sessionId, pin = '') {
  if (!sessionId) return;
  const label = pin ? `PIN ${pin}` : 'this session';
  if (!window.confirm(`End ${label}? The PIN will become invalid immediately.`)) return;
  await api(`/api/sessions/${encodeURIComponent(sessionId)}/end`, { method: 'POST' });
  if (currentSessionId === sessionId) {
    $('pinStatus').textContent = 'Session ended. This PIN is no longer valid.';
    $('endCurrentSession').disabled = true;
    currentSessionId = '';
  }
  await loadSessions();
}

async function loadSessions() {
  const data = await api('/api/sessions');
  const activeSession = (data.sessions || []).find(session => session.active !== false && session.status === 'active');
  if (activeSession) {
    currentSessionId = activeSession.id;
    currentSessionPin = activeSession.pin;
    $('pinValue').textContent = activeSession.pin;
    $('pinMeet').textContent = activeSession.meetUrl;
    $('pinStatus').textContent = 'Active — this PIN stays valid until you click End Session.';
    $('endCurrentSession').disabled = false;
    $('pinBox').classList.remove('hidden');
  } else if (!currentSessionId) {
    $('pinBox').classList.add('hidden');
  }
  $('sessions').innerHTML = data.sessions.length ? data.sessions.map(session => {
    const active = session.active !== false && session.status === 'active';
    return `
    <div class="dataRow">
      <div><strong>PIN ${escapeHTML(session.pin)}</strong><div class="meta"><span>${escapeHTML(session.meetUrl)}</span><span class="pill">${escapeHTML(session.status)}</span>${session.endReason ? `<span>${escapeHTML(session.endReason)}</span>` : ''}<span>${escapeHTML(fmt(session.createdAt))}</span></div></div>
      <div class="rowActions">
        ${active ? `<button class="ghostBtn compact" data-copy="${escapeHTML(session.pin)}" type="button">Copy PIN</button><button class="dangerBtn compact" data-end="${escapeHTML(session.id)}" data-pin="${escapeHTML(session.pin)}" type="button">End Session</button>` : '<span class="endedLabel">Ended</span>'}
      </div>
    </div>`;
  }).join('') : '<p class="empty">No sessions yet.</p>';
  $('sessions').querySelectorAll('[data-copy]').forEach(button => {
    button.onclick = async () => {
      await navigator.clipboard.writeText(button.dataset.copy);
      const old = button.textContent; button.textContent = 'Copied'; setTimeout(() => { button.textContent = old; }, 1200);
    };
  });
  $('sessions').querySelectorAll('[data-end]').forEach(button => {
    button.onclick = async () => {
      button.disabled = true;
      try { await endHostSession(button.dataset.end, button.dataset.pin); }
      catch (error) { alert(error.message); button.disabled = false; }
    };
  });
}

async function loadTranscripts() {
  const data = await api('/api/transcripts');
  $('transcripts').innerHTML = data.sessions.length ? data.sessions.map(session => `
    <div class="dataRow">
      <div><strong>${escapeHTML(fmt(session.startedAt))} → ${escapeHTML(fmt(session.endedAt))}</strong><div class="meta"><span>PIN ${escapeHTML(session.pin)}</span><span>${escapeHTML(session.meetUrl)}</span>${session.googleEmail ? `<span>${escapeHTML(session.googleEmail)}</span>` : ''}</div></div>
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
  try {
    const data = await api('/api/google/meet/status');
    const eligible = account?.role !== 'admin' && account?.subscriptionStatus === 'active';
    $('googleMeetCreateBtn').disabled = !(data.enabled && eligible);
    $('googleMeetStatus').textContent = data.enabled
      ? 'Ready. Google will ask you to sign in and authorize meeting creation.'
      : 'Google Meet automatic creation needs OAuth setup by the administrator. You can still use the manual link below.';
  } catch (_) {
    $('googleMeetCreateBtn').disabled = true;
    $('googleMeetStatus').textContent = 'Automatic Google Meet is unavailable on this backend. The manual Meet link still works.';
  }
}

function showCreatedSession(session) {
  currentSessionId = session.id;
  currentSessionPin = session.pin;
  $('pinValue').textContent = session.pin;
  $('pinMeet').textContent = session.meetUrl;
  $('meetUrl').value = session.meetUrl;
  rememberMeetUrl(session.meetUrl);
  $('pinStatus').textContent = 'Active — share your six-digit PIN with Zapper participants.';
  $('endCurrentSession').disabled = false;
  $('pinBox').classList.remove('hidden');
}

$('googleMeetCreateBtn').onclick = async () => {
  $('sessionError').textContent = '';
  const button = $('googleMeetCreateBtn');
  // Open synchronously on the click to avoid popup blockers, before awaiting fetch.
  const popup = window.open('about:blank', '_blank');
  if (!popup) {
    $('sessionError').textContent = 'Please allow popups from Zapper so you can sign in with Google.';
    return;
  }
  popup.document.body.textContent = 'Connecting to Google Meet…';
  const requestId = crypto.randomUUID();
  const expectedOrigin = new URL(API_BASE).origin;
  button.disabled = true;
  let finished = false;
  const onResult = async event => {
    if (finished || event.origin !== expectedOrigin || event.source !== popup ||
        event.data?.type !== 'zapper-google-meet-result' || event.data?.requestId !== requestId) return;
    finished = true;
    window.removeEventListener('message', onResult);
    button.disabled = false;
    if (!event.data.ok) {
      $('sessionError').textContent = event.data.error || 'Google Meet could not be created.';
      if (event.data.code === 'SUBSCRIPTION_INACTIVE') await loadAccount().then(loadHostPortal).catch(() => {});
      return;
    }
    showCreatedSession(event.data.session);
    await loadSessions().catch(error => { $('sessionError').textContent = error.message; });
  };
  window.addEventListener('message', onResult);
  try {
    const result = await api('/api/google/meet/start', { method: 'POST', body: JSON.stringify({ requestId }) });
    popup.location.replace(result.url);
  } catch (error) {
    finished = true;
    window.removeEventListener('message', onResult);
    popup.close();
    button.disabled = false;
    $('sessionError').textContent = error.message;
    if (error.code === 'SUBSCRIPTION_INACTIVE') await loadAccount().then(loadHostPortal).catch(() => {});
  }
};

$('meetUrl').addEventListener('input', () => rememberMeetUrl($('meetUrl').value));
$('sessionForm').onsubmit = async event => {
  event.preventDefault();
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
  }
};
$('copyPin').onclick = async () => {
  const pin = $('pinValue').textContent.trim();
  if (/^\d{6}$/.test(pin)) await navigator.clipboard.writeText(pin);
  $('copyPin').textContent = 'Copied'; setTimeout(() => { $('copyPin').textContent = 'Copy PIN'; }, 1200);
};
$('endCurrentSession').onclick = async () => {
  if (!currentSessionId) return;
  $('endCurrentSession').disabled = true;
  try { await endHostSession(currentSessionId, currentSessionPin); }
  catch (error) { $('sessionError').textContent = error.message; $('endCurrentSession').disabled = false; }
};
$('refreshSessions').onclick = loadSessions;
$('refreshTranscripts').onclick = loadTranscripts;

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
        <td><span>${user.sessionCount} sessions · ${user.transcriptCount} PDFs</span><small>Last: ${escapeHTML(fmt(user.lastActivityAt))}</small></td>
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
  $('editUserMeta').textContent = `${editingUser.email} · ${editingUser.sessionCount} sessions · ${editingUser.transcriptCount} transcripts`;
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
      <div class="activityList">${activity.sessions.slice(0, 5).map(s => `<div><strong>PIN ${escapeHTML(s.pin)}</strong><span>${escapeHTML(fmt(s.createdAt))}</span><small>${escapeHTML(s.meetUrl)}</small></div>`).join('') || '<p class="empty">No session activity.</p>'}</div>`;
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
