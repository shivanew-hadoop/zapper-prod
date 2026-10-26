// transcriber/remoteDeepgram.js — sends PCM audio to your backend; backend owns Deepgram key
// v126: auto-reconnects backend /stt WebSocket when network/Railway/client socket drops unexpectedly.
const WebSocket = require('ws');

let socket = null;
let transcriptCb = () => {};
let opened = false;
let bufferedChunks = [];
let bufferedLocalCaptions = [];
let heartbeatTimer = null;
let reconnectTimer = null;
let currentUrl = '';
let manuallyStopped = false;
let reconnectAttempt = 0;
let permanentClose = false;
let streamGeneration = 0;

const MAX_BUFFERED_CHUNKS = 40;
const MAX_BUFFERED_LOCAL_CAPTIONS = 120;
const BACKEND_HEARTBEAT_MS = 15000;
const BASE_RECONNECT_MS = 3000;
const MAX_RECONNECT_MS = 15000;

function emit(payload) {
  if (typeof transcriptCb === 'function') {
    try { transcriptCb(payload); } catch (e) { console.error('[RemoteSTT] callback error:', e); }
  }
}

function normalizeBackendUrl(rawUrl) {
  let url = String(rawUrl || '').trim();
  if (!url) throw new Error('Backend URL is empty');
  url = url.replace(/\/+$/, '');
  if (url.startsWith('http://')) url = url.replace('http://', 'ws://');
  if (url.startsWith('https://')) url = url.replace('https://', 'wss://');
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) url = `wss://${url}`;
  if (!url.endsWith('/stt')) url += '/stt';
  return url;
}

function clearHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function isSocketActive() {
  return socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING);
}

function shouldReconnect(code) {
  if (manuallyStopped || permanentClose) return false;
  if (code === 1000 || code === 1008) return false;
  return Boolean(currentUrl);
}

function scheduleReconnect(code, reasonText, generation = streamGeneration) {
  if (generation !== streamGeneration || !shouldReconnect(code)) return;
  if (reconnectTimer || isSocketActive()) return;

  reconnectAttempt += 1;
  const delay = Math.min(BASE_RECONNECT_MS * reconnectAttempt, MAX_RECONNECT_MS);

  console.log(`[RemoteSTT] Backend STT disconnected. Reconnecting in ${delay}ms...`, code || '', reasonText || '');
  emit({ type: 'status', text: 'Caption connection dropped. Reconnecting automatically...' });

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (generation === streamGeneration && !manuallyStopped && !permanentClose && currentUrl) {
      connectSocket(currentUrl, true, generation);
    }
  }, delay);
}

function connectSocket(url, isReconnect = false, generation = streamGeneration) {
  if (generation !== streamGeneration || isSocketActive()) return;

  opened = false;
  const ws = new WebSocket(url);
  socket = ws;

  ws.on('open', () => {
    if (generation !== streamGeneration || socket !== ws) {
      try { ws.close(1000, 'stale stream'); } catch (_) {}
      return;
    }
    opened = true;
    reconnectAttempt = 0;
    console.log(isReconnect ? '[RemoteSTT] Reconnected to backend STT' : '[RemoteSTT] Connected to backend STT');

    emit({
      type: 'status',
      text: isReconnect
        ? 'Reconnected to backend. Captions resumed.'
        : 'Connected to backend. Low-latency STT ready. Waiting for Meet audio...',
    });

    clearHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (generation === streamGeneration && socket === ws && ws.readyState === WebSocket.OPEN) {
        try { ws.ping(); } catch (_) {}
      }
    }, BACKEND_HEARTBEAT_MS);

    for (const caption of bufferedLocalCaptions.splice(0)) {
      try {
        if (generation === streamGeneration && socket === ws && ws.readyState === WebSocket.OPEN) ws.send(caption);
      } catch (_) {}
    }
    for (const chunk of bufferedChunks.splice(0)) {
      try {
        if (generation === streamGeneration && socket === ws && ws.readyState === WebSocket.OPEN) ws.send(chunk);
      } catch (_) {}
    }
  });

  ws.on('message', (raw) => {
    if (generation !== streamGeneration || socket !== ws) return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }

    if (msg.type === 'error') {
      const text = msg.message || 'Backend transcription error';
      if (/license|DEEPGRAM_API_KEY|invalid/i.test(text)) permanentClose = true;
      return emit({ error: text });
    }

    if (msg.type === 'limit_reached') {
      permanentClose = true;
      return emit({
        type: 'limit_reached',
        text: msg.message || 'Transcript limit reached. Captions are disconnecting now.',
      });
    }

    if (msg.type === 'status') return emit({ type: 'status', text: msg.text });
    if (msg.type === 'session_ended') {
      permanentClose = true;
      return emit({ type: 'session_ended', text: msg.message || 'This Zapper session is no longer active.' });
    }
    if (msg.type === 'speech_started') return emit({ type: 'speech_started' });

    if (msg.type === 'transcript' && msg.text) {
      return emit({
        text: msg.text,
        isFinal: !!msg.isFinal,
        confidence: msg.confidence || 0,
        source: String(msg.source || 'deepgram'),
      });
    }
  });

  ws.on('close', (code, reason) => {
    // A previous run may close after Leave -> Rejoin. Never let that stale
    // close event clear or reconnect the new run's WebSocket.
    if (generation !== streamGeneration) return;
    opened = false;
    clearHeartbeat();

    const msg = reason?.toString?.() || '';
    console.log('[RemoteSTT] Backend STT closed:', code, msg);
    if (socket === ws) socket = null;

    if (shouldReconnect(code)) {
      scheduleReconnect(code, msg, generation);
    } else if (code !== 1000 && !manuallyStopped) {
      emit({ error: msg || 'Backend transcription connection closed. Check session/backend.' });
    }
  });

  ws.on('error', (err) => {
    if (generation !== streamGeneration || socket !== ws) return;
    opened = false;
    clearHeartbeat();
    console.error('[RemoteSTT] Backend STT error:', err.message);
  });
}

function startRemoteTranscriptStream({ backendUrl, sessionToken, googleEmail = '' }, onTranscript) {
  stopRemoteTranscriptStream();
  const generation = ++streamGeneration;

  transcriptCb = typeof onTranscript === 'function' ? onTranscript : () => {};

  const token = String(sessionToken || '').trim();
  if (!token) throw new Error('Session authorization is required');

  const base = normalizeBackendUrl(backendUrl);
  const email = String(googleEmail || '').trim().toLowerCase();
  currentUrl = `${base}?token=${encodeURIComponent(token)}${email ? `&googleEmail=${encodeURIComponent(email)}` : ''}`;

  manuallyStopped = false;
  permanentClose = false;
  reconnectAttempt = 0;
  opened = false;
  bufferedChunks = [];
  bufferedLocalCaptions = [];

  connectSocket(currentUrl, false, generation);
  return true;
}

function sendAudioChunk(pcmBuffer) {
  if (!pcmBuffer || !pcmBuffer.length) return;

  if (socket && socket.readyState === WebSocket.OPEN) {
    try { socket.send(pcmBuffer); } catch (_) {}
    return;
  }

  if (!manuallyStopped && !permanentClose) {
    bufferedChunks.push(Buffer.from(pcmBuffer));
    if (bufferedChunks.length > MAX_BUFFERED_CHUNKS) bufferedChunks.shift();

    if (!isSocketActive() && currentUrl && !reconnectTimer) {
      scheduleReconnect(1006, 'audio arrived while STT socket was closed', streamGeneration);
    }
  }
}


function sendLocalCaption({ text, isFinal = false, capturedAt = Date.now() } = {}) {
  const cleanText = String(text || '').trim().slice(0, 12000);
  if (!cleanText || manuallyStopped || permanentClose) return false;
  const message = JSON.stringify({
    type: 'local_caption',
    text: cleanText,
    isFinal: Boolean(isFinal),
    capturedAt: Math.max(1, Number(capturedAt) || Date.now()),
  });
  if (socket && socket.readyState === WebSocket.OPEN) {
    try { socket.send(message); return true; } catch (_) {}
  }
  // Final captions are the PDF ledger. Keep a bounded local queue across a
  // short Railway/network reconnect; interim captions remain best-effort.
  if (isFinal) {
    bufferedLocalCaptions.push(message);
    if (bufferedLocalCaptions.length > MAX_BUFFERED_LOCAL_CAPTIONS) bufferedLocalCaptions.shift();
    if (!isSocketActive() && currentUrl && !reconnectTimer) {
      scheduleReconnect(1006, 'local caption arrived while backend socket was closed', streamGeneration);
    }
  }
  return false;
}

function stopRemoteTranscriptStream() {
  // Invalidate every event handler belonging to the previous stream before
  // asking its socket to close. This prevents a late close/error event from
  // mutating a newly-started stream after Leave -> Rejoin.
  streamGeneration += 1;
  manuallyStopped = true;
  permanentClose = false;
  bufferedChunks = [];
  bufferedLocalCaptions = [];
  opened = false;
  currentUrl = '';
  reconnectAttempt = 0;

  clearReconnect();
  clearHeartbeat();

  const socketToClose = socket;
  socket = null;
  if (socketToClose) {
    try { socketToClose.close(1000, 'client stopped'); } catch (_) {}
  }

  transcriptCb = () => {};
}

module.exports = {
  startRemoteTranscriptStream,
  sendAudioChunk,
  sendLocalCaption,
  stopRemoteTranscriptStream,
};