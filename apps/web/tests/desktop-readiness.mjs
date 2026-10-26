import assert from 'node:assert/strict';
import { isDesktopOverlayReadyMessage, probeDesktopOverlay } from '../src/desktop-readiness.js';

assert.equal(isDesktopOverlayReadyMessage('{"type":"zapper-overlay-ready","ready":true}'), true);
for (const value of [
  '', 'not json', '{}', '{"type":"zapper-overlay-ready","ready":false}',
  '{"type":"zapper-overlay-ready","ready":"true"}',
  '{"type":"unrelated","ready":true}'
]) assert.equal(isDesktopOverlayReadyMessage(value), false);

function fakeSocket(kind, data) {
  return class {
    constructor(url) {
      assert.equal(url, 'ws://127.0.0.1:9999/host-ready');
      this.closed = false;
      queueMicrotask(() => {
        if (kind === 'message') this.onmessage?.({ data });
        if (kind === 'error') this.onerror?.(new Error('app not installed'));
        if (kind === 'close') this.onclose?.();
      });
    }
    close() { this.closed = true; }
  };
}
assert.equal(await probeDesktopOverlay({ WebSocketType: fakeSocket('message', '{"type":"zapper-overlay-ready","ready":true}') }), true);
assert.equal(await probeDesktopOverlay({ WebSocketType: fakeSocket('message', '{"type":"zapper-overlay-ready","ready":false}') }), false);
assert.equal(await probeDesktopOverlay({ WebSocketType: fakeSocket('error') }), false);
assert.equal(await probeDesktopOverlay({ WebSocketType: fakeSocket('close') }), false);
assert.equal(await probeDesktopOverlay({ WebSocketType: fakeSocket('none'), timeoutMs: 5 }), false);
assert.equal(await probeDesktopOverlay({ WebSocketType: null }), false);
console.log(JSON.stringify({ ok: true, desktopReadyOnlyOnExplicitOverlayAcknowledgement: true }));
