const API_BASE = String(import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const DESKTOP_DOWNLOAD_URL = String(import.meta.env.VITE_DESKTOP_DOWNLOAD_URL || '').trim();

let mode = 'login';
let token = localStorage.getItem('zapperToken') || '';
let account = null;
const $ = id => document.getElementById(id);
const auth = $('auth');
const portal = $('portal');
const logout = $('logout');

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}
function fmt(ms) {
  return ms ? new Date(Number(ms)).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}
async function api(path, opts = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function setMode(next) {
  mode = next;
  $('loginTab').classList.toggle('active', mode === 'login');
  $('registerTab').classList.toggle('active', mode === 'register');
  $('name').classList.toggle('hidden', mode !== 'register');
  $('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('authSubmit').textContent = mode === 'login' ? 'Login' : 'Create account';
  $('authError').textContent = '';
}
function showAuth(message = '') {
  token = '';
  account = null;
  localStorage.removeItem('zapperToken');
  portal.classList.add('hidden');
  logout.classList.add('hidden');
  auth.classList.remove('hidden');
  $('authError').textContent = message;
}

$('loginTab').onclick = () => setMode('login');
$('registerTab').onclick = () => setMode('register');
$('authForm').onsubmit = async event => {
  event.preventDefault();
  $('authError').textContent = '';
  try {
    const data = await api(`/api/auth/${mode}`, {
      method: 'POST',
      body: JSON.stringify({ email: $('email').value.trim(), password: $('password').value, name: $('name').value.trim() }),
    });
    token = data.token;
    localStorage.setItem('zapperToken', token);
    await loadPortal();
  } catch (error) { $('authError').textContent = error.message; }
};
logout.onclick = () => showAuth();

async function loadAccount() {
  const data = await api('/api/account');
  account = data.user;
  $('welcome').textContent = `Welcome${account.name ? `, ${account.name}` : ''}`;
  const until = account.subscriptionValidUntil ? fmt(account.subscriptionValidUntil) : 'not activated';
  $('subText').textContent = `${account.email} · Subscription ${account.subscriptionStatus} · Valid until ${until}`;
  const active = account.subscriptionStatus === 'active';
  $('planBadge').textContent = active ? 'Active' : account.subscriptionStatus;
  $('planBadge').classList.toggle('active', active);
}
async function loadSessions() {
  const data = await api('/api/sessions');
  $('sessions').innerHTML = data.sessions.length ? data.sessions.map(session => `
    <div class="row">
      <div>
        <strong>PIN ${escapeHTML(session.pin)}</strong>
        <div class="meta"><span>${escapeHTML(session.meetUrl)}</span><span class="pill">${escapeHTML(session.status)}</span><span>${escapeHTML(fmt(session.createdAt))}</span></div>
      </div>
      <button class="ghost" data-copy="${escapeHTML(session.pin)}" type="button">Copy PIN</button>
    </div>`).join('') : '<p class="empty">No sessions yet.</p>';
  $('sessions').querySelectorAll('[data-copy]').forEach(button => {
    button.onclick = async () => {
      await navigator.clipboard.writeText(button.dataset.copy);
      const old = button.textContent; button.textContent = 'Copied'; setTimeout(() => { button.textContent = old; }, 1200);
    };
  });
}
async function loadTranscripts() {
  const data = await api('/api/transcripts');
  $('transcripts').innerHTML = data.sessions.length ? data.sessions.map(session => `
    <div class="row">
      <div>
        <strong>${escapeHTML(fmt(session.startedAt))} → ${escapeHTML(fmt(session.endedAt))}</strong>
        <div class="meta"><span>PIN ${escapeHTML(session.pin)}</span><span>${escapeHTML(session.meetUrl)}</span>${session.googleEmail ? `<span>${escapeHTML(session.googleEmail)}</span>` : ''}</div>
      </div>
      <button class="ghost" data-pdf="${escapeHTML(session.id)}" type="button">Download PDF</button>
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
      const contentDisposition = response.headers.get('content-disposition') || '';
      const match = contentDisposition.match(/filename="?([^";]+)"?/i);
      anchor.download = match?.[1] || 'Zapper-Transcript.pdf';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    };
  });
}

$('sessionForm').onsubmit = async event => {
  event.preventDefault();
  $('sessionError').textContent = '';
  try {
    const data = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ meetUrl: $('meetUrl').value.trim() }) });
    $('pinValue').textContent = data.session.pin;
    $('pinMeet').textContent = data.session.meetUrl;
    $('pinBox').classList.remove('hidden');
    await loadSessions();
  } catch (error) { $('sessionError').textContent = error.message; }
};
$('copyPin').onclick = async () => {
  const pin = $('pinValue').textContent.trim();
  if (/^\d{6}$/.test(pin)) await navigator.clipboard.writeText(pin);
  $('copyPin').textContent = 'Copied'; setTimeout(() => { $('copyPin').textContent = 'Copy PIN'; }, 1200);
};
$('launchBtn').onclick = () => { window.location.href = 'zapper://launch'; };
$('refreshSessions').onclick = loadSessions;
$('refreshTranscripts').onclick = loadTranscripts;

if (DESKTOP_DOWNLOAD_URL) {
  $('downloadBtn').href = DESKTOP_DOWNLOAD_URL;
  $('downloadBtn').classList.remove('hidden');
}

async function loadPortal() {
  try {
    await loadAccount();
    auth.classList.add('hidden');
    portal.classList.remove('hidden');
    logout.classList.remove('hidden');
    await Promise.all([loadSessions(), loadTranscripts()]);
  } catch (error) { showAuth(error.message); }
}

if (token) loadPortal();
