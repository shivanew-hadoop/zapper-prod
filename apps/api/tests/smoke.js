const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'smoke-test-secret-123456789012345678901234567890';
process.env.ADMIN_KEY = process.env.ADMIN_KEY || 'smoke-admin-key';
process.env.ADMIN_EMAIL = 'admin-smoke@example.com';
process.env.ADMIN_PASSWORD = 'AdminPassword123!';
process.env.ADMIN_NAME = 'Smoke Admin';
process.env.DEFAULT_TRIAL_DAYS = '0';
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
const control = createSessionControl({ app, dataDir: temp });

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
  result = await invoke('POST', '/api/auth/register', { body: { email, password: 'Password123!', name: 'Smoke Host' } });
  if (!result.payload?.ok || !result.payload?.approvalPending || result.payload?.token) throw new Error('pending registration failed');
  const hostId = result.payload.user.id;

  result = await invoke('POST', '/api/auth/login', { body: { email, password: 'Password123!' } });
  if (result.statusCode !== 403 || !/pending administrator approval/i.test(result.payload?.error || '')) throw new Error('pending host login was not blocked');

  // Admin explicitly approves the host and sets exact subscription dates.
  const start = Date.now() - 60_000;
  const end = Date.now() + 30 * 86400000;
  result = await invoke('POST', '/api/admin/users/:id/status', {
    headers: { authorization: `Bearer ${adminToken}` },
    params: { id: String(hostId) },
    body: { status: 'active' },
  });
  if (!result.payload?.ok || result.payload.user?.status !== 'active') throw new Error('admin approval failed');
  result = await invoke('POST', '/api/admin/users/:id/subscription', {
    headers: { authorization: `Bearer ${adminToken}` },
    params: { id: String(hostId) },
    body: { subscriptionStatus: 'active', startedAt: start, validUntil: end },
  });
  if (!result.payload?.ok || result.payload.user?.subscriptionStatus !== 'active') throw new Error('admin subscription edit failed');
  result = await invoke('POST', '/api/auth/login', { body: { email, password: 'Password123!' } });
  if (!result.payload?.ok || !result.payload?.token) throw new Error('approved host login failed');
  const portalToken = result.payload.token;

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

  result = await invoke('GET', '/api/admin/users', { headers: { authorization: `Bearer ${adminToken}` } });
  if (!result.payload?.ok || !result.payload.users.some(user => user.email === email && user.sessionCount >= 3)) throw new Error('admin user activity failed');

  console.log(JSON.stringify({ ok: true, admin: process.env.ADMIN_EMAIL, host: email, hostControlledSession: true, storedPdf: true, pin: latestSession.pin }, null, 2));
  try { control.db.close(); } catch (_) {}
  fs.rmSync(temp, { recursive: true, force: true });
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
