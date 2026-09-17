const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

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
      status TEXT NOT NULL DEFAULT 'active',
      subscription_status TEXT NOT NULL DEFAULT 'inactive',
      subscription_valid_until_ms INTEGER,
      created_at_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS host_sessions(
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      pin TEXT NOT NULL UNIQUE,
      meet_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      ended_at_ms INTEGER,
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
      created_at_ms INTEGER NOT NULL,
      FOREIGN KEY(host_session_id) REFERENCES host_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON host_sessions(user_id, created_at_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_transcripts_user ON transcripts(user_id, ended_at_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_transcripts_session ON transcripts(host_session_id, ended_at_ms DESC);
  `);

  const jwtSecretRaw = String(process.env.JWT_SECRET || '').trim();
  const jwtSecret = jwtSecretRaw || crypto.randomBytes(48).toString('hex');
  if (!jwtSecretRaw) console.warn('[AUTH] JWT_SECRET is not set. Set a stable 32+ character JWT_SECRET on Railway.');
  const defaultTrialDays = Math.max(0, Number(process.env.DEFAULT_TRIAL_DAYS || 0));
  const planPriceInr = Math.max(1, Number(process.env.PLAN_PRICE_INR || 1000));
  const portalTokenDays = Math.max(1, Number(process.env.PORTAL_TOKEN_DAYS || 7));
  const participantTokenMinutes = Math.max(30, Number(process.env.PARTICIPANT_TOKEN_MINUTES || 180));
  const sessionHours = Math.max(1, Number(process.env.HOST_SESSION_HOURS || 12));
  const transcriptRetention = Math.max(1, Math.min(50, Number(process.env.TRANSCRIPT_RETENTION || 20)));
  const adminKey = String(process.env.ADMIN_KEY || '').trim();

  const normalizeEmail = value => String(value || '').trim().toLowerCase();
  const normalizeMeetUrl = value => {
    let input = String(value || '').trim();
    if (!input) return null;
    input = input.replace(/^https?:\/\//i, '').replace(/^meet\.google\.com\//i, '').split(/[?#]/)[0].replace(/^\/+|\/+$/g, '');
    const code = input.match(/^([a-z]{3}-[a-z]{4}-[a-z]{3})$/i)?.[1];
    return code ? `https://meet.google.com/${code.toLowerCase()}` : null;
  };
  const publicUser = user => ({
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    subscriptionStatus: subscriptionState(user).status,
    subscriptionValidUntil: user.subscription_valid_until_ms || null,
  });
  function subscriptionState(user) {
    if (!user || user.status !== 'active') return { valid: false, status: 'inactive' };
    const until = Number(user.subscription_valid_until_ms || 0);
    const valid = user.subscription_status === 'active' && until > Date.now();
    return { valid, status: valid ? 'active' : (until && until <= Date.now() ? 'expired' : 'inactive'), validUntil: until || null };
  }
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
  const portalSign = user => signToken({ sub: Number(user.id), type: 'portal' }, portalTokenDays * 86400000, 'zapper-portal');
  const participantSign = (user, session) => signToken({ sub: Number(user.id), sessionId: session.id, pin: session.pin, type: 'participant' }, participantTokenMinutes * 60000, 'zapper-desktop', 'zapper-electron');

  function auth(req, res, next) {
    try {
      const raw = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const payload = verifyToken(raw, 'zapper-portal');
      if (payload.type !== 'portal') throw new Error('wrong token');
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(payload.sub);
      if (!user || user.status !== 'active') return res.status(403).json({ ok: false, error: 'Access denied' });
      req.authUser = user;
      next();
    } catch (_) {
      res.status(401).json({ ok: false, error: 'Please sign in again.' });
    }
  }

  function verifyParticipantToken(rawToken) {
    try {
      const payload = verifyToken(rawToken, 'zapper-desktop', 'zapper-electron');
      if (payload.type !== 'participant') return null;
      const session = db.prepare('SELECT * FROM host_sessions WHERE id=? AND user_id=?').get(payload.sessionId, payload.sub);
      const user = session && db.prepare('SELECT * FROM users WHERE id=?').get(payload.sub);
      if (!session || !user || session.status !== 'active' || session.expires_at_ms <= Date.now()) return null;
      if (!subscriptionState(user).valid) return null;
      return { payload, session, user };
    } catch (_) { return null; }
  }

  function uniquePin() {
    for (let i = 0; i < 50; i += 1) {
      const pin = String(crypto.randomInt(100000, 1000000));
      if (!db.prepare('SELECT 1 FROM host_sessions WHERE pin=? AND status=? AND expires_at_ms>?').get(pin, 'active', Date.now())) return pin;
    }
    throw new Error('Could not allocate a session PIN. Please retry.');
  }

  function trimTranscripts(userId) {
    db.prepare(`DELETE FROM transcripts WHERE user_id=? AND id NOT IN (
      SELECT id FROM transcripts WHERE user_id=? ORDER BY ended_at_ms DESC, created_at_ms DESC LIMIT ?
    )`).run(userId, userId, transcriptRetention);
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
    const fmt = ms => new Date(Number(ms)).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    const durationSec = Math.max(0, Math.round((row.ended_at_ms - row.started_at_ms) / 1000));
    const lines = [
      'ZAPPER MEETING TRANSCRIPT',
      `Account: ${user.name || user.email} <${user.email}>`,
      `Session PIN: ${hostSession.pin}`,
      `Meeting: ${hostSession.meet_url}`,
      `Google identity: ${row.google_email || 'Not captured'}`,
      `From: ${fmt(row.started_at_ms)}`,
      `To: ${fmt(row.ended_at_ms)}`,
      `Duration: ${Math.floor(durationSec / 60)}m ${String(durationSec % 60).padStart(2, '0')}s`,
      '',
      'TRANSCRIPT',
      '----------',
      ...wrapPdfLine(row.transcript_text || 'No transcript content.'),
    ];
    const pages = [];
    for (let i = 0; i < lines.length; i += 55) pages.push(lines.slice(i, i + 55));
    const objects = [];
    const add = body => { objects.push(body); return objects.length; };
    const catalogId = add(''); const pagesId = add(''); const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const pageIds = []; const esc = t => pdfSafe(t).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    for (const pageLines of pages) {
      const stream = ['BT', '/F1 9 Tf', '48 800 Td', '12 TL'];
      for (const line of pageLines) stream.push(`(${esc(line)}) Tj`, 'T*');
      stream.push('ET');
      const content = stream.join('\n');
      const contentId = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
      pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`));
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

  app.post('/api/auth/register', (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email); const password = String(req.body?.password || ''); const name = String(req.body?.name || '').trim().slice(0, 80);
      if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return res.status(400).json({ ok: false, error: 'Use a valid email and a password with at least 8 characters.' });
      const now = Date.now(); const validUntil = defaultTrialDays > 0 ? now + defaultTrialDays * 86400000 : null;
      const info = db.prepare('INSERT INTO users(email,password_hash,name,status,subscription_status,subscription_valid_until_ms,created_at_ms) VALUES(?,?,?,?,?,?,?)')
        .run(email, hashPassword(password), name, 'active', validUntil ? 'active' : 'inactive', validUntil, now);
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
      res.json({ ok: true, token: portalSign(user), user: publicUser(user) });
    } catch (error) {
      res.status(409).json({ ok: false, error: 'This email is already registered.' });
    }
  });
  app.post('/api/auth/login', (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(normalizeEmail(req.body?.email));
    if (!user || !verifyPassword(String(req.body?.password || ''), user.password_hash) || user.status !== 'active') return res.status(401).json({ ok: false, error: 'Invalid email or password.' });
    res.json({ ok: true, token: portalSign(user), user: publicUser(user) });
  });
  app.get('/api/account', auth, (req, res) => res.json({ ok: true, user: publicUser(req.authUser), plan: { priceInr: planPriceInr, billing: 'monthly' } }));

  app.post('/api/sessions', auth, (req, res) => {
    const sub = subscriptionState(req.authUser);
    if (!sub.valid) return res.status(402).json({ ok: false, error: 'Your Zapper subscription is not active. Please activate/renew the Rs. 1,000 monthly plan.' });
    const meetUrl = normalizeMeetUrl(req.body?.meetUrl);
    if (!meetUrl) return res.status(400).json({ ok: false, error: 'Enter a valid Google Meet ID or link.' });
    const now = Date.now(); const pin = uniquePin(); const id = crypto.randomUUID();
    db.prepare('INSERT INTO host_sessions(id,user_id,pin,meet_url,status,created_at_ms,expires_at_ms) VALUES(?,?,?,?,?,?,?)')
      .run(id, req.authUser.id, pin, meetUrl, 'active', now, now + sessionHours * 3600000);
    res.json({ ok: true, session: { id, pin, meetUrl, status: 'active', createdAt: now, expiresAt: now + sessionHours * 3600000 } });
  });
  app.get('/api/sessions', auth, (req, res) => {
    const rows = db.prepare('SELECT id,pin,meet_url,status,created_at_ms,expires_at_ms,ended_at_ms FROM host_sessions WHERE user_id=? ORDER BY created_at_ms DESC LIMIT 20').all(req.authUser.id);
    res.json({ ok: true, sessions: rows.map(r => ({ id: r.id, pin: r.pin, meetUrl: r.meet_url, status: r.status, createdAt: r.created_at_ms, expiresAt: r.expires_at_ms, endedAt: r.ended_at_ms })) });
  });
  app.post('/api/sessions/:id/end', auth, (req, res) => {
    db.prepare("UPDATE host_sessions SET status='ended', ended_at_ms=? WHERE id=? AND user_id=?").run(Date.now(), req.params.id, req.authUser.id);
    res.json({ ok: true });
  });

  app.post('/api/desktop/redeem-pin', (req, res) => {
    const pin = String(req.body?.pin || '').replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(pin)) return res.status(400).json({ ok: false, error: 'Enter the 6-digit session PIN.' });
    const session = db.prepare("SELECT * FROM host_sessions WHERE pin=? AND status='active' AND expires_at_ms>?").get(pin, Date.now());
    const user = session && db.prepare('SELECT * FROM users WHERE id=?').get(session.user_id);
    if (!session || !user) return res.status(404).json({ ok: false, error: 'Session PIN is invalid or expired.' });
    if (!subscriptionState(user).valid) return res.status(402).json({ ok: false, error: 'The host subscription is inactive or expired.' });
    res.set('Cache-Control', 'no-store').json({ ok: true, meetUrl: session.meet_url, sessionId: session.id, sessionToken: participantSign(user, session), host: { name: user.name || user.email, email: user.email } });
  });

  app.post('/api/desktop/end-session', (req, res) => {
    const verified = verifyParticipantToken(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    if (!verified) return res.status(401).json({ ok: false, error: 'Session authorization expired.' });
    const endedAt = Date.now();
    db.prepare("UPDATE host_sessions SET status='ended', ended_at_ms=? WHERE id=? AND status='active'").run(endedAt, verified.session.id);
    res.json({ ok: true, endedAt });
  });

  app.post('/api/desktop/transcripts', (req, res) => {
    const verified = verifyParticipantToken(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    if (!verified) return res.status(401).json({ ok: false, error: 'Session authorization expired. Enter the session PIN again.' });
    const text = String(req.body?.transcriptText || '').trim().slice(0, 500000);
    if (!text) return res.status(400).json({ ok: false, error: 'Transcript is empty.' });
    const endedAt = Math.min(Date.now() + 60000, Math.max(1, Number(req.body?.endedAt) || Date.now()));
    const startedAt = Math.max(1, Math.min(endedAt, Number(req.body?.startedAt) || endedAt));
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO transcripts(id,host_session_id,user_id,google_email,started_at_ms,ended_at_ms,transcript_text,created_at_ms) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, verified.session.id, verified.user.id, normalizeEmail(req.body?.googleEmail), startedAt, endedAt, text, Date.now());
    trimTranscripts(verified.user.id);
    res.json({ ok: true, transcriptId: id, retained: Math.min(transcriptRetention, db.prepare('SELECT COUNT(*) c FROM transcripts WHERE user_id=?').get(verified.user.id).c) });
  });

  app.get('/api/transcripts', auth, (req, res) => {
    const rows = db.prepare(`SELECT t.id,t.started_at_ms,t.ended_at_ms,t.google_email,t.created_at_ms,s.pin,s.meet_url
      FROM transcripts t JOIN host_sessions s ON s.id=t.host_session_id WHERE t.user_id=? ORDER BY t.ended_at_ms DESC LIMIT ?`).all(req.authUser.id, transcriptRetention);
    res.json({ ok: true, sessions: rows.map(r => ({ id: r.id, startedAt: r.started_at_ms, endedAt: r.ended_at_ms, googleEmail: r.google_email, pin: r.pin, meetUrl: r.meet_url, createdAt: r.created_at_ms })) });
  });
  app.get('/api/transcripts/:id/pdf', auth, (req, res) => {
    const row = db.prepare('SELECT * FROM transcripts WHERE id=? AND user_id=?').get(String(req.params.id || ''), req.authUser.id);
    if (!row) return res.status(404).json({ ok: false, error: 'Transcript not found.' });
    const session = db.prepare('SELECT * FROM host_sessions WHERE id=?').get(row.host_session_id);
    const pdf = buildTranscriptPdf(row, req.authUser, session);
    const d = new Date(row.ended_at_ms); const stamp = d.toISOString().replace(/[:.]/g, '-');
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="Zapper_${stamp}.pdf"`, 'Cache-Control': 'no-store', 'Content-Length': String(pdf.length) });
    res.end(pdf);
  });

  app.get('/api/admin/users', (req, res) => {
    if (!adminKey || String(req.headers['x-admin-key'] || '') !== adminKey) return res.status(401).json({ ok: false, error: 'Admin access required.' });
    const rows = db.prepare('SELECT id,email,name,status,subscription_status,subscription_valid_until_ms,created_at_ms FROM users ORDER BY created_at_ms DESC LIMIT 500').all();
    res.json({ ok: true, users: rows.map(user => ({
      id: user.id, email: user.email, name: user.name, status: user.status,
      subscriptionStatus: subscriptionState(user).status,
      subscriptionValidUntil: user.subscription_valid_until_ms || null,
      createdAt: user.created_at_ms
    })) });
  });

  app.post('/api/admin/subscription', (req, res) => {
    if (!adminKey || String(req.headers['x-admin-key'] || '') !== adminKey) return res.status(401).json({ ok: false, error: 'Admin access required.' });
    const email = normalizeEmail(req.body?.email); const days = Math.max(1, Number(req.body?.days || 30));
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });
    const base = Math.max(Date.now(), Number(user.subscription_valid_until_ms || 0)); const until = base + days * 86400000;
    db.prepare("UPDATE users SET subscription_status='active',subscription_valid_until_ms=? WHERE id=?").run(until, user.id);
    res.json({ ok: true, email, validUntil: until });
  });

  return { db, dbPath, verifyParticipantToken, normalizeMeetUrl, planPriceInr };
};
