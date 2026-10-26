// Relay host microphone captions to Zapper desktop clients holding an active
// session PIN. This does not join Google Meet, forward audio, or grant access to
// anyone who has not already passed the existing /stt PIN-token verification.
module.exports = function createHostCaptionRelay({ openState = 1, maxBufferedBytes = 512 * 1024 } = {}) {
  const viewersBySession = new Map();
  const chatHistory = new Map();

  function subscribe(sessionId, socket) {
    const key = String(sessionId || '');
    if (!key || !socket) return;
    if (!viewersBySession.has(key)) viewersBySession.set(key, new Set());
    viewersBySession.get(key).add(socket);
    // Replay a bounded, session-local chat history to reconnecting or late
    // PIN viewers. Native Meet caption history is intentionally not replayed.
    const history = chatHistory.get(key) || [];
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const item of history) {
      if (item.at < cutoff || socket.readyState !== openState || Number(socket.bufferedAmount || 0) >= maxBufferedBytes) continue;
      try { socket.send(item.wire); } catch (_) { break; }
    }
  }

  function unsubscribe(sessionId, socket) {
    const key = String(sessionId || '');
    const viewers = viewersBySession.get(key);
    if (!viewers) return;
    viewers.delete(socket);
    if (!viewers.size) viewersBySession.delete(key);
  }

  function publish(sessionId, caption, { excludeSocket = null, source = 'host' } = {}) {
    const viewers = viewersBySession.get(String(sessionId || ''));
    if (!viewers?.size) return 0;
    const text = String(caption?.text || '').trim();
    if (!text) return 0;
    const message = JSON.stringify({
      type: 'transcript',
      text,
      isFinal: Boolean(caption.isFinal),
      speechFinal: Boolean(caption.speechFinal),
      confidence: Number(caption.confidence || 0),
      source: String(source || 'host'),
    });
    let sent = 0;
    for (const socket of viewers) {
      if (socket === excludeSocket) continue;
      // Do not build a queue on slow/offline desktops: a later interim caption
      // is preferable to exhausting the API's memory.
      if (socket.readyState !== openState || Number(socket.bufferedAmount || 0) >= maxBufferedBytes) continue;
      try { socket.send(message); sent += 1; } catch (_) { /* An already closing socket is harmless. */ }
    }
    return sent;
  }

  // Chat is session-scoped, not a global Meet/PIN broadcast. Acknowledgements
  // allow clients to retry without delivering duplicate messages after reconnects.
  const seenChat = new Map();
  function publishChat(sessionId, payload, { excludeSocket = null } = {}) {
    const id = String(payload?.id || '').slice(0, 100);
    const sender = String(payload?.sender || 'Participant').trim().slice(0, 100);
    const message = String(payload?.message || '').trim().slice(0, 8000);
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id) || !message) return { accepted: false, delivered: 0 };
    const key = String(sessionId || '');
    const now = Date.now();
    let known = seenChat.get(key);
    if (!known) { known = new Map(); seenChat.set(key, known); }
    for (const [oldId, at] of known) if (now - at > 120000) known.delete(oldId);
    if (known.has(id)) return { accepted: true, delivered: 0, duplicate: true };
    known.set(id, now);
    if (known.size > 1000) known.delete(known.keys().next().value);
    const wire = JSON.stringify({ type: 'chat_message', id, chatKey: id, sender, message, timestamp: now });
    const history = chatHistory.get(key) || [];
    history.push({ at: now, wire });
    chatHistory.set(key, history.filter(item => now - item.at < 2 * 60 * 60 * 1000).slice(-150));
    let delivered = 0;
    for (const socket of viewersBySession.get(key) || []) {
      if (socket === excludeSocket || socket.readyState !== openState || Number(socket.bufferedAmount || 0) > maxBufferedBytes) continue;
      try { socket.send(wire); delivered++; } catch (_) {}
    }
    return { accepted: true, delivered };
  }

  return { subscribe, unsubscribe, publish, publishChat };
};
