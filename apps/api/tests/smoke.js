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
  if (!result.payload?.ok || !result.payload?.token) throw new Error('registration failed');
  const portalToken = result.payload.token;
  const hostId = result.payload.user.id;

  // Admin sets exact subscription start/end dates through the same portal auth token.
  const start = Date.now() - 60_000;
  const end = Date.now() + 30 * 86400000;
  result = await invoke('POST', '/api/admin/users/:id/subscription', {
    headers: { authorization: `Bearer ${adminToken}` },
    params: { id: String(hostId) },
    body: { subscriptionStatus: 'active', startedAt: start, validUntil: end },
  });
  if (!result.payload?.ok || result.payload.user?.subscriptionStatus !== 'active') throw new Error('admin subscription edit failed');

  // Create > retention to prove the database retains only the latest 15 sessions.
  let latestSession;
  for (let i = 0; i < 17; i += 1) {
    result = await invoke('POST', '/api/sessions', { headers: { authorization: `Bearer ${portalToken}` }, body: { meetUrl: 'abc-defg-hij' } });
    if (!result.payload?.ok || !/^\d{6}$/.test(result.payload.session?.pin || '')) throw new Error('session creation failed');
    latestSession = result.payload.session;
  }
  result = await invoke('GET', '/api/sessions', { headers: { authorization: `Bearer ${portalToken}` } });
  if (result.payload?.sessions?.length !== 15) throw new Error(`session retention failed: ${result.payload?.sessions?.length}`);

  result = await invoke('POST', '/api/desktop/redeem-pin', { body: { pin: latestSession.pin } });
  if (!result.payload?.ok || !result.payload?.sessionToken || result.payload.meetUrl !== 'https://meet.google.com/abc-defg-hij') throw new Error('PIN redemption failed');
  const sessionToken = result.payload.sessionToken;

  // Host can end the session from the portal. The PIN must immediately stop
  // redeeming, while the participant token can still upload the transcript/PDF.
  result = await invoke('POST', '/api/sessions/:id/end', {
    headers: { authorization: `Bearer ${portalToken}` },
    params: { id: latestSession.id },
  });
  if (!result.payload?.ok) throw new Error('host End Session failed');
  result = await invoke('POST', '/api/desktop/redeem-pin', { body: { pin: latestSession.pin } });
  if (result.statusCode !== 404 || result.payload?.ok) throw new Error('ended PIN should be invalid');
  const endedRow = control.db.prepare('SELECT active,status,end_reason FROM host_sessions WHERE id=?').get(latestSession.id);
  if (Number(endedRow.active) !== 0 || endedRow.status !== 'ended') throw new Error('ended session must be active=false in database');

  result = await invoke('POST', '/api/desktop/transcripts', {
    headers: { authorization: `Bearer ${sessionToken}` },
    body: { transcriptText: 'Smoke test transcript.\nSecond segment.', transcriptSegments: [{ text: 'Smoke test transcript.', at: Date.now() - 45000 }, { text: 'Second segment.', at: Date.now() }], startedAt: Date.now() - 50000, endedAt: Date.now(), googleEmail: 'participant@example.com' },
  });
  if (!result.payload?.ok || !result.payload?.pdfSaved) throw new Error('transcript/PDF storage failed');
  const transcriptId = result.payload.transcriptId;

  result = await invoke('GET', '/api/transcripts', { headers: { authorization: `Bearer ${portalToken}` } });
  if (!result.payload?.ok || result.payload.sessions?.length !== 1) throw new Error('transcript list failed');

  result = await invoke('GET', '/api/transcripts/:id/pdf', { headers: { authorization: `Bearer ${portalToken}` }, params: { id: transcriptId } });
  if (!Buffer.isBuffer(result.payload) || result.payload.subarray(0, 4).toString() !== '%PDF') throw new Error('stored PDF download failed');
  if (!result.payload.toString('latin1').includes('IST')) throw new Error('PDF pause timestamp marker missing');

  result = await invoke('POST', '/api/sessions', { headers: { authorization: `Bearer ${portalToken}` }, body: { meetUrl: 'abc-defg-hij' } });
  if (!result.payload?.ok || result.payload.session?.pin === latestSession.pin) throw new Error('same Meet restart failed');
  const restarted = result.payload.session;
  result = await invoke('POST', '/api/desktop/redeem-pin', { body: { pin: restarted.pin } });
  if (!result.payload?.ok) throw new Error('new PIN for same Meet should be valid');
  const restartedToken = result.payload.sessionToken;
  result = await invoke('GET', '/api/desktop/session-status', { headers: { authorization: `Bearer ${restartedToken}` } });
  if (!result.payload?.ok || !result.payload?.active) throw new Error('session-status should report active');

  const oldSpeech = Date.now() - 21 * 60 * 1000;
  control.db.prepare('UPDATE host_sessions SET participant_started_at_ms=?, last_speech_at_ms=? WHERE id=?').run(oldSpeech, oldSpeech, restarted.id);
  control.sweepIdleSessions(Date.now());
  const idleRow = control.db.prepare('SELECT active,status,end_reason FROM host_sessions WHERE id=?').get(restarted.id);
  if (Number(idleRow.active) !== 0 || idleRow.end_reason !== 'idle_timeout') throw new Error('idle timeout did not end session');
  result = await invoke('POST', '/api/desktop/redeem-pin', { body: { pin: restarted.pin } });
  if (result.statusCode !== 404 || result.payload?.ok) throw new Error('idle-ended PIN should be invalid');

  result = await invoke('GET', '/api/admin/users', { headers: { authorization: `Bearer ${adminToken}` } });
  if (!result.payload?.ok || !result.payload.users.some(user => user.email === email && user.sessionCount === 15)) throw new Error('admin user activity failed');

  console.log(JSON.stringify({ ok: true, admin: process.env.ADMIN_EMAIL, host: email, retainedSessions: 15, storedPdf: true, pin: latestSession.pin }, null, 2));
  try { control.db.close(); } catch (_) {}
  fs.rmSync(temp, { recursive: true, force: true });
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
