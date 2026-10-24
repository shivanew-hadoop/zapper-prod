// This content script bridges the existing Zapper page to its Chrome/Edge
// extension without needing a fixed extension ID or altering the page UI.
(() => {
  'use strict';
  const CHANNEL = 'zapper-meet-host-v1';
  const requests = new Set();
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const payload = event.data;
    if (!payload || payload.channel !== CHANNEL || payload.type !== 'command') return;
    if (!['ping', 'create', 'start', 'stop', 'mute', 'unmute', 'status'].includes(payload.action)) return;
    if (!['create', 'ping'].includes(payload.action) && !/^[0-9a-f-]{36}$/i.test(String(payload.sessionId || ''))) return;
    const key = String(payload.requestId || '').slice(0, 100);
    if (!key || requests.has(key)) return;
    requests.add(key);
    chrome.runtime.sendMessage({
      type: 'zapper-web-host-command', action: payload.action,
      sessionId: payload.sessionId, meetUrl: payload.meetUrl || '',
    }, reply => {
      requests.delete(key);
      const error = chrome.runtime.lastError?.message;
      window.postMessage({
        channel: CHANNEL, type: 'response', requestId: key,
        sessionId: payload.sessionId,
        ...(!error && reply ? reply : { ok: false, error: error || 'Host automation extension is unavailable.' }),
      }, location.origin);
    });
  });
  chrome.runtime.onMessage.addListener(payload => {
    if (payload?.type !== 'zapper-host-status') return;
    window.postMessage({ channel: CHANNEL, type: 'status', sessionId: payload.sessionId,
      status: payload.status, message: payload.message || '' }, location.origin);
  });
  // Allows the Web UI to detect the extension without a visible new control.
  window.postMessage({ channel: CHANNEL, type: 'extension-ready' }, location.origin);
})();
