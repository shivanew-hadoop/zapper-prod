const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert').strict;

process.env.JWT_SECRET = 'google-meet-test-secret-123456789012345678901';
process.env.ADMIN_EMAIL = 'admin-google-meet@example.com';
process.env.ADMIN_PASSWORD = 'GoogleMeetAdmin123!';
process.env.WEB_ORIGINS = 'https://zapperapp.in,http://localhost:5173';
process.env.GOOGLE_OAUTH_CLIENT_ID = 'test.apps.googleusercontent.com';
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://api.zapperapp.in/api/google/meet/callback';

const create = require('../session-control');
const routes = new Map();
const app = Object.fromEntries(['get', 'post'].map(method => [method, (url, ...handlers) => routes.set(`${method.toUpperCase()} ${url}`, handlers)]));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapper-google-meet-'));
const control = create({ app, dataDir });

async function invoke(method, url, { body = {}, headers = {}, query = {}, params = {} } = {}) {
  const handlers = routes.get(`${method} ${url}`);
  if (!handlers) throw Error(`Missing route ${method} ${url}`);
  let status = 200, payload, html, responseHeaders = {};
  const req = { body, headers, query, params };
  const res = {
    status(n) { status = n; return this; },
    set(k, v) { if (typeof k === 'object') Object.assign(responseHeaders, k); else responseHeaders[k] = v; return this; },
    json(data) { payload = data; return this; },
    send(value) { html = value; return this; },
  };
  let nextIndex = 0;
  const next = async () => { const fn = handlers[nextIndex++]; if (fn) await fn(req, res, next); };
  await next();
  return { status, payload, html, responseHeaders };
}

(async () => {
  try {
    let r = await invoke('POST', '/api/auth/register', { body: { email: 'meet-host@example.com', password: 'Password123!', name: 'Meet Host' } });
    assert.equal(r.status, 200);
    r = await invoke('POST', '/api/auth/login', { body: { email: 'meet-host@example.com', password: 'Password123!' } });
    const token = r.payload.token;
    const headers = { authorization: `Bearer ${token}`, origin: 'https://zapperapp.in' };
    const status = await invoke('GET', '/api/google/meet/status', { headers });
    assert.equal(status.payload.enabled, true);
    assert.equal(status.payload.maxZapperParticipants, 4);
    assert.equal(status.payload.googleMeetParticipantCap, false);

    r = await invoke('POST', '/api/google/meet/start', { headers: { ...headers, origin: 'https://attacker.example' }, body: { requestId: 'client-request-test-1' } });
    assert.equal(r.status, 403, 'only approved website origins may initiate Google OAuth');
    r = await invoke('POST', '/api/google/meet/start', { headers, body: { requestId: 'client-request-test-1' } });
    assert.equal(r.payload.ok, true);
    const authorizeUrl = new URL(r.payload.url);
    assert.equal(authorizeUrl.hostname, 'accounts.google.com');
    assert.equal(authorizeUrl.searchParams.get('scope'), 'https://www.googleapis.com/auth/meetings.space.created');
    assert.equal(authorizeUrl.searchParams.get('redirect_uri'), process.env.GOOGLE_OAUTH_REDIRECT_URI);
    assert.equal(authorizeUrl.searchParams.get('code_challenge_method'), 'S256');
    const state = authorizeUrl.searchParams.get('state');
    let createdCalls = 0;
    const originalFetch = global.fetch;
    global.fetch = async (url, args) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        assert.equal(args.body.get('code'), 'mock-oauth-code');
        assert.ok(args.body.get('code_verifier'));
        return { ok: true, status: 200, json: async () => ({ access_token: 'mock-google-access-token' }) };
      }
      if (url === 'https://meet.googleapis.com/v2/spaces') {
        createdCalls++;
        assert.equal(args.headers.Authorization, 'Bearer mock-google-access-token');
        assert.deepEqual(JSON.parse(args.body).config, { accessType: 'OPEN', entryPointAccess: 'ALL' });
        return { ok: true, status: 200, json: async () => ({ meetingUri: 'https://meet.google.com/abc-defg-hij', config: { accessType: 'OPEN', entryPointAccess: 'ALL' } }) };
      }
      throw Error(`Unmocked fetch: ${url}`);
    };
    r = await invoke('GET', '/api/google/meet/callback', { query: { state, code: 'mock-oauth-code' } });
    assert.equal(r.status, 200);
    assert.match(r.html, /Google Meet created/);
    assert.match(r.html, /client-request-test-1/);
    assert.match(r.html, /https:\/\/meet.google.com\/abc-defg-hij/);
    assert.doesNotMatch(r.html, /mock-google-access-token/);
    assert.equal(createdCalls, 1);
    let dbSession = control.db.prepare('SELECT * FROM host_sessions WHERE google_meet_created=1').get();
    assert.ok(dbSession && /^\d{6}$/.test(dbSession.pin));
    assert.equal(dbSession.meet_url, 'https://meet.google.com/abc-defg-hij');

    r = await invoke('GET', '/api/google/meet/callback', { query: { state, code: 'mock-oauth-code' } });
    assert.equal(r.status, 400, 'OAuth state must not be reusable');
    assert.equal(createdCalls, 1, 'replayed OAuth state should not call Google');

    const seatTokens = [];
    for (let i = 0; i < 4; i++) {
      r = await invoke('POST', '/api/desktop/redeem-pin', { body: { pin: dbSession.pin, deviceId: `00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}` } });
      assert.equal(r.payload.ok, true, `redemption ${i + 1} should succeed`);
      assert.ok(control.verifyParticipantToken(r.payload.sessionToken));
      seatTokens.push(r.payload.sessionToken);
    }
    // The same desktop joining again must not consume a fifth slot.
    const rejoin = await invoke('POST', '/api/desktop/redeem-pin', { body: { pin: dbSession.pin, deviceId: '00000000-0000-4000-8000-000000000001' } });
    assert.equal(rejoin.status, 200);
    assert.equal(control.db.prepare('SELECT count(*) AS count FROM session_participant_seats WHERE session_id=? AND active=1').get(dbSession.id).count, 4);
    r = await invoke('POST', '/api/desktop/redeem-pin', { body: { pin: dbSession.pin, deviceId: '00000000-0000-4000-8000-000000000005' } });
    assert.equal(r.status, 409);
    assert.equal(r.payload.code, 'SESSION_FULL');
    r = await invoke('POST', '/api/desktop/end-session', { headers: { authorization: `Bearer ${seatTokens[0]}` } });
    assert.equal(r.payload.detached, true);
    assert.equal(control.verifyParticipantToken(seatTokens[0]), null, 'detached token must not reclaim its seat');
    r = await invoke('POST', '/api/desktop/redeem-pin', { body: { pin: dbSession.pin, deviceId: '00000000-0000-4000-8000-000000000005' } });
    assert.equal(r.payload.ok, true, 'a released seat must be reusable');
    assert.equal(control.db.prepare('SELECT count(*) count FROM session_participant_seats WHERE session_id=? AND active=1').get(dbSession.id).count, 4);

    // Old manual creation and PIN reuse remain backwards compatible.
    r = await invoke('POST', '/api/sessions', { headers, body: { meetUrl: 'aaa-bbbb-ccc' } });
    assert.equal(r.payload.ok, true);
    const manualId = r.payload.session.id;
    assert.equal(control.db.prepare('SELECT google_meet_created FROM host_sessions WHERE id=?').get(manualId).google_meet_created, 0);
    for (let i = 0; i < 5; i++) {
      const redemption = await invoke('POST', '/api/desktop/redeem-pin', { body: { pin: r.payload.session.pin } });
      assert.equal(redemption.payload.ok, true, 'legacy manual PIN behavior must remain unchanged');
    }

    // Do not create a PIN if Workspace policy refuses OPEN access.
    const denialStart = await invoke('POST', '/api/google/meet/start', { headers, body: { requestId: 'restricted-policy-test' } });
    const denialState = new URL(denialStart.payload.url).searchParams.get('state');
    global.fetch = async (url) => url.includes('oauth2.googleapis.com')
      ? { ok: true, json: async () => ({ access_token: 'mock' }) }
      : { ok: true, json: async () => ({ meetingUri: 'https://meet.google.com/def-ghij-klm', config: { accessType: 'RESTRICTED' } }) };
    const before = control.db.prepare('SELECT COUNT(*) AS total FROM host_sessions').get().total;
    const denied = await invoke('GET', '/api/google/meet/callback', { query: { state: denialState, code: 'mock-oauth-code' } });
    assert.match(denied.html, /did not confirm open access/);
    assert.equal(control.db.prepare('SELECT COUNT(*) AS total FROM host_sessions').get().total, before);

    // Subscription rechecked before OAuth is initiated.
    control.db.prepare("UPDATE users SET subscription_status='inactive' WHERE email='meet-host@example.com'").run();
    r = await invoke('POST', '/api/google/meet/start', { headers, body: { requestId: 'inactive-host-test' } });
    assert.equal(r.status, 402);
    assert.equal(r.payload.code, 'SUBSCRIPTION_INACTIVE');
    global.fetch = originalFetch;
    console.log(JSON.stringify({ ok: true, version: '3.1.20', oauthPkceAndOrigin: true, openMeetingCreation: true, pinCreated: true, replayProtection: true, fourZapperSeats: true, deviceRejoinDoesNotUseAnotherSeat: true, seatRelease: true, manualFlowUnchanged: true, restrictedMeetRejected: true, subscriptionGate: true }));
  } finally {
    control.db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
