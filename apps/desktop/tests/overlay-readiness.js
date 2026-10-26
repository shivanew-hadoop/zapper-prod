const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const Module = require('node:module');
const { overlayReadinessMessage } = require('../audio-ws/readiness');

assert.deepEqual(JSON.parse(overlayReadinessMessage(() => true)), { type: 'zapper-overlay-ready', ready: true });
assert.deepEqual(JSON.parse(overlayReadinessMessage(() => false)), { type: 'zapper-overlay-ready', ready: false });
assert.deepEqual(JSON.parse(overlayReadinessMessage(() => { throw new Error('window destroyed'); })), { type: 'zapper-overlay-ready', ready: false });

let relay;
class Server extends EventEmitter {
  constructor(options) { super(); assert.equal(options.port, 9999); relay = this; }
  close() {}
}
class Socket extends EventEmitter {
  send(message, callback) { this.message = message; callback(); }
  close() { this.didClose = true; }
}
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'ws') return { Server };
  return load.call(this, request, ...rest);
};
const { startAudioWSServer, onAudioChunk, stopAudioWSServer } = require('../audio-ws/server');
Module._load = load;
startAudioWSServer({ isOverlayReady: () => true });
let receivedAudio;
onAudioChunk(chunk => { receivedAudio = chunk; });
const probe = new Socket();
relay.emit('connection', probe, { url: '/host-ready' });
assert.equal(JSON.parse(probe.message).ready, true);
assert.equal(probe.didClose, true);
assert.equal(receivedAudio, undefined, 'readiness request never enters Meet audio relay');
const audioClient = new Socket();
relay.emit('connection', audioClient, { url: '/' });
const bytes = Buffer.from([1, 2, 3]);
audioClient.emit('message', bytes);
assert.deepEqual(receivedAudio, bytes, 'existing audio relay remains functional');
stopAudioWSServer();
console.log(JSON.stringify({ ok: true, desktopReadinessIsolatedFromAudio: true }));
