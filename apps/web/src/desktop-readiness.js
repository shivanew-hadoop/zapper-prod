// This is a local-only readiness probe, not an authentication or session channel.
// A connection alone is insufficient: the updated desktop must acknowledge that
// its Electron overlay is actually visible before the portal enables Create Session.
export function isDesktopOverlayReadyMessage(data) {
  try {
    const message = JSON.parse(data);
    return message?.type === 'zapper-overlay-ready' && message.ready === true;
  } catch (_) {
    return false;
  }
}

export function probeDesktopOverlay({
  WebSocketType = globalThis.WebSocket,
  url = 'ws://127.0.0.1:9999/host-ready',
  timeoutMs = 1200
} = {}) {
  return new Promise(resolve => {
    if (typeof WebSocketType !== 'function') return resolve(false);
    let socket;
    let finished = false;
    let timer;
    const finish = ready => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (socket) {
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        try { socket.close(); } catch (_) {}
      }
      resolve(ready);
    };
    try {
      socket = new WebSocketType(url);
      socket.onmessage = event => finish(isDesktopOverlayReadyMessage(event.data));
      socket.onerror = () => finish(false);
      socket.onclose = () => finish(false);
      timer = setTimeout(() => finish(false), timeoutMs);
    } catch (_) { finish(false); }
  });
}
