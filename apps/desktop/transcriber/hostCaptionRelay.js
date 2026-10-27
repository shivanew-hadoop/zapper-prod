// Independent, PIN-viewer-safe host caption publisher. The host's short-lived
// authenticated browser token is reused in the desktop's own Meet window; no
// second participant seat, microphone stream or Google sign-in is required.
const WebSocket = require('ws');
let socket = null;
let token = '';
let timer = null;
let generation = 0;
let bufferedFinals = [];
let bufferedChats = [];
const MAX_FINAL_BUFFER = 80;
const MAX_BUFFERED_BYTES = 512 * 1024;
const RETRY_MS = 2500;

function stopHostCaptionRelay() {
  ++generation;
  if (timer) clearTimeout(timer);
  timer = null;
  token = '';
  bufferedFinals = [];
  bufferedChats = [];
  const old = socket;
  socket = null;
  try { old?.close(1000, 'host left'); } catch (_) {}
}

function startHostCaptionRelay({ backendUrl, captureToken, onStatus = () => {}, onEnded = () => {}, onChat = () => {} }) {
  stopHostCaptionRelay();
  token = String(captureToken || '').trim();
  if (!token) return false;
  const gen = generation;
  const wsBase = String(backendUrl || '').replace(/\/+$/, '').replace(/^https?:/, scheme => scheme === 'https:' ? 'wss:' : 'ws:');
  const url = `${wsBase}/stt?token=${encodeURIComponent(token)}`;
  function connect() {
    if (gen !== generation || !token) return;
    const ws = new WebSocket(url);
    socket = ws;
    ws.on('open', () => {
      if (gen !== generation || socket !== ws) return;
      onStatus('Host captions connected. Waiting for Google Meet speech.');
      for (const chat of bufferedChats.splice(0)) {
        if (ws.readyState !== WebSocket.OPEN) break;
        try { ws.send(chat); } catch (_) { bufferedChats.unshift(chat); break; }
      }
      for (const message of bufferedFinals.splice(0)) {
        if (ws.readyState !== WebSocket.OPEN) break;
        try { ws.send(message); } catch (_) { bufferedFinals.unshift(message); break; }
      }
    });
    ws.on('message', raw => {
      if (gen !== generation || socket !== ws) return;
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'session_ended' || message.type === 'limit_reached') {
          stopHostCaptionRelay();
          onEnded(message.message || message.text || 'Host session ended.', message.type);
        } else if (message.type === 'meet_chat') onChat(message);
        else if (message.type === 'error') onStatus(`Host caption relay: ${message.message}`);
      } catch (_) {}
    });
    ws.on('error', error => { if (gen === generation) console.warn('[HostCaptions]', error.message); });
    ws.on('close', code => {
      if (gen !== generation || socket !== ws) return;
      socket = null;
      if (code === 1008) { stopHostCaptionRelay(); onEnded('Host caption authorization ended.'); return; }
      if (code === 1000) return;
      timer = setTimeout(() => { timer = null; connect(); }, RETRY_MS);
      timer.unref?.();
    });
  }
  connect();
  return true;
}

function publishHostCaption(payload) {
  if (!token) return false;
  const text = String(payload?.text || '').trim().slice(0, 12000);
  if (!text) return false;
  const message = JSON.stringify({ type: 'local_caption', text,
    isFinal: Boolean(payload.isFinal), capturedAt: Number(payload.capturedAt) || Date.now() });
  if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < MAX_BUFFERED_BYTES) {
    try { socket.send(message); return true; } catch (_) {}
  }
  if (payload.isFinal) {
    bufferedFinals.push(message);
    if (bufferedFinals.length > MAX_FINAL_BUFFER) bufferedFinals.shift();
  }
  return false;
}

function publishHostChat(payload) {
  const message = String(payload?.message || '').trim();
  if (!token || !message) return false;
  const chat = JSON.stringify({ type: 'meet_chat', sender: String(payload.sender || 'Host'),
    message, meetTime: String(payload.meetTime || ''), chatKey: String(payload.chatKey || '') });
  if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < MAX_BUFFERED_BYTES) {
    try { socket.send(chat); return true; } catch (_) {}
  }
  bufferedChats.push(chat);
  if (bufferedChats.length > 200) bufferedChats.shift();
  return false;
}
module.exports = { startHostCaptionRelay, stopHostCaptionRelay, publishHostCaption, publishHostChat };
