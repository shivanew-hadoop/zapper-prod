require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const createSessionControl = require('./session-control');
const createHostCaptionRelay = require('./live-caption-relay');
const API_VERSION = require('./package.json').version;

const PORT = Number(process.env.PORT || 8080);
function normalizeSecretEnv(name, rawValue) {
  let value = String(rawValue || '').trim();
  const prefix = `${name}=`;
  if (value.toUpperCase().startsWith(prefix.toUpperCase())) value = value.slice(prefix.length).trim();
  if ((value.startsWith('\"') && value.endsWith('\"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1).trim();
  return value;
}
const DEEPGRAM_API_KEY = normalizeSecretEnv('DEEPGRAM_API_KEY', process.env.DEEPGRAM_API_KEY);
const DATA_DIR = String(
  process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data')
).trim();
const WEB_ORIGINS = String(process.env.WEB_ORIGINS || 'http://localhost:5173')
  .split(',').map(v => v.trim()).filter(Boolean);

const DEEPGRAM_KEEPALIVE_MS = 5000;
const BACKEND_CLIENT_PING_MS = 15000;
const NO_SPEECH_KEEPALIVE_LIMIT_MS = 30 * 60 * 1000;
const SILENCE_PCM_KEEPALIVE_AFTER_MS = 8000;
const HOST_SESSION_MAX_MINUTES = Math.max(30, Math.min(210, Number(process.env.HOST_SESSION_MAX_MINUTES || 210)));
const MAX_TRANSCRIPTION_SESSION_MS = HOST_SESSION_MAX_MINUTES * 60 * 1000;
const SILENCE_PCM_100MS_16K_MONO = Buffer.alloc(16000 * 2 / 10);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin || WEB_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by Zapper API CORS policy.'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key'],
  maxAge: 86400,
}));
// Preserve exact signed webhook bytes before the global JSON parser.
// Cashfree route is registered by session-control and uses express.raw.
app.use((req, res, next) => req.path === '/api/payments/cashfree/webhook' ? next() : express.json({ limit: '2mb' })(req, res, next));
app.use('/api/payments/cashfree/webhook', express.raw({ type: 'application/json', limit: '256kb' }));

const requestBuckets = new Map();
function simpleRateLimit({ windowMs, limit }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${req.ip}:${req.baseUrl || ''}:${req.path}`;
    const existing = requestBuckets.get(key);
    const bucket = !existing || now - existing.startedAt >= windowMs ? { startedAt: now, count: 0 } : existing;
    bucket.count += 1;
    requestBuckets.set(key, bucket);
    if (bucket.count > limit) return res.status(429).json({ ok: false, error: 'Too many requests. Please wait and try again.' });
    next();
  };
}
const authLimiter = simpleRateLimit({ windowMs: 10 * 60 * 1000, limit: 60 });
const pinLimiter = simpleRateLimit({ windowMs: 5 * 60 * 1000, limit: 120 });
app.use('/api/auth', authLimiter);
app.use('/api/desktop/redeem-pin', pinLimiter);
setInterval(() => {
  const cutoff = Date.now() - 20 * 60 * 1000;
  for (const [key, value] of requestBuckets) if (value.startedAt < cutoff) requestBuckets.delete(key);
}, 10 * 60 * 1000).unref();

const sessionControl = createSessionControl({ app, dataDir: DATA_DIR });
const sessionIdleSweepTimer = setInterval(() => {
  try { sessionControl.sweepIdleSessions(); } catch (error) { console.error('[SESSION] Idle sweep failed:', error.message); }
}, 15000);
sessionIdleSweepTimer.unref();

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'zapper-api', version: API_VERSION, databaseReady: true, deepgramConfigured: Boolean(DEEPGRAM_API_KEY) });
});
app.get('/health/stt', async (_req, res) => {
  if (!DEEPGRAM_API_KEY) return res.status(503).json({ ok: false, deepgramAuthValid: false, error: 'DEEPGRAM_API_KEY is not configured.' });
  try {
    const check = await fetch('https://api.deepgram.com/v1/projects', {
      headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!check.ok) {
      return res.status(503).json({
        ok: false,
        deepgramAuthValid: false,
        providerStatus: check.status,
        error: check.status === 401 || check.status === 403
          ? 'Deepgram rejected the configured API key. In Railway, DEEPGRAM_API_KEY must contain only a current active Deepgram key, with no DEEPGRAM_API_KEY= prefix.'
          : `Deepgram credential check failed (${check.status}).`,
      });
    }
    return res.json({ ok: true, deepgramAuthValid: true });
  } catch (error) {
    return res.status(503).json({ ok: false, deepgramAuthValid: false, error: `Could not validate Deepgram credentials: ${error.message}` });
  }
});
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'Zapper API', health: '/health' });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/stt' });
const hostCaptionRelay = createHostCaptionRelay({ openState: WebSocket.OPEN });

// One authoritative live transcript is accumulated per host session. Multiple
// desktops can listen to the same PIN, but only one capture source at a time is
// persisted; another connected source is promoted automatically if the current
// source leaves or stops producing final captions. This prevents duplicate PDF
// paragraphs while still allowing participant failover.
const sessionCaptureRegistry = new Map();
function getCaptureState(sessionId) {
  const key = String(sessionId || '');
  let state = sessionCaptureRegistry.get(key);
  if (!state) {
    state = { leaderId: '', lastPersistedAt: 0, connections: new Map() };
    sessionCaptureRegistry.set(key, state);
  }
  return state;
}
function registerCapture(sessionId, connectionId) {
  const state = getCaptureState(sessionId);
  state.connections.set(connectionId, { connectedAt: Date.now(), lastFinalAt: 0, buffer: [] });
  if (!state.leaderId) state.leaderId = connectionId;
}
function persistCaptureSegment(sessionId, connectionId, segment) {
  const state = getCaptureState(sessionId);
  const connection = state.connections.get(connectionId);
  if (!connection) return;
  connection.lastFinalAt = Number(segment.at || Date.now());
  connection.buffer.push(segment);
  const cutoff = Date.now() - 60000;
  connection.buffer = connection.buffer.filter(item => Number(item.at || 0) >= cutoff).slice(-60);

  const leader = state.connections.get(state.leaderId);
  // If the leader has been silent while another connected source is producing
  // final captions, promote the active source. During normal speech this picks
  // whichever source completes first and keeps exactly one persistence path.
  if (state.leaderId !== connectionId && (!leader || Date.now() - Number(leader.lastFinalAt || 0) > 12000)) {
    state.leaderId = connectionId;
    const replayFrom = Math.max(0, Number(state.lastPersistedAt || 0) - 5000);
    const replay = connection.buffer.filter(item => Number(item.at || 0) >= replayFrom);
    setImmediate(() => {
      try { sessionControl.appendLiveTranscriptSegments(sessionId, replay, connectionId); }
      catch (error) { console.error('[TRANSCRIPT] Failover persistence error:', error.message); }
    });
    if (replay.length) state.lastPersistedAt = Math.max(state.lastPersistedAt, ...replay.map(item => Number(item.at || 0)));
    return;
  }

  if (state.leaderId === connectionId) {
    state.lastPersistedAt = Math.max(Number(state.lastPersistedAt || 0), Number(segment.at || 0));
    // Persist only after the live caption was already sent to the desktop, so
    // SQLite work is never on the caption delivery critical path.
    setImmediate(() => {
      try { sessionControl.appendLiveTranscriptSegment(sessionId, segment.text, segment.at, connectionId); }
      catch (error) { console.error('[TRANSCRIPT] Live persistence error:', error.message); }
    });
  }
}
function unregisterCapture(sessionId, connectionId) {
  const key = String(sessionId || '');
  const state = sessionCaptureRegistry.get(key);
  if (!state) return;
  state.connections.delete(connectionId);
  if (state.leaderId === connectionId) {
    const candidates = [...state.connections.entries()].sort((a, b) => Number(b[1].lastFinalAt || b[1].connectedAt) - Number(a[1].lastFinalAt || a[1].connectedAt));
    state.leaderId = candidates[0]?.[0] || '';
    const next = state.leaderId ? state.connections.get(state.leaderId) : null;
    if (next?.buffer?.length) {
      const replayFrom = Math.max(0, Number(state.lastPersistedAt || 0) - 5000);
      const replay = next.buffer.filter(item => Number(item.at || 0) >= replayFrom);
      setImmediate(() => {
        try { sessionControl.appendLiveTranscriptSegments(sessionId, replay, state.leaderId); }
        catch (error) { console.error('[TRANSCRIPT] Leader handoff persistence error:', error.message); }
      });
      if (replay.length) state.lastPersistedAt = Math.max(state.lastPersistedAt, ...replay.map(item => Number(item.at || 0)));
    }
  }
  if (!state.connections.size) sessionCaptureRegistry.delete(key);
}

function buildDeepgramUrl() {
  const params = new URLSearchParams({
    model: 'nova-2', language: 'en-US', encoding: 'linear16', sample_rate: '16000', channels: '1',
    interim_results: 'true', punctuate: 'true', smart_format: 'true', endpointing: '300',
    utterance_end_ms: '1000', vad_events: 'true',
  });
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

wss.on('connection', (clientWs, req) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const sessionToken = String(requestUrl.searchParams.get('token') || '');
  const googleEmail = String(requestUrl.searchParams.get('googleEmail') || '').trim().toLowerCase();
  // Existing desktop PIN path is unchanged. Host microphone connections have
  // their own token and require an allowed Zapper browser origin.
  const participant = sessionControl.verifyParticipantToken(sessionToken);
  const hostAudio = !participant && sessionControl.verifyHostAudioToken(sessionToken);
  const capture = participant || hostAudio;
  if (hostAudio && !WEB_ORIGINS.includes(String(req.headers.origin || ''))) {
    try { clientWs.close(1008, 'origin not allowed'); } catch (_) {}
    return;
  }

  if (!capture) {
    try { clientWs.send(JSON.stringify({ type: 'error', message: 'Session authorization is invalid or expired. Enter the 6-digit PIN again.' })); } catch (_) {}
    clientWs.close(1008, 'invalid session');
    return;
  }
  if (!DEEPGRAM_API_KEY) {
    try { clientWs.send(JSON.stringify({ type: 'error', message: 'Transcription service is not configured.' })); } catch (_) {}
    clientWs.close(1011, 'stt unavailable');
    return;
  }

  const connectionId = crypto.randomUUID();
  registerCapture(capture.session.id, connectionId);
  // PIN-authorized desktops subscribe immediately, even before Meet supplies
  // any audio. Only this session's host microphone captions are forwarded.
  if (participant) hostCaptionRelay.subscribe(capture.session.id, clientWs);
  if (participant && googleEmail) {
    try { sessionControl.registerParticipantGoogleEmail(capture.session.id, googleEmail); } catch (_) {}
  }
  console.log(`[STT] Connected session=${capture.session.id} host=${capture.user.email} source=${connectionId.slice(0, 8)}`);
  let dgWs = null;
  let dgOpen = false;
  let dgConnecting = false;
  let keepAliveTimer = null;
  let sessionLimitTimer = null;
  let clientPingTimer = null;
  let sessionStateTimer = null;
  let dgConnectedAt = 0;
  let lastDeepgramAudioAt = 0;
  let lastSpeechDbTouchAt = 0;
  let limitReached = false;
  let pendingAudio = [];
  const MAX_PENDING_AUDIO = 50;

  const sendClient = payload => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify(payload));
  };
  const clearTimers = () => {
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    if (sessionLimitTimer) clearTimeout(sessionLimitTimer);
    if (clientPingTimer) clearInterval(clientPingTimer);
    if (sessionStateTimer) clearInterval(sessionStateTimer);
    keepAliveTimer = sessionLimitTimer = clientPingTimer = sessionStateTimer = null;
  };
  const cleanupDeepgram = () => {
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = null;
    dgOpen = false; dgConnecting = false;
    if (dgWs) {
      try { if (dgWs.readyState === WebSocket.OPEN) dgWs.send(JSON.stringify({ type: 'CloseStream' })); } catch (_) {}
      try { dgWs.close(); } catch (_) {}
    }
    dgWs = null;
  };
  const closeForLimit = () => {
    if (limitReached) return;
    limitReached = true;
    sendClient({ type: 'limit_reached', message: `Session limit reached: ${HOST_SESSION_MAX_MINUTES} minutes. Captions are disconnecting now.` });
    cleanupDeepgram();
    try { clientWs.close(1000, 'transcript limit reached'); } catch (_) {}
  };

  sessionLimitTimer = setTimeout(closeForLimit, MAX_TRANSCRIPTION_SESSION_MS);
  clientPingTimer = setInterval(() => {
    if (clientWs.readyState === WebSocket.OPEN) {
      try { clientWs.ping(); } catch (_) {}
    }
  }, BACKEND_CLIENT_PING_MS);
  // Host can end a PIN from the portal at any time. Re-check the session so an
  // already-connected participant is stopped promptly instead of continuing on
  // an authorization token minted before the host ended the session.
  sessionStateTimer = setInterval(() => {
    if (clientWs.readyState !== WebSocket.OPEN) return;
    const state = hostAudio ? sessionControl.hostAudioSessionState(hostAudio.session.id, hostAudio.user.id) : sessionControl.participantTokenState(sessionToken);
    // A temporary auth/token/network issue must not terminate a meeting. Only a
    // confirmed backend session row marked inactive (host End Session) stops it.
    if (state && !state.active) {
      sendClient({ type: 'session_ended', message: 'The host ended this Zapper session. This PIN is no longer valid.' });
      cleanupDeepgram();
      try { clientWs.close(1008, 'host ended session'); } catch (_) {}
    }
  }, 5000);

  function connectDeepgram() {
    if (limitReached) return;
    if (dgWs && [WebSocket.OPEN, WebSocket.CONNECTING].includes(dgWs.readyState)) return;
    dgOpen = false; dgConnecting = true;
    dgWs = new WebSocket(buildDeepgramUrl(), { headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` } });

    dgWs.on('open', () => {
      dgOpen = true; dgConnecting = false;
      dgConnectedAt = Date.now(); lastDeepgramAudioAt = Date.now();
      sendClient({ type: 'status', text: 'Deepgram connected. Captions active.' });
      for (const chunk of pendingAudio.splice(0)) {
        if (dgWs?.readyState === WebSocket.OPEN) dgWs.send(chunk);
      }
      keepAliveTimer = setInterval(() => {
        if (!dgWs || dgWs.readyState !== WebSocket.OPEN) return;
        try { dgWs.send(JSON.stringify({ type: 'KeepAlive' })); } catch (_) {}
        const now = Date.now();
        if (dgConnectedAt && now - dgConnectedAt <= NO_SPEECH_KEEPALIVE_LIMIT_MS && now - lastDeepgramAudioAt >= SILENCE_PCM_KEEPALIVE_AFTER_MS) {
          try { dgWs.send(SILENCE_PCM_100MS_16K_MONO); lastDeepgramAudioAt = now; } catch (_) {}
        }
      }, DEEPGRAM_KEEPALIVE_MS);
    });

    dgWs.on('message', data => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'SpeechStarted') {
          sendClient({ type: 'speech_started' });
          const now = Date.now();
          if (now - lastSpeechDbTouchAt >= 5000) { lastSpeechDbTouchAt = now; setImmediate(() => sessionControl.touchSessionSpeech(capture.session.id, now)); }
          return;
        }
        const alt = msg?.channel?.alternatives?.[0];
        const text = String(alt?.transcript || '');
        if (!text) return;
        const isFinal = Boolean(msg.is_final);
        const caption = { type: 'transcript', text, isFinal, speechFinal: Boolean(msg.speech_final), confidence: Number(alt?.confidence || 0) };
        sendClient(caption);
        if (hostAudio) hostCaptionRelay.publish(capture.session.id, caption);
        const now = Date.now();
        if (isFinal) persistCaptureSegment(capture.session.id, connectionId, { text, at: now });
        if (now - lastSpeechDbTouchAt >= 15000) { lastSpeechDbTouchAt = now; setImmediate(() => sessionControl.touchSessionSpeech(capture.session.id, now)); }
      } catch (error) { console.error('[STT] Deepgram parse error:', error.message); }
    });
    dgWs.on('unexpected-response', (_request, response) => {
      let body = '';
      response.on('data', chunk => { body += chunk.toString(); });
      response.on('end', () => {
        const invalidAuth = response.statusCode === 401 || response.statusCode === 403 || /INVALID_AUTH|INVALID CREDENTIALS/i.test(body);
        sendClient({
          type: 'error',
          message: invalidAuth
            ? 'Transcription credentials were rejected by Deepgram. Update Railway DEEPGRAM_API_KEY with the raw active key only, then redeploy the API.'
            : (body || `Deepgram connection failed (${response.statusCode})`),
        });
      });
      dgOpen = false; dgConnecting = false; dgWs = null;
    });
    dgWs.on('close', code => {
      dgOpen = false; dgConnecting = false;
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      keepAliveTimer = null; dgWs = null;
      if (clientWs.readyState === WebSocket.OPEN && code !== 1000 && !limitReached) {
        sendClient({ type: 'status', text: 'Transcription paused. Waiting for audio to reconnect...' });
      }
    });
    dgWs.on('error', error => {
      console.error('[STT] Deepgram error:', error.message);
      dgOpen = false; dgConnecting = false; dgWs = null;
      sendClient({ type: 'error', message: 'Transcription provider connection error.' });
    });
  }

  clientWs.on('message', audioChunk => {
    if (limitReached || !audioChunk?.length) return;
    lastDeepgramAudioAt = Date.now();
    if (!dgWs || [WebSocket.CLOSED, WebSocket.CLOSING].includes(dgWs.readyState)) {
      pendingAudio.push(Buffer.from(audioChunk));
      if (pendingAudio.length > MAX_PENDING_AUDIO) pendingAudio.shift();
      connectDeepgram();
      return;
    }
    if (dgOpen && dgWs.readyState === WebSocket.OPEN) return dgWs.send(audioChunk);
    if (dgConnecting || dgWs.readyState === WebSocket.CONNECTING) {
      pendingAudio.push(Buffer.from(audioChunk));
      if (pendingAudio.length > MAX_PENDING_AUDIO) pendingAudio.shift();
    }
  });

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimers(); cleanupDeepgram(); pendingAudio = [];
    if (participant) hostCaptionRelay.unsubscribe(capture.session.id, clientWs);
    unregisterCapture(capture.session.id, connectionId);
  };
  clientWs.on('close', cleanup);
  clientWs.on('error', error => { console.error('[STT] Client error:', error.message); cleanup(); });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[BOOT] Zapper API listening on ${PORT}`);
  console.log(`[BOOT] Data directory: ${DATA_DIR}`);
  console.log(`[BOOT] Web origins: ${WEB_ORIGINS.join(', ')}`);
});
