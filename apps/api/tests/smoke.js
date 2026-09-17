const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'smoke-test-secret-123456789012345678901234567890';
process.env.ADMIN_KEY = process.env.ADMIN_KEY || 'smoke-admin-key';
process.env.DEFAULT_TRIAL_DAYS = '0';
process.env.TRANSCRIPT_RETENTION = '20';

const createSessionControl = require('../session-control');
const routes = new Map();
const app = {};
for (const method of ['get', 'post']) {
  app[method] = (route, ...handlers) => routes.set(`${method.toUpperCase()} ${route}`, handlers);
}
app.use = () => {};
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zapper-smoke-'));
const control = createSessionControl({ app, dataDir: temp });

function routeFor(method, route) {
  const handlers = routes.get(`${method} ${route}`);
  if (!handlers) throw new Error(`Missing route ${method} ${route}`);
  return handlers;
}
async function invoke(method, route, { body = {}, headers = {}, params = {} } = {}) {
  const req = { body, headers, params };
  let statusCode = 200;
  let payload;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
    set() { return this; },
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
  return { statusCode, payload };
}

(async () => {
  const email = `smoke-${Date.now()}@example.com`;
  let result = await invoke('POST', '/api/auth/register', { body: { email, password: 'Password123!', name: 'Smoke Host' } });
  if (!result.payload?.ok || !result.payload?.token) throw new Error('registration failed');
  const portalToken = result.payload.token;

  result = await invoke('POST', '/api/admin/subscription', { headers: { 'x-admin-key': process.env.ADMIN_KEY }, body: { email, days: 30 } });
  if (!result.payload?.ok) throw new Error('subscription activation failed');

  result = await invoke('POST', '/api/sessions', { headers: { authorization: `Bearer ${portalToken}` }, body: { meetUrl: 'abc-defg-hij' } });
  if (!result.payload?.ok || !/^\d{6}$/.test(result.payload.session?.pin || '')) throw new Error('session creation failed');
  const pin = result.payload.session.pin;

  result = await invoke('POST', '/api/desktop/redeem-pin', { body: { pin } });
  if (!result.payload?.ok || !result.payload?.sessionToken || result.payload.meetUrl !== 'https://meet.google.com/abc-defg-hij') throw new Error('PIN redemption failed');
  const sessionToken = result.payload.sessionToken;

  result = await invoke('POST', '/api/desktop/transcripts', {
    headers: { authorization: `Bearer ${sessionToken}` },
    body: { transcriptText: 'Smoke test transcript.', startedAt: Date.now() - 5000, endedAt: Date.now(), googleEmail: 'participant@example.com' },
  });
  if (!result.payload?.ok) throw new Error('transcript upload failed');

  result = await invoke('GET', '/api/transcripts', { headers: { authorization: `Bearer ${portalToken}` } });
  if (!result.payload?.ok || result.payload.sessions?.length !== 1) throw new Error('transcript list failed');

  result = await invoke('POST', '/api/desktop/end-session', { headers: { authorization: `Bearer ${sessionToken}` } });
  if (!result.payload?.ok) throw new Error('session end failed');

  const transcriptList = await invoke('GET', '/api/transcripts', { headers: { authorization: `Bearer ${portalToken}` } });
  console.log(JSON.stringify({ ok: true, pin, meetUrl: transcriptList.payload.sessions[0].meetUrl, transcripts: transcriptList.payload.sessions.length, ended: true }, null, 2));
  try { control.db.close(); } catch (_) {}
  fs.rmSync(temp, { recursive: true, force: true });
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
