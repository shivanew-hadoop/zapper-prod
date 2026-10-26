// Relay host microphone captions to Zapper desktop clients holding an active
// session PIN. This does not join Google Meet, forward audio, or grant access to
// anyone who has not already passed the existing /stt PIN-token verification.
module.exports = function createHostCaptionRelay({ openState = 1, maxBufferedBytes = 512 * 1024 } = {}) {
  const viewersBySession = new Map();

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

  return { subscribe, unsubscribe, publish };
};
