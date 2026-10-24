// Google Meet session creation for Zapper hosts. Google consent is obtained
// once per host; refresh credentials are encrypted at rest in the existing DB.
// No Google access/refresh token is ever returned to the browser.
const crypto = require('crypto');

const SCOPE = 'https://www.googleapis.com/auth/meetings.space.created';
const FLOW_LIFETIME_MS = 10 * 60 * 1000;
const MEET_URL = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

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
  // JWT_SECRET is already required for Zapper auth. Derive a distinct AES key
  // without introducing another deployment secret. Changing JWT_SECRET also
  // invalidates stored Google connections; hosts can reconnect in that case.
  const encryptionKey = crypto.createHash('sha256')
    .update('Zapper/GoogleMeet/RefreshToken/v1\0')
    .update(String(process.env.JWT_SECRET || ''))
    .digest();

  db.exec(`CREATE TABLE IF NOT EXISTS google_meet_oauth_states (
    state TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    web_origin TEXT NOT NULL,
    request_id TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS google_meet_connections (
    user_id INTEGER PRIMARY KEY,
    oauth_client_id TEXT NOT NULL,
    refresh_token_encrypted TEXT NOT NULL,
    connected_at_ms INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  function encryptToken(token) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    // Versioned format: iv.tag.ciphertext, each base64url encoded.
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
  }
  function decryptToken(record) {
    const parts = String(record || '').split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Stored Google authorization is not readable. Reconnect Google.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(parts[1], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
  }
  const getConnection = userId => db.prepare('SELECT * FROM google_meet_connections WHERE user_id=? AND oauth_client_id=?').get(userId, clientId);
  const removeConnection = userId => db.prepare('DELETE FROM google_meet_connections WHERE user_id=? AND oauth_client_id=?').run(userId, clientId);
  function saveConnection(userId, refreshToken) {
    db.prepare(`INSERT INTO google_meet_connections(user_id,oauth_client_id,refresh_token_encrypted,connected_at_ms)
      VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
      oauth_client_id=excluded.oauth_client_id, refresh_token_encrypted=excluded.refresh_token_encrypted,
      connected_at_ms=excluded.connected_at_ms`)
      .run(userId, clientId, encryptToken(refreshToken), Date.now());
  }

  const safeError = message => String(message || 'Google Meet setup failed. Try again.').slice(0, 240);
  const oauthError = (res, origin, requestId, message, code = '') => finishPopup(res, origin, {
    type: 'zapper-google-meet-result', requestId, ok: false, error: safeError(message), code,
  });

  // The OAuth callback has no dependency on the browser being signed in:
  // PKCE, single-use state and the stored host ID bind this request to Zapper.
  // The popup does not auto-join Meet or turn on the host's camera/microphone.
  function finishPopup(res, origin, payload) {
    const destination = allowedOrigins.includes(origin) ? origin : null;
    const safePayload = JSON.stringify(payload).replace(/</g, '\\u003c');
    const safeOrigin = JSON.stringify(destination);
    const sessionLink = payload.ok && MEET_URL.test(payload.session?.meetUrl || '') ? payload.session.meetUrl : '';
    const safeLink = JSON.stringify(sessionLink);
    const safeReturn = JSON.stringify(destination || '');
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
    return res.send(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Zapper Google Meet</title><style>body{font:16px system-ui;margin:3rem;background:#081625;color:#fff}a{color:#91c6ff}button{padding:10px 16px;cursor:pointer}</style><h2>${sessionLink ? 'Google Meet created' : 'Google Meet authorization'}</h2><p id="result"></p><p id="details"></p><p><a id="meet" hidden>Open Google Meet</a> <a id="return" hidden>Return to Zapper</a></p><button id="close" type="button">Close this window</button><script>
const result=${safePayload}; const target=${safeOrigin}; const meetUrl=${safeLink}; const returnUrl=${safeReturn};
document.getElementById('result').textContent=result.ok ? 'Your meeting has been created. Return to Zapper for the session PIN.' : result.error;
if(result.ok && result.session) document.getElementById('details').textContent='PIN: '+result.session.pin;
if(meetUrl){const a=document.getElementById('meet');a.href=meetUrl;a.hidden=false;}
if(returnUrl){const a=document.getElementById('return');a.href=returnUrl;a.hidden=false;}
document.getElementById('close').onclick=()=>window.close();
if(target && window.opener){window.opener.postMessage(result,target);}
</script></html>`);
  }

  async function requestToken(params) {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, payload };
  }

  async function createGoogleSession(userId, accessToken) {
    const meetResponse = await fetch('https://meet.googleapis.com/v2/spaces', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ config: { accessType: 'OPEN', entryPointAccess: 'ALL' } }),
      signal: AbortSignal.timeout(15000),
    });
    const space = await meetResponse.json().catch(() => ({}));
    if (!meetResponse.ok) throw new Error(`Google Meet could not create an open room (${meetResponse.status}). Check Google Meet API access and your Google account's meeting policies.`);
    if (space.config?.accessType !== 'OPEN') throw new Error('Google Meet did not confirm open access. No Zapper PIN was created; check your Google account or Workspace policy.');
    if (!MEET_URL.test(space.meetingUri || '')) throw new Error('Google did not return a valid Meet link.');
    // An administrator may disable access or the trial may expire during the Google request.
    const currentUser = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    const eligible = isHostEligible(currentUser);
    if (eligible) {
      const error = new Error(eligible.error);
      error.code = eligible.code;
      error.status = eligible.status;
      throw error;
    }
    return createSession(currentUser, space.meetingUri, { googleCreated: true });
  }

  function newOAuthUrl(userId, origin, requestId) {
    const state = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const now = Date.now();
    db.prepare('DELETE FROM google_meet_oauth_states WHERE expires_at_ms<?').run(now);
    db.prepare('INSERT INTO google_meet_oauth_states(state,user_id,web_origin,request_id,code_verifier,expires_at_ms) VALUES(?,?,?,?,?,?)')
      .run(state, userId, origin, requestId, verifier, now + FLOW_LIFETIME_MS);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  app.get('/api/google/meet/status', auth, (req, res) => {
    res.set('Cache-Control', 'no-store').json({
      ok: true, enabled: configured, connected: configured && Boolean(getConnection(req.authUser.id)),
      maxZapperParticipants: 4, googleMeetParticipantCap: false,
    });
  });

  app.post('/api/google/meet/start', auth, async (req, res) => {
    const eligible = isHostEligible(req.authUser);
    if (eligible) return res.status(eligible.status).json({ ok: false, code: eligible.code, error: eligible.error });
    if (!configured) return res.status(503).json({ ok: false, code: 'GOOGLE_MEET_NOT_CONFIGURED', error: 'Automatic Google Meet requires a one-time Google Cloud OAuth client setup by the Zapper administrator. The manual Meet link remains available.' });
    const origin = String(req.headers.origin || '').replace(/\/$/, '');
    if (!allowedOrigins.includes(origin)) return res.status(403).json({ ok: false, error: 'This website is not allowed to create Google Meet sessions.' });
    const requestId = String(req.body?.requestId || '');
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) return res.status(400).json({ ok: false, error: 'Invalid request identifier.' });

    const connection = getConnection(req.authUser.id);
    if (connection) {
      try {
        const refresh = await requestToken({ refresh_token: decryptToken(connection.refresh_token_encrypted), grant_type: 'refresh_token' });
        if (refresh.ok && refresh.payload.access_token) {
          const session = await createGoogleSession(req.authUser.id, refresh.payload.access_token);
          return res.set('Cache-Control', 'no-store').json({ ok: true, session, reusedGoogleConnection: true });
        }
        if (!['invalid_grant', 'invalid_token'].includes(refresh.payload.error)) {
          throw new Error('Google could not refresh the Meet connection. Try again shortly, or reconnect Google if the issue persists.');
        }
      } catch (error) {
        if (!/not readable|Unsupported state|authenticate data/i.test(error.message)) {
          console.warn('[GOOGLE MEET] Saved authorization failed:', error.message);
          return res.status(error.status || 502).json({ ok: false, code: error.code || 'GOOGLE_MEET_ERROR', error: safeError(error.message) });
        }
      }
      // Revoked, expired or unreadable refresh tokens require a fresh Google sign-in.
      removeConnection(req.authUser.id);
    }
    return res.set('Cache-Control', 'no-store').json({
      ok: true, requiresGoogleSignIn: true, requestId,
      url: newOAuthUrl(req.authUser.id, origin, requestId),
    });
  });

  app.get('/api/google/meet/callback', async (req, res) => {
    const state = String(req.query?.state || '');
    if (!/^[a-zA-Z0-9_-]{30,100}$/.test(state)) return res.status(400).send('Invalid or missing Google OAuth state. Return to Zapper and retry.');
    const flow = db.prepare('SELECT * FROM google_meet_oauth_states WHERE state=?').get(state);
    if (!flow) return res.status(400).send('This Google sign-in has already been used or expired. Return to Zapper and retry.');
    // Atomically consume the state before any external requests.
    db.prepare('DELETE FROM google_meet_oauth_states WHERE state=?').run(state);
    if (flow.expires_at_ms <= Date.now()) return oauthError(res, flow.web_origin, flow.request_id, 'Google sign-in expired. Click Create Session again.');
    if (req.query?.error) return oauthError(res, flow.web_origin, flow.request_id, 'Google sign-in was cancelled or permission was not granted.');
    if (!req.query?.code) return oauthError(res, flow.web_origin, flow.request_id, 'Google did not return an authorization code.');
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(flow.user_id);
    const eligible = isHostEligible(user);
    if (eligible) return oauthError(res, flow.web_origin, flow.request_id, eligible.error, eligible.code);
    try {
      const token = await requestToken({
        redirect_uri: redirectUri, code: String(req.query.code),
        code_verifier: flow.code_verifier, grant_type: 'authorization_code',
      });
      if (!token.ok || !token.payload.access_token) throw new Error('Google sign-in could not be completed. Confirm the OAuth redirect URI and try again.');
      const session = await createGoogleSession(flow.user_id, token.payload.access_token);
      if (token.payload.refresh_token) saveConnection(flow.user_id, token.payload.refresh_token);
      return finishPopup(res, flow.web_origin, {
        type: 'zapper-google-meet-result', requestId: flow.request_id, ok: true, session,
      });
    } catch (error) {
      console.warn('[GOOGLE MEET] Creation failed:', error.message);
      return oauthError(res, flow.web_origin, flow.request_id, error.message, error.code);
    }
  });
}

module.exports = googleMeetRoutes;
