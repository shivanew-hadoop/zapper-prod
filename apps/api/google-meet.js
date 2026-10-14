// One-time Google OAuth authorization for creating an OPEN Meet room as the
// signed-in Zapper host. Google access tokens are never stored in Zapper.
const crypto = require('crypto');

const SCOPE = 'https://www.googleapis.com/auth/meetings.space.created';
const FLOW_LIFETIME_MS = 10 * 60 * 1000;

function googleMeetRoutes({ app, db, auth, isHostEligible, createSession, allowedOrigins }) {
  const clientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const redirectUri = String(process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim();
  let validRedirect = false;
  try {
    const uri = new URL(redirectUri);
    validRedirect = uri.protocol === 'https:' || (uri.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(uri.hostname));
  } catch (_) {}
  const configured = Boolean(clientId && clientSecret && validRedirect);

  db.exec(`CREATE TABLE IF NOT EXISTS google_meet_oauth_states (
    state TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    web_origin TEXT NOT NULL,
    request_id TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  const safeError = message => String(message || 'Google Meet setup failed. Try again.').slice(0, 240);
  const oauthError = (res, origin, requestId, message, code = '') => {
    return finishPopup(res, origin, { type: 'zapper-google-meet-result', requestId, ok: false, error: safeError(message), code });
  };

  // HTML is only returned to Google OAuth's redirect URI. Never echo tokens or
  // authorization codes to the opener; pass the resulting Zapper session only.
  function finishPopup(res, origin, payload) {
    const destination = allowedOrigins.includes(origin) ? origin : null;
    const safePayload = JSON.stringify(payload).replace(/</g, '\\u003c');
    const safeOrigin = JSON.stringify(destination);
    const sessionLink = payload.ok && /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(payload.session?.meetUrl || '')
      ? payload.session.meetUrl : '';
    const meetUrl = JSON.stringify(sessionLink);
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
    return res.send(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Zapper Google Meet</title><style>body{font:16px system-ui;margin:3rem;background:#081625;color:#fff}a{color:#91c6ff}</style><h2>${sessionLink ? 'Google Meet created' : 'Google Meet authorization'}</h2><p id="result"></p><script>
const result=${safePayload}; const target=${safeOrigin}; const meetUrl=${meetUrl};
document.getElementById('result').textContent=result.ok ? 'Your Zapper PIN is ready. Opening Google Meet…' : result.error;
if(target && window.opener) window.opener.postMessage(result,target);
if(result.ok && meetUrl) window.location.replace(meetUrl);
</script>${sessionLink ? `<p><a href="${sessionLink}">Open Google Meet</a></p>` : ''}</html>`);
  }

  app.get('/api/google/meet/status', auth, (req, res) => {
    res.json({ ok: true, enabled: configured, maxZapperParticipants: 4, googleMeetParticipantCap: false });
  });

  app.post('/api/google/meet/start', auth, (req, res) => {
    const eligible = isHostEligible(req.authUser);
    if (eligible) return res.status(eligible.status).json({ ok: false, code: eligible.code, error: eligible.error });
    if (!configured) return res.status(503).json({ ok: false, code: 'GOOGLE_MEET_NOT_CONFIGURED', error: 'Google Meet connection is not configured. Use the manual Meet link option until the administrator adds Google OAuth credentials.' });
    const origin = String(req.headers.origin || '').replace(/\/$/, '');
    if (!allowedOrigins.includes(origin)) return res.status(403).json({ ok: false, error: 'This website is not allowed to create Google Meet sessions.' });
    const requestId = String(req.body?.requestId || '');
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) return res.status(400).json({ ok: false, error: 'Invalid request identifier.' });
    const state = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const now = Date.now();
    db.prepare('DELETE FROM google_meet_oauth_states WHERE expires_at_ms<?').run(now);
    db.prepare('INSERT INTO google_meet_oauth_states(state,user_id,web_origin,request_id,code_verifier,expires_at_ms) VALUES(?,?,?,?,?,?)')
      .run(state, req.authUser.id, origin, requestId, verifier, now + FLOW_LIFETIME_MS);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
      access_type: 'online',
    });
    res.set('Cache-Control', 'no-store').json({ ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, requestId });
  });

  app.get('/api/google/meet/callback', async (req, res) => {
    const state = String(req.query?.state || '');
    if (!/^[a-zA-Z0-9_-]{30,100}$/.test(state)) return res.status(400).send('Invalid or missing Google OAuth state. Return to Zapper and retry.');
    // Each state can be used exactly once, even if Google calls back repeatedly.
    const flow = db.prepare('SELECT * FROM google_meet_oauth_states WHERE state=?').get(state);
    if (!flow) return res.status(400).send('This Google sign-in has already been used or expired. Return to Zapper and retry.');
    db.prepare('DELETE FROM google_meet_oauth_states WHERE state=?').run(state);
    if (flow.expires_at_ms <= Date.now()) return oauthError(res, flow.web_origin, flow.request_id, 'Google sign-in expired. Click Create Google Meet again.');
    if (req.query?.error) return oauthError(res, flow.web_origin, flow.request_id, 'Google sign-in was cancelled or permission was not granted.');
    if (!req.query?.code) return oauthError(res, flow.web_origin, flow.request_id, 'Google did not return an authorization code.');
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(flow.user_id);
    const eligible = isHostEligible(user);
    if (eligible) return oauthError(res, flow.web_origin, flow.request_id, eligible.error, eligible.code);
    try {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
          code: String(req.query.code), code_verifier: flow.code_verifier, grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(15000),
      });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenData.access_token) throw new Error('Google sign-in could not be completed. Confirm the OAuth redirect URI and try again.');
      const meetResponse = await fetch('https://meet.googleapis.com/v2/spaces', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenData.access_token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ config: { accessType: 'OPEN', entryPointAccess: 'ALL' } }),
        signal: AbortSignal.timeout(15000),
      });
      const space = await meetResponse.json().catch(() => ({}));
      if (!meetResponse.ok) throw new Error(`Google Meet could not create an open room (${meetResponse.status}). Check Meet API access and your Google account's meeting policies.`);
      if (space.config?.accessType !== 'OPEN') throw new Error('Google Meet did not confirm open access. No Zapper PIN was created; check your Google account or Workspace policy.');
      if (!/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(space.meetingUri || '')) throw new Error('Google did not return a valid Meet link.');
      // Verify eligibility once more after the network calls; a trial may expire
      // or an administrator may disable the host while the popup is open.
      const currentUser = db.prepare('SELECT * FROM users WHERE id=?').get(flow.user_id);
      const currentEligibility = isHostEligible(currentUser);
      if (currentEligibility) return oauthError(res, flow.web_origin, flow.request_id, currentEligibility.error, currentEligibility.code);
      const session = createSession(currentUser, space.meetingUri, { googleCreated: true });
      return finishPopup(res, flow.web_origin, { type: 'zapper-google-meet-result', requestId: flow.request_id, ok: true, session });
    } catch (error) {
      console.warn('[GOOGLE MEET] Creation failed:', error.message);
      return oauthError(res, flow.web_origin, flow.request_id, error.message);
    }
  });
}

module.exports = googleMeetRoutes;
