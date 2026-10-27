const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'smoke-test-secret-123456789012345678901234567890';
process.env.ADMIN_KEY = process.env.ADMIN_KEY || 'smoke-admin-key';
process.env.ADMIN_EMAIL = 'admin-smoke@example.com';
process.env.ADMIN_PASSWORD = 'AdminPassword123!';
process.env.ADMIN_NAME = 'Smoke Admin';
process.env.SESSION_RETENTION = '15';
process.env.TRANSCRIPT_RETENTION = '15';
process.env.SESSION_IDLE_TIMEOUT_MINUTES = '20';
process.env.PDF_PAUSE_TIMESTAMP_SECONDS = '30';
process.env.HOST_SESSION_MAX_MINUTES = '210';
process.env.PARTICIPANT_TOKEN_MINUTES = '210';

const createSessionControl = require('../session-control');
const routes = new Map();
const app = {};
for (const method of ['get', 'post']) app[method] = (route, ...handlers) => routes.set(`${method.toUpperCase()} ${route}`, handlers);
app.use = () => {};
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zapper-smoke-'));

// Seed a legacy host. Migration auto-approves it but must NOT mint a new trial.
const { DatabaseSync } = require('node:sqlite');
const legacyDb = new DatabaseSync(path.join(temp, 'zapper.db'));
legacyDb.exec(`
  CREATE TABLE users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'host',
    status TEXT NOT NULL DEFAULT 'pending',
    approval_status TEXT NOT NULL DEFAULT 'pending',
    subscription_status TEXT NOT NULL DEFAULT 'inactive',
    subscription_started_at_ms INTEGER,
    subscription_valid_until_ms INTEGER,
    last_login_at_ms INTEGER,
    created_at_ms INTEGER NOT NULL
  );
`);
legacyDb.prepare(`INSERT INTO users(email,password_hash,name,role,status,approval_status,subscription_status,created_at_ms) VALUES(?,?,?,?,?,?,?,?)`)
  .run('legacy-existing@example.com', 'legacy-hash', 'Existing User', 'host', 'active', 'pending', 'inactive', Date.now() - 86400000);
legacyDb.close();

const control = createSessionControl({ app, dataDir: temp });
const grandfathered = control.db.prepare('SELECT status,approval_status FROM users WHERE email=?').get('legacy-existing@example.com');
if (!grandfathered || grandfathered.approval_status !== 'approved' || grandfathered.status !== 'active') {
  throw new Error('legacy accounts should no longer need administrator approval');
}
if (control.db.prepare('SELECT trial_started_at_ms FROM users WHERE email=?').get('legacy-existing@example.com').trial_started_at_ms !== null) {
  throw new Error('migration improperly issued a trial to an existing user');
}

function routeFor(method, route) {
  const handlers = routes.get(`${method} ${route}`);
  if (!handlers) throw new Error(`Missing route ${method} ${route}`);
  return handlers;
}
async function invoke(method, route, { body = {}, headers = {}, params = {}, query = {} } = {}) {
  const req = { body, headers, params, query };
  let statusCode = 200;
  let payload;
  const responseHeaders = {};
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
    set(key, value) {
      if (typeof key === 'object') Object.assign(responseHeaders, key); else responseHeaders[key] = value;
      return this;
    },
    end(value) { payload = value; return this; },
  };
  const handlers = routeFor(method, route);
  let index = 0;
  const next = async () => {
    const handler = handlers[index++];
    if (!handler) return;
    await handler(req, res, next);
  };
  await next();
  return { statusCode, payload, responseHeaders };
}

(async () => {
  // Same login, admin role detected from ADMIN_EMAIL.
  let result = await invoke('POST', '/api/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
  if (!result.payload?.ok || result.payload?.user?.role !== 'admin') throw new Error('admin bootstrap/login failed');
  const adminToken = result.payload.token;

  const email = `smoke-${Date.now()}@example.com`;
  const beforeRegistration = Date.now();
  result = await invoke('POST', '/api/auth/register', { body: { email, password: 'Password123!', name: 'Smoke Host' } });
  if (!result.payload?.ok || result.payload?.approvalPending || result.payload?.token) throw new Error('self-service registration failed');
  const hostId = result.payload.user.id;
  const row = control.db.prepare('SELECT status,approval_status,registration_approved_at_ms,trial_started_at_ms,trial_ends_at_ms,subscription_status,subscription_started_at_ms,subscription_valid_until_ms FROM users WHERE id=?').get(hostId);
  const dayMs = 86400000;
  if (!row || row.status !== 'active' || row.approval_status !== 'approved' || row.subscription_status !== 'active' || !row.registration_approved_at_ms) throw new Error('registration did not automatically activate account and trial');
  if (row.trial_started_at_ms < beforeRegistration || row.trial_ends_at_ms !== row.trial_started_at_ms + dayMs || row.subscription_started_at_ms !== row.trial_started_at_ms || row.subscription_valid_until_ms !== row.trial_ends_at_ms) throw new Error('trial must last exactly 24 hours from registration');
  if (result.payload.user.trialEndsAt !== row.trial_ends_at_ms) throw new Error('frontend trial expiry missing');

  // Same email is unique (case-insensitive), no new account/trial is issued.
  result = await invoke('POST', '/api/auth/register', { body: { email: email.toUpperCase(), password: 'Password123!', name: 'Repeated' } });
  if (result.statusCode !== 409) throw new Error('duplicate registration unexpectedly gave a second trial');

  result = await invoke('POST', '/api/auth/login', { body: { email, password: 'Password123!' } });
  if (!result.payload?.ok || !result.payload?.token) throw new Error('automatic registration did not allow immediate login');
  const portalToken = result.payload.token;
  result = await invoke('POST', '/api/sessions', { headers: { authorization: `Bearer ${portalToken}` }, body: { meetUrl: 'abc-defg-hij' } });
  if (!result.payload?.ok) throw new Error('new trial account cannot create a session');

  // Expiration must persist in the database and block both old JWTs and new logins
  // from generating fresh sessions, but login itself remains available for renewal.
  control.expireSubscriptions(row.trial_ends_at_ms - 1);
  if (control.db.prepare('SELECT subscription_status FROM users WHERE id=?').get(hostId).subscription_status !== 'active') throw new Error('trial ended before the full 24 hours');
  control.expireSubscriptions(row.trial_ends_at_ms);
  const ended = control.db.prepare('SELECT subscription_status,trial_started_at_ms,trial_ends_at_ms FROM users WHERE id=?').get(hostId);
  if (ended.subscription_status !== 'inactive' || ended.trial_started_at_ms !== row.trial_started_at_ms || ended.trial_ends_at_ms !== row.trial_ends_at_ms) throw new Error('expiry did not persist or trial history was lost');
  result = await invoke('POST', '/api/sessions', { headers: { authorization: `Bearer ${portalToken}` }, body: { meetUrl: 'abc-defg-hij' } });
  if (result.statusCode !== 402 || result.payload.code !== 'SUBSCRIPTION_INACTIVE') throw new Error('expired trial allowed session creation');
  result = await invoke('GET', '/api/account', { headers: { authorization: `Bearer ${portalToken}` } });
  if (result.payload.user.subscriptionStatus !== 'inactive') throw new Error('expired trial displayed as active');
  result = await invoke('POST', '/api/auth/login', { body: { email, password: 'Password123!' } });
  if (!result.payload?.ok || result.payload.user?.subscriptionStatus !== 'inactive') throw new Error('expired account should be allowed to sign in but not create sessions');
  result = await invoke('POST', '/api/auth/register', { body: { email, password: 'Password123!', name: 'Re-register' } });
  if (result.statusCode !== 409) throw new Error('expired account was able to get another trial');

  // Admin may extend/reactivate subscriptions without changing historical trial dates.
  const start = Date.now() - 60_000;
  const end = Date.now() + 30 * dayMs;
  result = await invoke('POST', '/api/admin/users/:id/subscription', {
    headers: { authorization: `Bearer ${adminToken}` },
    params: { id: String(hostId) },
    body: { subscriptionStatus: 'active', startedAt: start, validUntil: end },
  });
  if (!result.payload?.ok || result.payload.user?.subscriptionStatus !== 'active') throw new Error('admin subscription renewal failed');
  const renewed = control.db.prepare('SELECT trial_started_at_ms,trial_ends_at_ms,subscription_valid_until_ms,subscription_status FROM users WHERE id=?').get(hostId);
  if (renewed.trial_started_at_ms !== row.trial_started_at_ms || renewed.trial_ends_at_ms !== row.trial_ends_at_ms || renewed.subscription_valid_until_ms !== end || renewed.subscription_status !== 'active') throw new Error('admin renewal unexpectedly reset trial history');

  // Create several sessions for the same Meet. They must remain active independently
  // until the host explicitly ends each one. Browser/API refresh must not change state.
  const created = [];
  for (let i = 0; i < 3; i += 1) {
    result = await invoke('POST', '/api/sessions', { headers: { authorization: `Bearer ${portalToken}` }, body: { meetUrl: 'abc-defg-hij' } });
    if (!result.payload?.ok || !/^\d{6}$/.test(result.payload.session?.pin || '')) throw new Error('session creation failed');
    created.push(result.payload.session);
  }
  const latestSession = created[created.length - 1];
  result = await invoke('GET', '/api/sessions', { headers: { authorization: `Bearer ${portalToken}` } });
  if (!result.payload?.ok || result.payload.sessions.filter(s => s.active).length < 3) throw new Error('refresh/list must not end active sessions');

  // Hard maximum: one old active session must auto-end at 210 minutes even if
  // the host never pressed End Session. The other current sessions remain active.
  const maxedSession = created[0];
  control.db.prepare('UPDATE host_sessions SET created_at_ms=?, expires_at_ms=? WHERE id=?')
    .run(Date.now() - 211 * 60000, Date.now() - 60000, maxedSession.id);
  control.sweepIdleSessions(Date.now());
  const maxedRow = control.db.prepare('SELECT active,status,end_reason FROM host_sessions WHERE id=?').get(maxedSession.id);
  if (Number(maxedRow.active) !== 0 || maxedRow.status !== 'ended' || maxedRow.end_reason !== 'max_duration') throw new Error('210-minute host maximum was not enforced');

  result = await invoke('POST', '/api/desktop/redeem-pin', { body: { pin: latestSession.pin } });
  if (!result.payload?.ok || !result.payload?.sessionToken || result.payload.meetUrl !== 'https://meet.google.com/abc-defg-hij') throw new Error('PIN redemption failed');
  const sessionToken = result.payload.sessionToken;

  // Participant Leave/detach must NOT end the host session. Same PIN must work again.
  result = await invoke('POST', '/api/desktop/end-session', { headers: { authorization: `Bearer ${sessionToken}` } });
  if (!result.payload?.ok || !result.payload?.detached) throw new Error('participant detach failed');
  let activeRow = control.db.prepare('SELECT active,status,end_reason FROM host_sessions WHERE id=?').get(latestSession.id);
  if (Number(activeRow.active) !== 1 || activeRow.status !== 'active') throw new Error('participant leave ended host session');
  result = await invoke('POST', '/api/desktop/redeem-pin', { body: { pin: latestSession.pin } });
  if (!result.payload?.ok) throw new Error('same PIN should remain valid after participant leave');

  // Silence itself must not end it before the hard 210-minute duration.
  const oldSpeech = Date.now() - 24 * 60 * 60 * 1000;
  control.db.prepare('UPDATE host_sessions SET participant_started_at_ms=?, last_speech_at_ms=?, expires_at_ms=? WHERE id=?').run(oldSpeech, oldSpeech, Date.now() - 1000, latestSession.id);
  control.sweepIdleSessions(Date.now());
  activeRow = control.db.prepare('SELECT active,status,end_reason FROM host_sessions WHERE id=?').get(latestSession.id);
  if (Number(activeRow.active) !== 1 || activeRow.status !== 'active') throw new Error('idle/legacy expiry ended host-controlled session');

  // Live captions are persisted against the host session while it is active.
  // Participant Leave/detach must not finalize a PDF; Host End Session does.
  const liveStart = Date.now() - 50000;
  control.registerParticipantGoogleEmail(latestSession.id, 'participant@example.com');
  control.appendLiveTranscriptSegments(latestSession.id, [
    { text: 'Smoke test transcript.', at: liveStart },
    { text: 'Second segment.', at: liveStart + 45000 },
  ], 'smoke-live-source');
  let transcriptCount = control.db.prepare('SELECT COUNT(*) c FROM transcripts WHERE host_session_id=?').get(latestSession.id).c;
  if (Number(transcriptCount) !== 0) throw new Error('participant activity finalized PDF before host end');

  // Host End Session is the single action that invalidates the PIN and finalizes
  // the authoritative session PDF from the backend live transcript ledger.
  result = await invoke('POST', '/api/sessions/:id/end', {
    headers: { authorization: `Bearer ${portalToken}` },
    params: { id: latestSession.id },
  });
  if (!result.payload?.ok || !result.payload?.pdfFinalized || !result.payload?.transcriptId) throw new Error('host End Session/PDF finalization failed');
  const transcriptId = result.payload.transcriptId;
  result = await invoke('POST', '/api/desktop/redeem-pin', { body: { pin: latestSession.pin } });
  if (result.statusCode !== 404 || result.payload?.ok) throw new Error('host-ended PIN should be invalid');
  const endedRow = control.db.prepare('SELECT active,status,end_reason FROM host_sessions WHERE id=?').get(latestSession.id);
  if (Number(endedRow.active) !== 0 || endedRow.status !== 'ended' || endedRow.end_reason !== 'host_ended') throw new Error('host end did not mark active=false');

  // A late participant fallback sync within the host-end grace window may add
  // in-flight final captions and refresh the same authoritative PDF, never a second PDF.
  result = await invoke('POST', '/api/desktop/transcripts', {
    headers: { authorization: `Bearer ${sessionToken}` },
    body: { transcriptText: 'Final in-flight segment.', transcriptSegments: [{ text: 'Final in-flight segment.', at: Date.now() }], startedAt: liveStart, endedAt: Date.now(), googleEmail: 'participant@example.com' },
  });
  if (!result.payload?.ok || !result.payload?.pdfSaved || result.payload?.transcriptId !== transcriptId) throw new Error('late transcript fallback did not refresh authoritative PDF');
  transcriptCount = control.db.prepare('SELECT COUNT(*) c FROM transcripts WHERE host_session_id=?').get(latestSession.id).c;
  if (Number(transcriptCount) !== 1) throw new Error('more than one PDF/transcript row exists for one host session');

  result = await invoke('GET', '/api/transcripts/:id/pdf', { headers: { authorization: `Bearer ${portalToken}` }, params: { id: transcriptId } });
  if (!Buffer.isBuffer(result.payload) || result.payload.subarray(0, 4).toString() !== '%PDF') throw new Error('PDF download failed');
  const pdfText = result.payload.toString('latin1');
  if (pdfText.includes('Host account') || pdfText.includes('Google Meet')) throw new Error('obsolete PDF host metadata still present');
  if (!pdfText.includes('Participant: participant@example.com') || !pdfText.includes('Duration:')) throw new Error('compact PDF metadata missing');
  if (!pdfText.includes('IST')) throw new Error('PDF pause timestamp marker missing');

  // A completed two-minute call must appear consistently in the host usage
  // summary and in the admin's per-user/per-call duration displays.
  control.db.prepare("UPDATE host_sessions SET created_at_ms=?,ended_at_ms=?,active=0,status='ended',end_reason='host_ended' WHERE id=?")
    .run(Date.now() - 180000, Date.now() - 60000, created[1].id);
  result = await invoke('GET', '/api/sessions', { headers: { authorization: `Bearer ${portalToken}` } });
  if (!result.payload?.ok || result.payload.usage?.callDurationMinutes < 1.9 || result.payload.usage?.sessionCount < 4) throw new Error('host call minutes missing or incomplete');
  result = await invoke('GET', '/api/admin/users', { headers: { authorization: `Bearer ${adminToken}` } });
  if (!result.payload?.ok || !result.payload.users.some(user => user.email === email && user.sessionCount >= 4 && user.callDurationMinutes >= 1.9)) throw new Error('admin user call minutes failed');
  result = await invoke('GET', '/api/admin/users/:id/activity', { headers: { authorization: `Bearer ${adminToken}` }, params: { id: String(hostId) } });
  if (!result.payload?.ok || !result.payload.sessions.some(s => s.id === created[1].id && Number(s.endedAt) > Number(s.createdAt))) throw new Error('admin per-call timestamps missing');

  // New sessions receive 12-minute native-caption inactivity monitoring.
  // Confirming human presence must resume the original PIN without fake speech.
  let idleCheck = await invoke('POST', '/api/sessions', { headers: { authorization: `Bearer ${portalToken}` }, body: { meetUrl: 'abc-defg-hij' } });
  if (!idleCheck.payload?.ok) throw new Error('new inactivity-test session could not be created');
  const idleId = idleCheck.payload.session.id;
  const thirteenMinutesAgo = Date.now() - 13 * 60 * 1000;
  control.db.prepare('UPDATE host_sessions SET inactivity_started_at_ms=?, last_caption_at_ms=?, last_confirmed_at_ms=NULL WHERE id=?')
    .run(thirteenMinutesAgo, thirteenMinutesAgo, idleId);
  idleCheck = await invoke('GET', '/api/sessions/:id/inactivity', { headers: { authorization: `Bearer ${portalToken}` }, params: { id: idleId } });
  if (!idleCheck.payload?.showWarning || !idleCheck.payload.active) throw new Error('missing 12-minute caption warning');
  let deniedActivity = await invoke('GET', '/api/sessions/:id/inactivity', { headers: { authorization: `Bearer ${adminToken}` }, params: { id: idleId } });
  if (deniedActivity.statusCode !== 403) throw new Error('admin must not read host-only inactivity');
  idleCheck = await invoke('POST', '/api/sessions/:id/continue', { headers: { authorization: `Bearer ${portalToken}` }, params: { id: idleId } });
  if (!idleCheck.payload?.ok) throw new Error('host Continue failed');
  idleCheck = await invoke('GET', '/api/sessions/:id/inactivity', { headers: { authorization: `Bearer ${portalToken}` }, params: { id: idleId } });
  if (idleCheck.payload?.showWarning) throw new Error('Continue did not reset the warning');
  // Native-caption activity, not PIN redemption, extends the session timer.
  control.touchSessionCaption(idleId, Date.now());
  const lastCaption = control.db.prepare('SELECT last_caption_at_ms FROM host_sessions WHERE id=?').get(idleId).last_caption_at_ms;
  if (!lastCaption) throw new Error('native Meet captions did not record activity');
  control.appendLiveTranscriptSegment(idleId, 'Caption before inactivity timeout.', Date.now() - 1000, 'smoke-inactivity');
  const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
  control.db.prepare('UPDATE host_sessions SET inactivity_started_at_ms=?,last_caption_at_ms=?,last_confirmed_at_ms=NULL WHERE id=?')
    .run(fifteenMinutesAgo, fifteenMinutesAgo, idleId);
  control.sweepIdleSessions(Date.now());
  const silentRow = control.db.prepare('SELECT active,end_reason FROM host_sessions WHERE id=?').get(idleId);
  if (silentRow.active || silentRow.end_reason !== 'speech_inactivity') throw new Error('unanswered inactivity alert did not end PIN');
  if (!control.db.prepare('SELECT pdf_blob FROM transcripts WHERE host_session_id=?').get(idleId)?.pdf_blob?.length) throw new Error('unanswered inactivity alert failed to finalize PDF');
  idleCheck = await invoke('POST', '/api/sessions/:id/continue', { headers: { authorization: `Bearer ${portalToken}` }, params: { id: idleId } });
  if (idleCheck.statusCode !== 409) throw new Error('Continue must not revive ended PIN');

  // A process restart must not restart/reissue the 24-hour trial.
  control.db.close();
  const reloadRoutes = new Map();
  const reloadApp = { use() {} };
  for (const method of ['get', 'post']) reloadApp[method] = (route, ...handlers) => reloadRoutes.set(`${method.toUpperCase()} ${route}`, handlers);
  const reopened = createSessionControl({ app: reloadApp, dataDir: temp });
  const restored = reopened.db.prepare('SELECT trial_started_at_ms,trial_ends_at_ms,subscription_started_at_ms,subscription_valid_until_ms FROM users WHERE id=?').get(hostId);
  if (restored.trial_started_at_ms !== row.trial_started_at_ms || restored.trial_ends_at_ms !== row.trial_ends_at_ms || restored.subscription_valid_until_ms !== end) throw new Error('server restart reset the trial or manually renewed subscription');
  if (reopened.db.prepare('SELECT trial_started_at_ms FROM users WHERE email=?').get('legacy-existing@example.com').trial_started_at_ms !== null) throw new Error('restart gave a trial to an old account');
  reopened.db.close();
  console.log(JSON.stringify({ ok: true, version: require('../package.json').version, newUserAutoApproved: true, oneDayTrial: true, duplicateEmailBlocked: true, automaticExpiry: true, adminRenewal: true, restartPersistence: true, hostControlledSession: true, storedPdf: true, callDurations: true }, null, 2));
  fs.rmSync(temp, { recursive: true, force: true });
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
