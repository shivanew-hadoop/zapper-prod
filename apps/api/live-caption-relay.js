// Relay host microphone captions to Zapper desktop clients holding an active
// session PIN. This does not join Google Meet, forward audio, or grant access to
// anyone who has not already passed the existing /stt PIN-token verification.
module.exports = function createHostCaptionRelay({ openState = 1, maxBufferedBytes = 512 * 1024 } = {}) {
  const viewersBySession = new Map();
  const chatListenersBySession = new Map();
  const recentChatKeys = new Map();

  function subscribe(sessionId, socket) {
    const key = String(sessionId || '');
    if (!key || !socket) return;
    if (!viewersBySession.has(key)) viewersBySession.set(key, new Set());
    viewersBySession.get(key).add(socket);
  }

  function unsubscribe(sessionId, socket) {
    const key = String(sessionId || '');
    const viewers = viewersBySession.get(key);
    if (!viewers) return;
    viewers.delete(socket);
    if (!viewers.size) viewersBySession.delete(key);
  }

  function subscribeChat(sessionId, socket) {
    const key = String(sessionId || '');
    if (!key || !socket) return;
    if (!chatListenersBySession.has(key)) chatListenersBySession.set(key, new Set());
    chatListenersBySession.get(key).add(socket);
  }

  function unsubscribeChat(sessionId, socket) {
    const key = String(sessionId || '');
    const listeners = chatListenersBySession.get(key);
    if (!listeners) return;
    listeners.delete(socket);
    if (!listeners.size) {
      chatListenersBySession.delete(key);
      recentChatKeys.delete(key);
    }
  }

  // Chat is always session-scoped and forwarded to both host and PIN clients.
  // A single Meet message can be observed by multiple desktop Meet windows:
  // dedupe those mirrored observations without blocking later repeat messages.
  function publishChat(sessionId, chat, { excludeSocket = null } = {}) {
    const key = String(sessionId || '');
    const listeners = chatListenersBySession.get(key);
    if (!listeners?.size || !chat?.message) return 0;
    const now = Date.now();
    let recent = recentChatKeys.get(key);
    if (!recent) { recent = new Map(); recentChatKeys.set(key, recent); }
    for (const [id, at] of recent) if (now - at > 8000) recent.delete(id);
    const signature = [chat.sender, chat.meetTime, chat.message].map(v => String(v || '').trim().toLowerCase()).join('|');
    if (recent.has(signature)) return 0;
    recent.set(signature, now);
    const payload = JSON.stringify({ type: 'meet_chat', ...chat });
    let delivered = 0;
    for (const socket of listeners) {
      if (socket === excludeSocket || socket.readyState !== openState || Number(socket.bufferedAmount || 0) >= maxBufferedBytes) continue;
      try { socket.send(payload); delivered++; } catch (_) {}
    }
    return delivered;
  }

  function publish(sessionId, caption, { excludeSocket = null, source = 'host', fromHost = false } = {}) {
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
      fromHost: Boolean(fromHost),
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

  return { subscribe, unsubscribe, publish, subscribeChat, unsubscribeChat, publishChat };
};
