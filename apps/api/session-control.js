const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const googleMeetRoutes = require('./google-meet');

module.exports = function createSessionControl({ app, dataDir }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'zapper.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'host',
      status TEXT NOT NULL DEFAULT 'pending',
      approval_status TEXT NOT NULL DEFAULT 'pending',
      registration_approved_at_ms INTEGER,
      trial_started_at_ms INTEGER,
      trial_ends_at_ms INTEGER,
      subscription_status TEXT NOT NULL DEFAULT 'inactive',
      subscription_started_at_ms INTEGER,
      subscription_valid_until_ms INTEGER,
      last_login_at_ms INTEGER,
      created_at_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS host_sessions(
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      pin TEXT NOT NULL UNIQUE,
      meet_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      active INTEGER NOT NULL DEFAULT 1,
      created_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      ended_at_ms INTEGER,
      participant_started_at_ms INTEGER,
      last_speech_at_ms INTEGER,
      end_reason TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS transcripts(
      id TEXT PRIMARY KEY,
      host_session_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      google_email TEXT NOT NULL DEFAULT '',
      started_at_ms INTEGER NOT NULL,
      ended_at_ms INTEGER NOT NULL,
      transcript_text TEXT NOT NULL,
      pdf_blob BLOB,
      pdf_filename TEXT,
      created_at_ms INTEGER NOT NULL,
      FOREIGN KEY(host_session_id) REFERENCES host_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS session_live_segments(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_session_id TEXT NOT NULL,
      source_id TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      captured_at_ms INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      FOREIGN KEY(host_session_id) REFERENCES host_sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS password_reset_tokens(
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at_ms INTEGER NOT NULL,
      used_at_ms INTEGER,
      created_at_ms INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS app_meta(
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON host_sessions(user_id, created_at_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_transcripts_user ON transcripts(user_id, ended_at_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_transcripts_session ON transcripts(host_session_id, ended_at_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_live_segments_session ON session_live_segments(host_session_id, captured_at_ms ASC);
    CREATE INDEX IF NOT EXISTS idx_password_reset_hash ON password_reset_tokens(token_hash);
  `);

  // Safe in-place migrations for databases created by earlier Zapper builds.
  const ensureColumn = (table, column, definition) => {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    if (!columns.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  ensureColumn('users', 'role', "TEXT NOT NULL DEFAULT 'host'");
  ensureColumn('users', 'approval_status', "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn('users', 'registration_approved_at_ms', 'INTEGER');
  ensureColumn('users', 'trial_started_at_ms', 'INTEGER');
  ensureColumn('users', 'trial_ends_at_ms', 'INTEGER');
  ensureColumn('users', 'subscription_started_at_ms', 'INTEGER');
  ensureColumn('users', 'last_login_at_ms', 'INTEGER');

  // SQLite-level safety net: even a legacy registration handler that inserts a
  // host without subscription fields must persist the one-time trial. Existing
  // subscriptions, trial history, disabled accounts and historical imports are
  // not changed by this INSERT-only trigger.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS host_registration_trial_v318
    AFTER INSERT ON users
    WHEN NEW.role='host'
      AND NEW.status <> 'disabled'
      AND NEW.subscription_status IN ('inactive','active')
      AND NEW.trial_started_at_ms IS NULL AND NEW.trial_ends_at_ms IS NULL
      AND NEW.subscription_started_at_ms IS NULL AND NEW.subscription_valid_until_ms IS NULL
      AND NEW.created_at_ms BETWEEN (CAST(strftime('%s','now') AS INTEGER)*1000 - 86400000)
                               AND (CAST(strftime('%s','now') AS INTEGER)*1000 + 1000)
    BEGIN
      UPDATE users SET status='active', approval_status='approved',
        registration_approved_at_ms=COALESCE(registration_approved_at_ms, NEW.created_at_ms),
        trial_started_at_ms=NEW.created_at_ms,
        trial_ends_at_ms=NEW.created_at_ms + 86400000,
        subscription_status='active',
        subscription_started_at_ms=NEW.created_at_ms,
        subscription_valid_until_ms=NEW.created_at_ms + 86400000
      WHERE id=NEW.id;
    END;
  `);

  // Repair only *recent, unused* registrations left incomplete by a previously
  // deployed API. Use the ORIGINAL registration time; never restart the clock.
  // Older accounts, users with any sessions, historical subscriptions/trials,
  // disabled accounts and administrator accounts must not receive new access.
  const repairedTrialAccounts = db.prepare(`
    UPDATE users SET status='active', approval_status='approved',
      registration_approved_at_ms=COALESCE(registration_approved_at_ms, created_at_ms),
      trial_started_at_ms=created_at_ms,
      trial_ends_at_ms=created_at_ms+86400000,
      subscription_status='active',
      subscription_started_at_ms=created_at_ms,
      subscription_valid_until_ms=created_at_ms+86400000
    WHERE role='host' AND status IN ('active','pending')
      AND subscription_status IN ('inactive','active')
      AND trial_started_at_ms IS NULL AND trial_ends_at_ms IS NULL
      AND subscription_started_at_ms IS NULL AND subscription_valid_until_ms IS NULL
      AND created_at_ms BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM host_sessions WHERE user_id=users.id)
  `).run(Date.now()-86400000, Date.now()).changes;
  if (repairedTrialAccounts) console.info(`[TRIAL] Repaired ${repairedTrialAccounts} recent, incomplete first-time registration(s).`);

  // Registration is self-service. Unlock legacy pending hosts without resetting
  // subscriptions or giving existing accounts a new trial. Disabled users stay disabled.
  db.prepare("UPDATE users SET approval_status='approved', registration_approved_at_ms=COALESCE(registration_approved_at_ms, created_at_ms), status=CASE WHEN status='pending' THEN 'active' ELSE status END WHERE approval_status <> 'approved' OR status='pending'").run();
  ensureColumn('transcripts', 'pdf_blob', 'BLOB');
  ensureColumn('transcripts', 'pdf_filename', 'TEXT');
  ensureColumn('transcripts', 'transcript_segments_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn('host_sessions', 'active', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('host_sessions', 'participant_started_at_ms', 'INTEGER');
  ensureColumn('host_sessions', 'last_speech_at_ms', 'INTEGER');
  ensureColumn('host_sessions', 'end_reason', 'TEXT');
  ensureColumn('host_sessions', 'participant_google_email', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('host_sessions', 'google_meet_created', 'INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE TABLE IF NOT EXISTS session_participant_seats(
    seat_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at_ms INTEGER NOT NULL,
    FOREIGN KEY(session_id) REFERENCES host_sessions(id) ON DELETE CASCADE
  ); CREATE INDEX IF NOT EXISTS idx_participant_seats_session ON session_participant_seats(session_id,active);`);
  ensureColumn('session_participant_seats', 'device_id', "TEXT NOT NULL DEFAULT ''");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_session_device_seat ON session_participant_seats(session_id,device_id) WHERE device_id<>''");
  // Normalize the explicit active flag for databases created by earlier builds.
  db.exec("UPDATE host_sessions SET active=CASE WHEN status='active' AND ended_at_ms IS NULL THEN 1 ELSE 0 END;");

  const jwtSecretRaw = String(process.env.JWT_SECRET || '').trim();
  const jwtSecret = jwtSecretRaw || crypto.randomBytes(48).toString('hex');
  if (!jwtSecretRaw) console.warn('[AUTH] JWT_SECRET is not set. Set a stable 32+ character JWT_SECRET on Railway.');

  const trialDurationMs = 24 * 60 * 60 * 1000; // One-time trial starts at registration, not first session.
  const planPriceInr = Math.max(1, Number(process.env.PLAN_PRICE_INR || 1000));
  const portalTokenDays = Math.max(1, Number(process.env.PORTAL_TOKEN_DAYS || 7));
  // Hard product limit: a host session can remain active for at most 3h 30m.
  // Railway may lower this value for testing, but it can never exceed 210 minutes.
  const hostSessionMaxMinutes = Math.max(30, Math.min(210, Number(process.env.HOST_SESSION_MAX_MINUTES || 210)));
  const hostSessionMaxMs = hostSessionMaxMinutes * 60000;
  // Existing Railway values such as 180 must not make participant auth expire
  // before the allowed host session duration.
  const participantTokenMinutes = Math.max(hostSessionMaxMinutes, Number(process.env.PARTICIPANT_TOKEN_MINUTES || hostSessionMaxMinutes));
  const sessionHours = Math.max(1, Number(process.env.HOST_SESSION_HOURS || 12)); // legacy compatibility only
  const sessionRetention = Math.max(1, Math.min(50, Number(process.env.SESSION_RETENTION || 15)));
  const transcriptRetention = Math.max(1, Math.min(50, Number(process.env.TRANSCRIPT_RETENTION || 15)));
  // Kept for backwards-compatible config reporting only. Active sessions are host-controlled and are never auto-ended for silence.
  const sessionIdleTimeoutMinutes = Math.max(1, Math.min(240, Number(process.env.SESSION_IDLE_TIMEOUT_MINUTES || 20)));
  const pdfPauseTimestampSeconds = Math.max(10, Math.min(300, Number(process.env.PDF_PAUSE_TIMESTAMP_SECONDS || 30)));
  const pdfPauseTimestampMs = pdfPauseTimestampSeconds * 1000;
  const adminKey = String(process.env.ADMIN_KEY || '').trim();
  const passwordResetMinutes = Math.max(10, Math.min(120, Number(process.env.PASSWORD_RESET_MINUTES || 30)));
  const passwordResetBaseUrl = String(process.env.PASSWORD_RESET_BASE_URL || process.env.WEB_APP_URL || 'https://zapper-prod.vercel.app').trim().replace(/\/+$/, '');
  const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
  const passwordResetFrom = String(process.env.PASSWORD_RESET_FROM || 'Zapper <no-reply@zapperapp.in>').trim();
  const returnResetLink = String(process.env.PASSWORD_RESET_RETURN_LINK || '').toLowerCase() === 'true';

  const normalizeEmail = value => String(value || '').trim().toLowerCase();
  const configuredAdminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
  const normalizeMeetUrl = value => {
    let input = String(value || '').trim();
    if (!input) return null;
    input = input.replace(/^https?:\/\//i, '').replace(/^meet\.google\.com\//i, '').split(/[?#]/)[0].replace(/^\/+|\/+$/g, '');
    const code = input.match(/^([a-z]{3}-[a-z]{4}-[a-z]{3})$/i)?.[1];
    return code ? `https://meet.google.com/${code.toLowerCase()}` : null;
  };

  // Expiry is enforced in the database even when a user keeps an old JWT.
  // A periodic sweep also persists inactive status if nobody visits the site.
  function expireSubscriptions(now = Date.now()) {
    return db.prepare("UPDATE users SET subscription_status='inactive' WHERE subscription_status='active' AND subscription_valid_until_ms IS NOT NULL AND subscription_valid_until_ms<=?").run(now).changes;
  }
  expireSubscriptions();
  const subscriptionSweepTimer = setInterval(() => {
    try { expireSubscriptions(); } catch (error) { console.error('[SUBSCRIPTION] Expiry sweep failed:', error.message); }
  }, 60 * 1000);
  subscriptionSweepTimer.unref();

  function subscriptionState(user) {
    if (!user || user.status !== 'active') return { valid: false, status: 'inactive', startedAt: null, validUntil: null };
    if (user.subscription_status === 'active' && Number(user.subscription_valid_until_ms || 0) <= Date.now()) {
      expireSubscriptions();
    }
    const startedAt = Number(user.subscription_started_at_ms || 0) || null;
    const until = Number(user.subscription_valid_until_ms || 0) || null;
    const valid = user.subscription_status === 'active' && Boolean(until) && until > Date.now();
    return {
      valid,
      status: valid ? 'active' : 'inactive',
      startedAt,
      validUntil: until,
    };
  }

  const publicUser = user => {
    const sub = subscriptionState(user);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role || 'host',
      status: user.status,
      approvalStatus: 'approved', // retained for compatibility with previously deployed clients
      trialStartedAt: user.trial_started_at_ms || null,
      trialEndsAt: user.trial_ends_at_ms || null,
      subscriptionStatus: sub.status,
      subscriptionStartedAt: sub.startedAt,
      subscriptionValidUntil: sub.validUntil,
      lastLoginAt: user.last_login_at_ms || null,
      createdAt: user.created_at_ms,
    };
  };

  function signToken(payload, ttlMs, issuer, audience = '') {
    const body = { ...payload, iss: issuer, aud: audience, exp: Date.now() + ttlMs, iat: Date.now() };
    const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
    const sig = crypto.createHmac('sha256', jwtSecret).update(encoded).digest('base64url');
    return `${encoded}.${sig}`;
  }

  function verifyToken(raw, issuer, audience = '') {
    const [encoded, sig] = String(raw || '').split('.');
    if (!encoded || !sig) throw new Error('invalid token');
    const expected = crypto.createHmac('sha256', jwtSecret).update(encoded).digest('base64url');
    if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) throw new Error('invalid signature');
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.iss !== issuer || (audience && payload.aud !== audience) || Number(payload.exp || 0) <= Date.now()) throw new Error('expired token');
    return payload;
  }

  function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  function verifyPassword(password, stored) {
    try {
      const [salt, hashHex] = String(stored || '').split(':');
      if (!salt || !hashHex) return false;
      const actual = crypto.scryptSync(String(password), salt, 64);
      const expected = Buffer.from(hashHex, 'hex');
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch (_) { return false; }
  }

  const hashResetToken = raw => crypto.createHash('sha256').update(String(raw || '')).digest('hex');
  async function sendPasswordResetEmail(email, resetLink) {
    if (!resendApiKey) {
      console.warn(`[AUTH] Password reset requested for ${email}, but RESEND_API_KEY is not configured.`);
      return false;
    }
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: passwordResetFrom,
          to: [email],
          subject: 'Reset your Zapper password',
          html: `<div style="font-family:Arial,sans-serif;color:#0b1728;line-height:1.6"><h2>Reset your Zapper password</h2><p>Use the secure link below to choose a new password. This link expires in ${passwordResetMinutes} minutes.</p><p><a href="${resetLink}" style="display:inline-block;background:#246ff2;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Reset password</a></p><p>If you did not request this, you can ignore this email.</p></div>`
        }),
      });
      if (!response.ok) console.warn('[AUTH] Password reset email provider rejected the request:', response.status);
      return response.ok;
    } catch (error) {
      console.warn('[AUTH] Password reset email failed:', error.message);
      return false;
    }
  }

  // Same website login is used for hosts and admins. ADMIN_EMAIL promotes an
  // existing account to admin; ADMIN_PASSWORD can bootstrap it when absent.
  function bootstrapAdmin() {
    const email = configuredAdminEmail;
    const password = String(process.env.ADMIN_PASSWORD || '');
    const name = String(process.env.ADMIN_NAME || 'Zapper Admin').trim().slice(0, 80) || 'Zapper Admin';
    if (!email) return;
    let user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!user) {
      if (password.length < 8) {
        console.warn('[ADMIN] ADMIN_EMAIL is set but no existing account was found and ADMIN_PASSWORD is shorter than 8 characters.');
        return;
      }
      const now = Date.now();
      const info = db.prepare(`INSERT INTO users(email,password_hash,name,role,status,approval_status,registration_approved_at_ms,subscription_status,created_at_ms)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(email, hashPassword(password), name, 'admin', 'active', 'approved', now, 'inactive', now);
      user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
      console.log(`[ADMIN] Created admin account ${user.email}`);
    } else if (user.role !== 'admin' || user.status !== 'active') {
      db.prepare("UPDATE users SET role='admin', status='active', approval_status='approved', registration_approved_at_ms=COALESCE(registration_approved_at_ms, ?) WHERE id=?").run(Date.now(), user.id);
      console.log(`[ADMIN] Promoted ${user.email} to admin.`);
    }
  }
  bootstrapAdmin();

  const portalSign = user => signToken({ sub: Number(user.id), type: 'portal' }, portalTokenDays * 86400000, 'zapper-portal');
  const participantSign = (user, session, seatId = '') => signToken({ sub: Number(user.id), sessionId: session.id, pin: session.pin, type: 'participant', ...(seatId ? { jti: seatId } : {}) }, participantTokenMinutes * 60000, 'zapper-desktop', 'zapper-electron');

  function auth(req, res, next) {
    try {
      const raw = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const payload = verifyToken(raw, 'zapper-portal');
      if (payload.type !== 'portal') throw new Error('wrong token');
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(payload.sub);
      if (!user) return res.status(403).json({ ok: false, error: 'Account access is unavailable.' });
      if (user.status !== 'active') return res.status(403).json({ ok: false, error: 'Account access is disabled.' });
      req.authUser = user;
      next();
    } catch (_) {
      res.status(401).json({ ok: false, error: 'Please sign in again.' });
    }
  }

  function adminAuth(req, res, next) {
    if (adminKey && String(req.headers['x-admin-key'] || '') === adminKey) {
      req.adminViaKey = true;
      return next();
    }
    auth(req, res, () => {
      if (req.authUser?.role !== 'admin') return res.status(403).json({ ok: false, error: 'Administrator access required.' });
      next();
    });
  }

  // Session lifecycle rule: participant Leave, browser refresh and silence do not
  // end a PIN. The host may end it earlier, and the backend enforces one hard
  // maximum duration of 3h 30m (or a lower HOST_SESSION_MAX_MINUTES override).
  function endSessionAtLimit(session, now = Date.now()) {
    if (!session || Number(session.active || 0) !== 1 || session.status !== 'active') return false;
    const hardEndAt = Number(session.created_at_ms || 0) + hostSessionMaxMs;
    if (!hardEndAt || now < hardEndAt) return false;
    const result = db.prepare("UPDATE host_sessions SET status='ended', active=0, ended_at_ms=?, end_reason='max_duration' WHERE id=? AND active=1 AND status='active'")
      .run(hardEndAt, session.id);
    if (Number(result.changes || 0)) {
      try { finalizeSessionTranscript(session.id, hardEndAt); } catch (error) { console.error('[SESSION] Max-duration PDF finalization failed:', error.message); }
      return true;
    }
    return false;
  }
  function expireClockSessions(now = Date.now()) {
    const cutoff = Number(now) - hostSessionMaxMs;
    const rows = db.prepare("SELECT * FROM host_sessions WHERE active=1 AND status='active' AND created_at_ms<=?").all(cutoff);
    let ended = 0;
    for (const row of rows) if (endSessionAtLimit(row, Number(now))) ended += 1;
    return ended;
  }
  function sweepIdleSessions(now = Date.now()) { return expireClockSessions(now); }

  function participantTokenState(rawToken) {
    try {
      const payload = verifyToken(rawToken, 'zapper-desktop', 'zapper-electron');
      if (payload.type !== 'participant') return null;
      let session = db.prepare('SELECT * FROM host_sessions WHERE id=? AND user_id=?').get(payload.sessionId, payload.sub);
      const user = session && db.prepare('SELECT * FROM users WHERE id=?').get(payload.sub);
      if (!session || !user) return null;
      if (Number(session.google_meet_created || 0) === 1) {
        const seat = payload.jti && db.prepare('SELECT active FROM session_participant_seats WHERE seat_id=? AND session_id=?').get(payload.jti, session.id);
        if (!seat || Number(seat.active || 0) !== 1) return null;
      }
      if (endSessionAtLimit(session, Date.now())) session = db.prepare('SELECT * FROM host_sessions WHERE id=?').get(session.id);
      const active = Number(session.active || 0) === 1 && session.status === 'active';
      return { payload, session, user, active, subscriptionValid: subscriptionState(user).valid };
    } catch (_) { return null; }
  }

  // Web dashboard microphone captures use a separate, short-lived token. They
  // do not redeem the PIN, consume a desktop seat, or authorize other sessions.
  function hostAudioTokenState(rawToken) {
    try {
      const payload = verifyToken(rawToken, 'zapper-host-audio', 'zapper-web');
      if (payload.type !== 'host_audio') return null;
      let session = db.prepare('SELECT * FROM host_sessions WHERE id=? AND user_id=?').get(payload.sessionId, payload.sub);
      const user = session && db.prepare('SELECT * FROM users WHERE id=?').get(payload.sub);
      if (!session || !user || user.status !== 'active' || user.role === 'admin') return null;
      if (endSessionAtLimit(session, Date.now())) session = db.prepare('SELECT * FROM host_sessions WHERE id=?').get(session.id);
      return { payload, session, user, active: Number(session.active || 0) === 1 && session.status === 'active' };
    } catch (_) { return null; }
  }

  function verifyHostAudioToken(rawToken) {
    const state = hostAudioTokenState(rawToken);
    return state?.active ? { payload: state.payload, session: state.session, user: state.user } : null;
  }

  // Called only for a previously authenticated host microphone socket. The
  // one-hour connection token may expire while a 3h30m session is still live;
  // the backend must nevertheless see End Session and stop audio promptly.
  function hostAudioSessionState(sessionId, userId) {
    let session = db.prepare('SELECT * FROM host_sessions WHERE id=? AND user_id=?').get(sessionId, userId);
    const user = session && db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    if (!session || !user) return { active: false };
    if (endSessionAtLimit(session, Date.now())) session = db.prepare('SELECT * FROM host_sessions WHERE id=?').get(session.id);
    return { active: user.status === 'active' && session.status === 'active' && Number(session.active || 0) === 1 };
  }

  function verifyParticipantToken(rawToken, options = {}) {
    const state = participantTokenState(rawToken);
    if (!state) return null;
    if (state.active) return { payload: state.payload, session: state.session, user: state.user };
    if (options.allowEnded && Number(state.session.active || 0) === 0) {
      return { payload: state.payload, session: state.session, user: state.user };
    }
    return null;
  }

  function touchSessionSpeech(sessionId, at = Date.now()) {
    const ts = Math.max(1, Number(at) || Date.now());
    return Number(db.prepare(`UPDATE host_sessions SET last_speech_at_ms=?
      WHERE id=? AND active=1 AND status='active'`).run(ts, String(sessionId || '')).changes || 0);
  }

  function uniquePin() {
    for (let i = 0; i < 50; i += 1) {
      const pin = String(crypto.randomInt(100000, 1000000));
      if (!db.prepare('SELECT 1 FROM host_sessions WHERE pin=? AND status=?').get(pin, 'active')) return pin;
    }
    throw new Error('Could not allocate a session PIN. Please retry.');
  }

  function trimUserSessions(userId) {
    // Never delete an active host-controlled session just to satisfy retention.
    // Keep all active sessions, plus the newest ended sessions up to the configured history limit.
    const ended = db.prepare(`SELECT id FROM host_sessions WHERE user_id=? AND active=0 ORDER BY created_at_ms DESC`).all(userId);
    const remove = ended.slice(sessionRetention);
    const del = db.prepare('DELETE FROM host_sessions WHERE id=? AND user_id=? AND active=0');
    for (const row of remove) del.run(row.id, userId);
  }

  function trimTranscripts(userId) {
    db.prepare(`DELETE FROM transcripts WHERE user_id=? AND id NOT IN (
      SELECT id FROM transcripts WHERE user_id=? ORDER BY ended_at_ms DESC, created_at_ms DESC LIMIT ?
    )`).run(userId, userId, transcriptRetention);
  }

  function normalizeTranscriptText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function transcriptSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (Math.min(a.length, b.length) >= 18 && (a.includes(b) || b.includes(a))) return 0.95;
    const aWords = new Set(a.split(' ').filter(Boolean));
    const bWords = new Set(b.split(' ').filter(Boolean));
    if (!aWords.size || !bWords.size) return 0;
    let intersection = 0;
    for (const word of aWords) if (bWords.has(word)) intersection += 1;
    const union = new Set([...aWords, ...bWords]).size;
    return union ? intersection / union : 0;
  }

  function registerParticipantGoogleEmail(sessionId, email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return false;
    const result = db.prepare(`UPDATE host_sessions SET participant_google_email=CASE
      WHEN participant_google_email IS NULL OR participant_google_email='' THEN ?
      ELSE participant_google_email END
      WHERE id=?`).run(normalized, String(sessionId || ''));
    return Number(result.changes || 0) > 0;
  }

  function appendLiveTranscriptSegments(sessionId, segments, sourceId = '') {
    const id = String(sessionId || '');
    if (!id || !Array.isArray(segments) || !segments.length) return 0;
    const session = db.prepare('SELECT id,active,status,ended_at_ms FROM host_sessions WHERE id=?').get(id);
    if (!session) return 0;
    const endedAt = Number(session.ended_at_ms || 0);
    const graceDeadline = endedAt ? endedAt + 5000 : 0;
    if (Number(session.active || 0) !== 1 && (!endedAt || Date.now() > graceDeadline)) return 0;

    const recentStmt = db.prepare(`SELECT normalized_text,captured_at_ms FROM session_live_segments
      WHERE host_session_id=? AND captured_at_ms BETWEEN ? AND ? ORDER BY captured_at_ms DESC LIMIT 12`);
    const insertStmt = db.prepare(`INSERT INTO session_live_segments(host_session_id,source_id,text,normalized_text,captured_at_ms,created_at_ms)
      VALUES(?,?,?,?,?,?)`);
    let inserted = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const raw of segments) {
        const text = String(raw?.text || '').trim().slice(0, 12000);
        if (!text) continue;
        let at = Math.max(1, Number(raw?.at) || Date.now());
        if (endedAt) at = Math.min(at, endedAt);
        const normalized = normalizeTranscriptText(text);
        if (!normalized) continue;
        const nearby = recentStmt.all(id, Math.max(1, at - 12000), at + 12000);
        const duplicate = nearby.some(row => transcriptSimilarity(normalized, String(row.normalized_text || '')) >= 0.82);
        if (duplicate) continue;
        insertStmt.run(id, String(sourceId || '').slice(0, 120), text, normalized, at, Date.now());
        inserted += 1;
      }
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
    if (inserted && endedAt) finalizeSessionTranscript(id, endedAt);
    return inserted;
  }

  function appendLiveTranscriptSegment(sessionId, text, capturedAt = Date.now(), sourceId = '') {
    return appendLiveTranscriptSegments(sessionId, [{ text, at: capturedAt }], sourceId);
  }

  function finalizeSessionTranscript(sessionId, forcedEndedAt = null) {
    const session = db.prepare('SELECT * FROM host_sessions WHERE id=?').get(String(sessionId || ''));
    if (!session) return null;
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(session.user_id);
    if (!user) return null;
    const segmentRows = db.prepare(`SELECT text,captured_at_ms FROM session_live_segments
      WHERE host_session_id=? ORDER BY captured_at_ms ASC,id ASC`).all(session.id);
    const segments = segmentRows.map(row => ({ text: String(row.text || ''), at: Number(row.captured_at_ms || 0) })).filter(row => row.text);
    const endedAt = Math.max(1, Number(forcedEndedAt || session.ended_at_ms || Date.now()));
    const firstSegmentAt = segments.length ? Number(segments[0].at || 0) : 0;
    const startedAt = Math.max(1, Math.min(endedAt, Number(session.participant_started_at_ms || firstSegmentAt || session.created_at_ms || endedAt)));
    const transcriptText = segments.map(segment => segment.text).join('\n').trim();
    const transcriptId = `session-${session.id}`;
    const rowForPdf = {
      started_at_ms: startedAt,
      ended_at_ms: endedAt,
      google_email: normalizeEmail(session.participant_google_email),
      transcript_text: transcriptText,
      transcript_segments: segments,
    };
    const pdf = buildTranscriptPdf(rowForPdf, user, session);
    const pdfFilename = safePdfFilename(endedAt);

    // One authoritative transcript/PDF per host session. Remove any older
    // participant-local transcript rows created by builds prior to v3.1.9.
    db.prepare('DELETE FROM transcripts WHERE host_session_id=? AND id<>?').run(session.id, transcriptId);
    db.prepare(`INSERT INTO transcripts(id,host_session_id,user_id,google_email,started_at_ms,ended_at_ms,transcript_text,pdf_blob,pdf_filename,created_at_ms,transcript_segments_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        google_email=excluded.google_email,
        started_at_ms=excluded.started_at_ms,
        ended_at_ms=excluded.ended_at_ms,
        transcript_text=excluded.transcript_text,
        pdf_blob=excluded.pdf_blob,
        pdf_filename=excluded.pdf_filename,
        created_at_ms=excluded.created_at_ms,
        transcript_segments_json=excluded.transcript_segments_json`)
      .run(transcriptId, session.id, user.id, rowForPdf.google_email, startedAt, endedAt, transcriptText, pdf, pdfFilename, Date.now(), JSON.stringify(segments));
    trimTranscripts(user.id);
    trimUserSessions(user.id);
    return { transcriptId, pdfFilename, segmentCount: segments.length, startedAt, endedAt };
  }

  function pdfSafe(value) {
    return String(value ?? '')
      .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...').replace(/₹/g, 'Rs. ')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?');
  }

  function wrapPdfLine(text, width = 92) {
    const lines = [];
    for (const paragraph of pdfSafe(text).replace(/\t/g, '  ').split('\n')) {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
      if (!words.length) { lines.push(''); continue; }
      let line = '';
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (candidate.length > width) { if (line) lines.push(line); line = word; } else line = candidate;
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  function buildTranscriptPdf(row, user, hostSession) {
    const fmtMetaIst = ms => `${new Date(Number(ms)).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} IST`;
    const fmt24Ist = ms => new Date(Number(ms)).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const durationSec = Math.max(0, Math.round((row.ended_at_ms - row.started_at_ms) / 1000));
    const durationText = `${Math.floor(durationSec / 60)}m ${String(durationSec % 60).padStart(2, '0')}s`;
    const participantEmail = row.google_email || 'Not captured';
    const metaLine1 = `Participant: ${participantEmail}    PIN: ${hostSession.pin}`;
    const metaLine2 = `From: ${fmtMetaIst(row.started_at_ms)}    To: ${fmtMetaIst(row.ended_at_ms)}    Duration: ${durationText}`;
    const lines = [
      { text: 'ZAPPER MEETING TRANSCRIPT', bold: true, size: 12 },
      { text: '' },
      { text: metaLine1, mono: true, size: 8 },
      { text: metaLine2, mono: true, size: 8 },
      { text: '' },
      { text: 'TRANSCRIPT', bold: true, size: 10 },
      { text: '----------' },
    ];

    const segments = Array.isArray(row.transcript_segments) ? row.transcript_segments : [];
    if (segments.length) {
      let previousAt = null;
      for (const segment of segments) {
        const at = Number(segment.at || 0);
        const text = String(segment.text || '').trim();
        if (!text) continue;
        if (previousAt && at > previousAt && at - previousAt >= pdfPauseTimestampMs) {
          lines.push({ text: '' });
          lines.push({ text: `[${fmt24Ist(at)} IST]`, small: true });
        }
        for (const wrapped of wrapPdfLine(text)) lines.push({ text: wrapped });
        previousAt = at || previousAt;
      }
    } else {
      for (const wrapped of wrapPdfLine(row.transcript_text || 'No transcript content.')) lines.push({ text: wrapped });
    }

    const pages = [];
    for (let i = 0; i < lines.length; i += 55) pages.push(lines.slice(i, i + 55));
    const objects = [];
    const add = body => { objects.push(body); return objects.length; };
    const catalogId = add('');
    const pagesId = add('');
    const helveticaId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const courierId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
    const helveticaBoldId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    const pageIds = [];
    const esc = t => pdfSafe(t).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    for (const pageLines of pages) {
      const stream = ['BT', '/F1 9 Tf', '48 800 Td', '12 TL'];
      let currentFont = 'F1';
      let currentSize = 9;
      for (const line of pageLines) {
        const nextFont = line.mono ? 'F2' : (line.bold ? 'F3' : 'F1');
        const nextSize = Number(line.size || (line.small ? 7 : 9));
        if (nextFont !== currentFont || nextSize !== currentSize) {
          stream.push(`/${nextFont} ${nextSize} Tf`);
          currentFont = nextFont;
          currentSize = nextSize;
        }
        stream.push(`(${esc(line.text)}) Tj`, 'T*');
      }
      stream.push('ET');
      const content = stream.join('\n');
      const contentId = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
      pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${helveticaId} 0 R /F2 ${courierId} 0 R /F3 ${helveticaBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    }
    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    let pdf = '%PDF-1.4\n%Zapper\n'; const offsets = [0];
    objects.forEach((body, i) => { offsets[i + 1] = Buffer.byteLength(pdf, 'latin1'); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf, 'latin1');
  }

  const safePdfFilename = endedAt => `Zapper_${new Date(Number(endedAt)).toISOString().replace(/[:.]/g, '-')}.pdf`;

  app.get('/api/public/config', (_req, res) => {
    res.json({
      ok: true,
      plan: { priceInr: planPriceInr, billing: 'monthly' },
      retention: { sessions: sessionRetention, transcripts: transcriptRetention },
      sessionIdleTimeoutMinutes,
      hostSessionMaxMinutes,
    });
  });

  app.post('/api/auth/register', (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || '');
      if (configuredAdminEmail && email === configuredAdminEmail) return res.status(403).json({ ok: false, error: 'This email is reserved for the Zapper administrator.' });
      const name = String(req.body?.name || '').trim().slice(0, 80);
      if (!name) return res.status(400).json({ ok: false, error: 'Enter your name.' });
      if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return res.status(400).json({ ok: false, error: 'Use a valid email and a password with at least 8 characters.' });
      if (db.prepare('SELECT id FROM users WHERE lower(email)=?').get(email)) return res.status(409).json({ ok: false, error: 'This email is already registered.' });
      const now = Date.now();
      const trialEndsAt = now + trialDurationMs;
      // Unique email is enforced by SQLite. The trial is granted once, when
      // the user row is first inserted, and is never refreshed at login.
      const info = db.prepare(`INSERT INTO users(email,password_hash,name,role,status,approval_status,registration_approved_at_ms,trial_started_at_ms,trial_ends_at_ms,subscription_status,subscription_started_at_ms,subscription_valid_until_ms,created_at_ms)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(email, hashPassword(password), name, 'host', 'active', 'approved', now, now, trialEndsAt, 'active', now, trialEndsAt, now);
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
      // Never report success if the database failed to store the full trial.
      if (user.status !== 'active' || user.subscription_status !== 'active' ||
          user.subscription_started_at_ms !== now || user.subscription_valid_until_ms !== trialEndsAt ||
          user.trial_started_at_ms !== now || user.trial_ends_at_ms !== trialEndsAt) {
        console.error('[TRIAL] Registration persisted without the required trial dates for user ID:', user.id);
        return res.status(500).json({ ok: false, error: 'Account created but trial activation needs administrator assistance.' });
      }
      res.json({
        ok: true,
        approvalPending: false,
        user: publicUser(user),
        message: 'Account created. Your free 24-hour trial starts now. Sign in to begin; contact support after the trial to continue.'
      });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || /UNIQUE constraint failed: users\.email/i.test(error.message)) {
        return res.status(409).json({ ok: false, error: 'This email is already registered.' });
      }
      console.error('[AUTH] Registration failed:', error.message);
      return res.status(500).json({ ok: false, error: 'Registration failed. Please try again or contact support.' });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(normalizeEmail(req.body?.email));
    if (!user || !verifyPassword(String(req.body?.password || ''), user.password_hash)) return res.status(401).json({ ok: false, error: 'Invalid email or password.' });
    if (user.status !== 'active') return res.status(403).json({ ok: false, error: 'This account is currently disabled. Contact the Zapper administrator.' });
    const now = Date.now();
    db.prepare('UPDATE users SET last_login_at_ms=? WHERE id=?').run(now, user.id);
    const refreshed = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    res.json({ ok: true, token: portalSign(refreshed), user: publicUser(refreshed) });
  });

  app.post('/api/auth/forgot-password', async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const generic = { ok: true, message: 'If that email is registered, a password reset link has been generated.' };
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.json(generic);
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!user) return res.json(generic);
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashResetToken(rawToken);
    const now = Date.now();
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id=? OR expires_at_ms<? OR used_at_ms IS NOT NULL').run(user.id, now);
    db.prepare('INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at_ms,created_at_ms) VALUES(?,?,?,?,?)')
      .run(crypto.randomUUID(), user.id, tokenHash, now + passwordResetMinutes * 60000, now);
    const resetLink = `${passwordResetBaseUrl}/?reset=${encodeURIComponent(rawToken)}`;
    await sendPasswordResetEmail(user.email, resetLink);
    res.json(returnResetLink ? { ...generic, resetLink } : generic);
  });

  app.post('/api/auth/reset-password', (req, res) => {
    const rawToken = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');
    if (!rawToken || password.length < 8) return res.status(400).json({ ok: false, error: 'Use a valid reset link and a password with at least 8 characters.' });
    const now = Date.now();
    const row = db.prepare('SELECT * FROM password_reset_tokens WHERE token_hash=? AND used_at_ms IS NULL AND expires_at_ms>?').get(hashResetToken(rawToken), now);
    if (!row) return res.status(400).json({ ok: false, error: 'This password reset link is invalid or expired.' });
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), row.user_id);
    db.prepare('UPDATE password_reset_tokens SET used_at_ms=? WHERE id=?').run(now, row.id);
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id=? AND id<>?').run(row.user_id, row.id);
    res.json({ ok: true, message: 'Password updated. You can now sign in with the new password.' });
  });

  app.get('/api/account', auth, (req, res) => {
    res.json({ ok: true, user: publicUser(req.authUser), plan: { priceInr: planPriceInr, billing: 'monthly' }, retention: { sessions: sessionRetention, transcripts: transcriptRetention } });
  });

  function hostEligibility(user) {
    if (!user || user.status !== 'active') return { status: 403, error: 'Account access is disabled.' };
    if (user.role === 'admin') return { status: 403, error: 'Admin accounts manage Zapper; use a host account to create meeting sessions.' };
    if (!subscriptionState(user).valid) return { status: 402, code: 'SUBSCRIPTION_INACTIVE', error: 'Your trial or subscription has ended. Please contact the Zapper administrator to activate or renew your plan.' };
    return null;
  }

  // Shared by the existing manual route and Google OAuth callback. The PIN,
  // retention, trial and session lifetime logic remain identical.
  function createHostSession(user, meetUrlInput, options = {}) {
    const meetUrl = normalizeMeetUrl(meetUrlInput);
    if (!meetUrl) throw new Error('Invalid Google Meet link.');
    const now = Date.now();
    const pin = uniquePin(); const id = crypto.randomUUID();
    const expiresAt = now + hostSessionMaxMs;
    db.prepare('INSERT INTO host_sessions(id,user_id,pin,meet_url,status,active,created_at_ms,expires_at_ms,google_meet_created) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, user.id, pin, meetUrl, 'active', 1, now, expiresAt, options.googleCreated ? 1 : 0);
    trimUserSessions(user.id);
    return { id, pin, meetUrl, status: 'active', active: true, createdAt: now, expiresAt, maxMinutes: hostSessionMaxMinutes, googleCreated: Boolean(options.googleCreated) };
  }

  googleMeetRoutes({ app, db, auth, isHostEligible: hostEligibility, createSession: createHostSession,
    allowedOrigins: String(process.env.WEB_ORIGINS || 'http://localhost:5173').split(',').map(item => item.trim()).filter(Boolean),
  });

  app.post('/api/sessions', auth, (req, res) => {
    const denied = hostEligibility(req.authUser);
    if (denied) return res.status(denied.status).json({ ok: false, code: denied.code, error: denied.error });
    const meetUrl = normalizeMeetUrl(req.body?.meetUrl);
    if (!meetUrl) return res.status(400).json({ ok: false, error: 'Enter a valid Google Meet ID or link.' });
    // Existing manual Meet creation and PIN behavior remains available.
    res.json({ ok: true, session: createHostSession(req.authUser, meetUrl) });
  });

  // The host captures ONLY their own microphone in the browser. Google Meet
  // creation does not capture meeting audio, and the browser still asks consent.
  app.post('/api/sessions/:id/host-audio-token', auth, (req, res) => {
    if (req.authUser.role === 'admin') return res.status(403).json({ ok: false, error: 'Host account required.' });
    let session = db.prepare('SELECT * FROM host_sessions WHERE id=? AND user_id=?').get(String(req.params.id || ''), req.authUser.id);
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found.' });
    if (endSessionAtLimit(session, Date.now())) session = db.prepare('SELECT * FROM host_sessions WHERE id=?').get(session.id);
    if (session.status !== 'active' || !Number(session.active || 0)) return res.status(409).json({ ok: false, error: 'The session has ended.' });
    const remaining = Math.min(60 * 60 * 1000, Number(session.expires_at_ms || 0) - Date.now());
    if (remaining <= 0) return res.status(409).json({ ok: false, error: 'The session has expired.' });
    const captureToken = signToken({ sub: Number(req.authUser.id), sessionId: session.id, type: 'host_audio' }, remaining, 'zapper-host-audio', 'zapper-web');
    res.set('Cache-Control', 'no-store').json({ ok: true, captureToken });
  });

  app.get('/api/sessions', auth, (req, res) => {
    sweepIdleSessions(Date.now());
    // Always return every active session so the host can still see and explicitly end it.
    // Fill the remaining history slots with the newest ended sessions.
    const activeRows = db.prepare('SELECT id,pin,meet_url,status,active,created_at_ms,expires_at_ms,ended_at_ms,end_reason,google_meet_created FROM host_sessions WHERE user_id=? AND active=1 ORDER BY created_at_ms DESC').all(req.authUser.id);
    const endedLimit = Math.max(0, sessionRetention - activeRows.length);
    const endedRows = endedLimit ? db.prepare('SELECT id,pin,meet_url,status,active,created_at_ms,expires_at_ms,ended_at_ms,end_reason,google_meet_created FROM host_sessions WHERE user_id=? AND active=0 ORDER BY created_at_ms DESC LIMIT ?').all(req.authUser.id, endedLimit) : [];
    const rows = [...activeRows, ...endedRows].sort((a, b) => Number(b.created_at_ms || 0) - Number(a.created_at_ms || 0));
    res.json({ ok: true, sessions: rows.map(r => ({ id: r.id, pin: r.pin, meetUrl: r.meet_url, status: r.status, active: Number(r.active || 0) === 1, createdAt: r.created_at_ms, expiresAt: r.expires_at_ms, endedAt: r.ended_at_ms, endReason: r.end_reason || '', googleCreated: Number(r.google_meet_created || 0) === 1 })) });
  });

  app.post('/api/sessions/:id/end', auth, (req, res) => {
    const endedAt = Date.now();
    const result = db.prepare("UPDATE host_sessions SET status='ended', active=0, ended_at_ms=?, end_reason='host_ended' WHERE id=? AND user_id=? AND active=1 AND status='active'").run(endedAt, req.params.id, req.authUser.id);
    if (!Number(result.changes || 0)) return res.status(404).json({ ok: false, error: 'Active session not found or it has already ended.' });
    const finalized = finalizeSessionTranscript(req.params.id, endedAt);
    res.json({ ok: true, endedAt, transcriptId: finalized?.transcriptId || null, pdfFinalized: Boolean(finalized) });
  });

  app.post('/api/desktop/redeem-pin', (req, res) => {
    sweepIdleSessions(Date.now());
    const pin = String(req.body?.pin || '').replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(pin)) return res.status(400).json({ ok: false, error: 'Enter the 6-digit session PIN.' });
    const now = Date.now();
    const session = db.prepare("SELECT * FROM host_sessions WHERE pin=? AND active=1 AND status='active'").get(pin);
    const user = session && db.prepare('SELECT * FROM users WHERE id=?').get(session.user_id);
    if (!session || !user) return res.status(404).json({ ok: false, error: 'This is not a valid active PIN. It may have been ended or expired. Ask the host for a current 6-digit PIN.' });
    // Limit GOOGLE-CREATED sessions to four Zapper desktop participants.
    // This cannot limit people who independently open a shared Google Meet URL.
    let seatId = '';
    if (Number(session.google_meet_created || 0) === 1) {
      // Current desktop versions send a persistent installation ID so a user
      // can re-enter the same PIN without consuming additional participant slots.
      // Older desktop versions remain compatible, but cannot reuse a seat.
      const rawDeviceId = String(req.body?.deviceId || '').trim();
      const deviceId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawDeviceId) ? rawDeviceId.toLowerCase() : '';
      db.exec('BEGIN IMMEDIATE');
      try {
        const existingSeat = deviceId && db.prepare('SELECT seat_id FROM session_participant_seats WHERE session_id=? AND device_id=? AND active=1').get(session.id, deviceId);
        if (existingSeat) seatId = existingSeat.seat_id;
        else {
          const seats = Number(db.prepare('SELECT COUNT(*) AS count FROM session_participant_seats WHERE session_id=? AND active=1').get(session.id).count);
          if (seats >= 4) {
            db.exec('ROLLBACK');
            return res.status(409).json({ ok: false, code: 'SESSION_FULL', error: 'This Zapper session already has four participant slots in use. Ask the host to create a new session if more slots are needed.' });
          }
          seatId = crypto.randomUUID();
          const inactiveSeat = deviceId && db.prepare('SELECT seat_id FROM session_participant_seats WHERE session_id=? AND device_id=? AND active=0').get(session.id, deviceId);
          if (inactiveSeat) {
            seatId = inactiveSeat.seat_id;
            db.prepare('UPDATE session_participant_seats SET active=1 WHERE seat_id=?').run(seatId);
          } else db.prepare('INSERT INTO session_participant_seats(seat_id,session_id,active,created_at_ms,device_id) VALUES(?,?,1,?,?)').run(seatId, session.id, now, deviceId);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    db.prepare(`UPDATE host_sessions SET participant_started_at_ms=COALESCE(participant_started_at_ms, ?), last_speech_at_ms=COALESCE(last_speech_at_ms, ?) WHERE id=? AND active=1`).run(now, now, session.id);
    const refreshedSession = db.prepare('SELECT * FROM host_sessions WHERE id=?').get(session.id);
    res.set('Cache-Control', 'no-store').json({
      ok: true,
      meetUrl: refreshedSession.meet_url,
      sessionId: refreshedSession.id,
      sessionToken: participantSign(user, refreshedSession, seatId),
      idleTimeoutMinutes: sessionIdleTimeoutMinutes,
      expiresAt: refreshedSession.expires_at_ms,
      maxMinutes: hostSessionMaxMinutes,
      host: { name: user.name || user.email, email: user.email }
    });
  });

  app.get('/api/desktop/session-status', (req, res) => {
    const rawToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const state = participantTokenState(rawToken);
    if (!state) return res.status(401).json({ ok: false, active: false, error: 'Session authorization expired.' });
    const active = Boolean(state.active);
    res.set('Cache-Control', 'no-store').json({
      ok: true,
      active,
      status: state.session.status,
      endReason: state.session.end_reason || '',
      hostControlled: true,
    });
  });

  app.post('/api/desktop/end-session', (req, res) => {
    // Backwards-compatible participant detach endpoint. A participant may leave/reopen
    // Zapper without invalidating the host's PIN. Only /api/sessions/:id/end may end it.
    const verified = verifyParticipantToken(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''), { allowEnded: true });
    if (!verified) return res.status(401).json({ ok: false, error: 'Session authorization expired.' });
    if (Number(verified.session.google_meet_created || 0) === 1 && verified.payload.jti) {
      db.prepare('UPDATE session_participant_seats SET active=0 WHERE seat_id=? AND session_id=?').run(verified.payload.jti, verified.session.id);
    }
    res.json({ ok: true, active: Number(verified.session.active || 0) === 1, detached: true });
  });

  app.post('/api/desktop/transcripts', (req, res) => {
    // Backward-compatible/fallback sync only. Participant Leave must never
    // finalize a PDF or end a host session. The authoritative PDF is produced
    // only by the host End Session action from the session-level live ledger.
    const verified = verifyParticipantToken(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''), { allowEnded: true });
    if (!verified) return res.status(401).json({ ok: false, error: 'Session authorization expired. Enter the session PIN again.' });
    registerParticipantGoogleEmail(verified.session.id, req.body?.googleEmail);
    const endedAt = Math.min(Number(verified.session.ended_at_ms || 0) || Date.now(), Math.max(1, Number(req.body?.endedAt) || Date.now()));
    const startedAt = Math.max(1, Math.min(endedAt, Number(req.body?.startedAt) || endedAt));
    const rawSegments = Array.isArray(req.body?.transcriptSegments) ? req.body.transcriptSegments.slice(0, 10000) : [];
    let segments = rawSegments.map(segment => ({
      text: String(segment?.text || '').trim().slice(0, 12000),
      at: Math.max(startedAt, Math.min(endedAt, Number(segment?.at) || startedAt)),
    })).filter(segment => segment.text);
    if (!segments.length) {
      const text = String(req.body?.transcriptText || '').trim().slice(0, 500000);
      if (text) segments = text.split(/\n+/).map((line, index) => ({ text: line.trim(), at: Math.min(endedAt, startedAt + index) })).filter(segment => segment.text);
    }
    const appended = appendLiveTranscriptSegments(verified.session.id, segments, 'desktop-fallback');
    const sessionNow = db.prepare('SELECT active,ended_at_ms FROM host_sessions WHERE id=?').get(verified.session.id);
    let finalized = null;
    if (sessionNow && Number(sessionNow.active || 0) === 0 && Number(sessionNow.ended_at_ms || 0)) {
      finalized = finalizeSessionTranscript(verified.session.id, Number(sessionNow.ended_at_ms));
    }
    res.json({ ok: true, appended, finalized: Boolean(finalized), transcriptId: finalized?.transcriptId || null, pdfSaved: Boolean(finalized) });
  });

  app.get('/api/transcripts', auth, (req, res) => {
    const rows = db.prepare(`SELECT t.id,t.started_at_ms,t.ended_at_ms,t.google_email,t.created_at_ms,t.pdf_filename,s.pin,s.meet_url
      FROM transcripts t JOIN host_sessions s ON s.id=t.host_session_id WHERE t.user_id=? ORDER BY t.ended_at_ms DESC LIMIT ?`).all(req.authUser.id, transcriptRetention);
    res.json({ ok: true, sessions: rows.map(r => ({ id: r.id, startedAt: r.started_at_ms, endedAt: r.ended_at_ms, googleEmail: r.google_email, pin: r.pin, meetUrl: r.meet_url, createdAt: r.created_at_ms, pdfFilename: r.pdf_filename })) });
  });

  app.get('/api/transcripts/:id/pdf', auth, (req, res) => {
    const row = db.prepare('SELECT * FROM transcripts WHERE id=? AND user_id=?').get(String(req.params.id || ''), req.authUser.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Transcript not found.' });
    const session = db.prepare('SELECT * FROM host_sessions WHERE id=?').get(row.host_session_id);
    if (session && Number(session.active || 0) === 0 && Number(session.ended_at_ms || 0)) {
      finalizeSessionTranscript(session.id, Number(session.ended_at_ms));
      const refreshed = db.prepare('SELECT * FROM transcripts WHERE id=? AND user_id=?').get(row.id, req.authUser.id);
      if (refreshed) Object.assign(row, refreshed);
    }
    // Always regenerate using the current PDF layout so transcripts saved by older
    // versions do not keep obsolete host-account/Meet metadata in their stored blob.
    try { row.transcript_segments = JSON.parse(row.transcript_segments_json || '[]'); } catch (_) { row.transcript_segments = []; }
    const pdf = buildTranscriptPdf(row, req.authUser, session);
    const filename = row.pdf_filename || safePdfFilename(row.ended_at_ms);
    try { db.prepare('UPDATE transcripts SET pdf_blob=?, pdf_filename=? WHERE id=?').run(pdf, filename, row.id); } catch (_) {}
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store', 'Content-Length': String(pdf.length) });
    res.end(pdf);
  });

  function adminUserSummary(user) {
    const sub = subscriptionState(user);
    const sessionStats = db.prepare('SELECT COUNT(*) count, MAX(created_at_ms) last_at FROM host_sessions WHERE user_id=?').get(user.id);
    const transcriptStats = db.prepare('SELECT COUNT(*) count, MAX(ended_at_ms) last_at FROM transcripts WHERE user_id=?').get(user.id);
    const lastActivityAt = Math.max(Number(user.last_login_at_ms || 0), Number(sessionStats.last_at || 0), Number(transcriptStats.last_at || 0), Number(user.created_at_ms || 0));
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role || 'host',
      status: user.status,
      approvalStatus: 'approved',
      trialStartedAt: user.trial_started_at_ms || null,
      trialEndsAt: user.trial_ends_at_ms || null,
      subscriptionStatus: sub.status,
      subscriptionStartedAt: sub.startedAt,
      subscriptionValidUntil: sub.validUntil,
      createdAt: user.created_at_ms,
      lastLoginAt: user.last_login_at_ms || null,
      lastActivityAt,
      sessionCount: Number(sessionStats.count || 0),
      transcriptCount: Number(transcriptStats.count || 0),
    };
  }

  function approveRegistrationById(userId) {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(userId));
    if (!user) return { status: 404, error: 'User not found.' };
    if (user.role === 'admin') return { status: 400, error: 'Administrator accounts are already approved.' };
    // Idempotent on purpose: clicking Approve always leaves the account in the one
    // state that is allowed to sign in. Subscription activation remains separate.
    db.prepare("UPDATE users SET status='active', approval_status='approved', registration_approved_at_ms=COALESCE(registration_approved_at_ms, ?) WHERE id=?")
      .run(Date.now(), user.id);
    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    return { status: 200, user: updated };
  }

  app.get('/api/admin/users', adminAuth, (req, res) => {
    expireSubscriptions();
    const query = String(req.query?.q || '').trim().toLowerCase();
    const rows = query
      ? db.prepare("SELECT * FROM users WHERE lower(email) LIKE ? OR lower(name) LIKE ? ORDER BY created_at_ms DESC LIMIT 500").all(`%${query}%`, `%${query}%`)
      : db.prepare('SELECT * FROM users ORDER BY created_at_ms DESC LIMIT 500').all();
    res.json({ ok: true, users: rows.map(adminUserSummary) });
  });

  app.get('/api/admin/users/:id/activity', adminAuth, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.params.id));
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });
    const sessions = db.prepare('SELECT id,pin,meet_url,status,active,created_at_ms,expires_at_ms,ended_at_ms,end_reason FROM host_sessions WHERE user_id=? ORDER BY created_at_ms DESC LIMIT ?').all(user.id, sessionRetention);
    const transcripts = db.prepare(`SELECT t.id,t.started_at_ms,t.ended_at_ms,t.google_email,t.pdf_filename,s.pin,s.meet_url
      FROM transcripts t JOIN host_sessions s ON s.id=t.host_session_id WHERE t.user_id=? ORDER BY t.ended_at_ms DESC LIMIT ?`).all(user.id, transcriptRetention);
    res.json({
      ok: true,
      user: adminUserSummary(user),
      sessions: sessions.map(r => ({ id: r.id, pin: r.pin, meetUrl: r.meet_url, status: r.status, active: Number(r.active || 0) === 1, createdAt: r.created_at_ms, expiresAt: r.expires_at_ms, endedAt: r.ended_at_ms, endReason: r.end_reason || '' })),
      transcripts: transcripts.map(r => ({ id: r.id, pin: r.pin, meetUrl: r.meet_url, googleEmail: r.google_email, startedAt: r.started_at_ms, endedAt: r.ended_at_ms, pdfFilename: r.pdf_filename })),
    });
  });

  // Backward-compatible approval URL. The current web UI uses the long-standing
  // /status route below so an older Railway deployment cannot produce a 404 just
  // because the web portal was deployed first.
  app.post('/api/admin/users/:id/approve', adminAuth, (req, res) => {
    const approved = approveRegistrationById(req.params.id);
    if (approved.error) return res.status(approved.status).json({ ok: false, error: approved.error });
    res.json({ ok: true, user: adminUserSummary(approved.user), message: 'Registration approved. Configure the subscription dates/status as required.' });
  });

  app.post('/api/admin/users/:id/subscription', adminAuth, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.params.id));
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });
    const requestedStatus = String(req.body?.subscriptionStatus || 'active').toLowerCase();
    if (!['active', 'inactive'].includes(requestedStatus)) return res.status(400).json({ ok: false, error: 'Subscription status must be active or inactive.' });
    let startedAt = req.body?.startedAt === null || req.body?.startedAt === '' ? null : Number(req.body?.startedAt);
    const validUntil = req.body?.validUntil === null || req.body?.validUntil === '' ? null : Number(req.body?.validUntil);
    if ((startedAt !== null && !Number.isFinite(startedAt)) || (validUntil !== null && !Number.isFinite(validUntil))) return res.status(400).json({ ok: false, error: 'Invalid subscription date.' });
    if (requestedStatus === 'active' && (!validUntil || validUntil <= 0)) return res.status(400).json({ ok: false, error: 'An active subscription requires an end date.' });
    if (requestedStatus === 'active' && !startedAt) startedAt = Date.now();
    if (startedAt && validUntil && validUntil <= startedAt) return res.status(400).json({ ok: false, error: 'Subscription end date must be later than the start date.' });
    db.prepare('UPDATE users SET subscription_status=?, subscription_started_at_ms=?, subscription_valid_until_ms=? WHERE id=?')
      .run(requestedStatus, startedAt, validUntil, user.id);
    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    res.json({ ok: true, user: adminUserSummary(updated) });
  });

  app.post('/api/admin/users/:id/status', adminAuth, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.params.id));
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });

    // Explicit registration approval uses this existing endpoint. Approval only
    // unlocks login/account status; it does NOT activate a subscription or set
    // subscription dates. This avoids the separate-route deployment mismatch that
    // caused the portal's Approve button to return 404.
    if (req.body?.approveRegistration === true) {
      const approved = approveRegistrationById(user.id);
      if (approved.error) return res.status(approved.status).json({ ok: false, error: approved.error });
      return res.json({ ok: true, user: adminUserSummary(approved.user), message: 'Registration approved. Subscription remains inactive until you configure it.' });
    }

    const status = String(req.body?.status || '').toLowerCase();
    if (!['active', 'disabled'].includes(status)) return res.status(400).json({ ok: false, error: 'Account status must be active or disabled.' });
    if (user.role === 'admin' && status !== 'active') return res.status(400).json({ ok: false, error: 'Admin accounts cannot be moved out of active status from this panel.' });
    db.prepare('UPDATE users SET status=? WHERE id=?').run(status, user.id);
    res.json({ ok: true, user: adminUserSummary(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)) });
  });

  app.post('/api/admin/users/:id/password', adminAuth, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.params.id));
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });
    const password = String(req.body?.password || '');
    if (password.length < 8) return res.status(400).json({ ok: false, error: 'New password must contain at least 8 characters.' });
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), user.id);
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id=?').run(user.id);
    res.json({ ok: true, message: `Password reset for ${user.email}.` });
  });

  // Backward-compatible CLI admin endpoint used by scripts/activate-subscription.js.
  app.post('/api/admin/subscription', adminAuth, (req, res) => {
    const email = normalizeEmail(req.body?.email); const days = Number(req.body?.days || 30);
    if (!Number.isFinite(days) || days === 0) return res.status(400).json({ ok: false, error: 'Days must be a non-zero number.' });
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });
    const currentUntil = Number(user.subscription_valid_until_ms || 0);
    const base = days > 0 ? Math.max(Date.now(), currentUntil) : (currentUntil || Date.now());
    const until = Math.max(Date.now() - 1000, base + days * 86400000);
    const start = Number(user.subscription_started_at_ms || 0) || Date.now();
    const status = until > Date.now() ? 'active' : 'inactive';
    db.prepare('UPDATE users SET subscription_status=?,subscription_started_at_ms=?,subscription_valid_until_ms=? WHERE id=?').run(status, start, until, user.id);
    res.json({ ok: true, email, startedAt: start, validUntil: until, subscriptionStatus: status });
  });

  return {
    db, dbPath, expireSubscriptions, verifyParticipantToken, participantTokenState, verifyHostAudioToken, hostAudioTokenState, hostAudioSessionState, touchSessionSpeech, sweepIdleSessions, normalizeMeetUrl,
    registerParticipantGoogleEmail, appendLiveTranscriptSegment, appendLiveTranscriptSegments, finalizeSessionTranscript,
    planPriceInr, sessionRetention, transcriptRetention, sessionIdleTimeoutMinutes, hostSessionMaxMinutes
  };
};
