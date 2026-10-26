// Authenticated session-scoped captions + chat. Separate instances allow the host
// and a PIN participant on the same machine to coexist without replacing sockets.
const WebSocket = require('ws');
const crypto = require('crypto');

function createSessionChannel({ backendUrl, token, onEvent = () => {}, WebSocketImpl = WebSocket }) {
  if (!token || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('Authenticated session token required');
  const base = String(backendUrl || '').replace(/\/+$/, '').replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  if (!/^wss?:\/\//.test(base)) throw new Error('Invalid caption backend');
  const url = base + '/stt?token=' + encodeURIComponent(token);
  const pending = new Map(); // final captions and unacknowledged chat, bounded across reconnect
  let socket = null;
  let closed = false;
  let retry = null;
  let heartbeat = null;
  let tries = 0;
  let generation = 0;

  const emit = value => { try { onEvent(value); } catch (_) {} };
  const clear = () => {
    if (retry) clearTimeout(retry);
    if (heartbeat) clearInterval(heartbeat);
    retry = heartbeat = null;
  };
  const send = payload => {
    if (socket?.readyState !== WebSocketImpl.OPEN) return false;
    try { socket.send(JSON.stringify(payload)); return true; } catch (_) { return false; }
  };
  const enqueue = (payload, durable = false) => {
    if (closed) return false;
    if (durable) {
      pending.set(payload.id, payload);
      if (pending.size > 200) pending.delete(pending.keys().next().value);
    }
    return send(payload);
  };
  const connect = () => {
    if (closed) return;
    clear();
    const current = ++generation;
    const ws = new WebSocketImpl(url);
    socket = ws;
    ws.on('open', () => {
      if (current !== generation || closed) return;
      tries = 0;
      emit({ type: 'connected' });
      for (const [id, payload] of pending) {
        if (send(payload) && payload.type === 'local_caption') pending.delete(id);
      }
      heartbeat = setInterval(() => { if (ws.readyState === WebSocketImpl.OPEN) { try { ws.ping(); } catch (_) {} } }, 15000);
      heartbeat.unref?.();
    });
    ws.on('message', raw => {
      if (current !== generation || closed) return;
      let packet;
      try { packet = JSON.parse(raw.toString()); } catch (_) { return; }
      if (packet.type === 'chat_ack') pending.delete(String(packet.id || ''));
      emit(packet);
    });
    const reconnect = () => {
      if (current !== generation || closed || retry) return;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      tries++;
      emit({ type: 'disconnected' });
      retry = setTimeout(() => { retry = null; connect(); }, Math.min(1000 * 2 ** Math.min(Math.max(0, tries - 1), 4), 15000));
      retry.unref?.();
    };
    ws.on('close', reconnect);
    ws.on('error', reconnect);
  };
  connect();
  return {
    caption({ text, isFinal = false, capturedAt = Date.now() } = {}) {
      const clean = String(text || '').trim().slice(0, 12000);
      if (!clean) return false;
      const payload = { type: 'local_caption', text: clean, isFinal: Boolean(isFinal), capturedAt };
      // Backend has no caption-ack; retain recent final captions during disconnect,
      // but avoid replaying interims after they are stale.
      if (isFinal && socket?.readyState !== WebSocketImpl.OPEN) {
        payload.id = crypto.randomUUID();
        pending.set(payload.id, payload);
        if (pending.size > 200) pending.delete(pending.keys().next().value);
      }
      const sent = send(payload);
      if (sent && payload.id) pending.delete(payload.id);
      return sent;
    },
    chat(message, sender = 'Host', id = crypto.randomUUID()) {
      const clean = String(message || '').trim().slice(0, 8000);
      if (!clean) return '';
      enqueue({ type: 'chat_message', id, sender: String(sender).slice(0, 100), message: clean }, true);
      return id;
    },
    stop() {
      closed = true;
      generation++;
      clear();
      pending.clear();
      try { socket?.close(1000, 'session ended'); } catch (_) {}
      socket = null;
    },
    isConnected() { return socket?.readyState === WebSocketImpl.OPEN; }
  };
}
module.exports = { createSessionChannel };
