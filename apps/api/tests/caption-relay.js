// Offline, network-free tests for v4.1.2 host -> PIN-desktop live captions.
// Both relay isolation and real server /stt WebSocket handler wiring are tested.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const relayFactory = require('../live-caption-relay');

class ClientSocket extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.bufferedAmount = 0; this.messages = []; }
  send(value) { this.messages.push(JSON.parse(String(value))); }
  close() { this.readyState = 3; this.emit('close', 1000); }
  ping() {}
}

(async () => {
  // Relay alone: multiple viewers, no cross-session leaks, ended/slow viewers ignored.
  const relay = relayFactory();
  const a = new ClientSocket(), b = new ClientSocket(), other = new ClientSocket();
  relay.subscribe('room1', a); relay.subscribe('room1', b); relay.subscribe('room2', other);
  assert.equal(relay.publish('room1', { text: 'Host speaking', isFinal: true }), 2);
  assert.equal(a.messages[0].source, 'host');
  assert.equal(b.messages[0].text, 'Host speaking');
  assert.equal(other.messages.length, 0);
  assert.equal(relay.publish('room1', { text: 'Local caption', isFinal: true }, { excludeSocket: a, source: 'meet-captions' }), 1);
  assert.equal(a.messages.filter(m => m.text === 'Local caption').length, 0);
  assert.equal(b.messages.at(-1).source, 'meet-captions');
  b.bufferedAmount = 1024 * 1024;
  assert.equal(relay.publish('room1', { text: 'Interim', isFinal: false }), 1);
  relay.unsubscribe('room1', a);
  assert.equal(relay.publish('room1', { text: 'After leave', isFinal: true }), 0);

  // Run the production /stt handler with fake network sockets and fake STT.
  // No external dependencies, Google API, Deepgram key, or database required.
  let serverSocket;
  class ServerSocket extends EventEmitter { constructor() { super(); serverSocket = this; } }
  const deepgramSockets = [];
  class FakeDeepgram extends EventEmitter {
    constructor(url) {
      super(); this.url = url; this.readyState = 0; deepgramSockets.push(this);
      process.nextTick(() => { this.readyState = 1; this.emit('open'); });
    }
    send() {}
    close() { this.readyState = 3; this.emit('close', 1000); }
  }
  FakeDeepgram.Server = ServerSocket;
  FakeDeepgram.OPEN = 1;
  FakeDeepgram.CONNECTING = 0;
  FakeDeepgram.CLOSED = 3;
  FakeDeepgram.CLOSING = 2;
  const app = { disable() {}, set() {}, use() {}, get() {} };
  const fakeExpress = () => app;
  fakeExpress.json = () => () => {};
  fakeExpress.raw = () => () => {}; // Cashfree webhook parser is server middleware, not used by /stt tests.
  const user = { id: 100, email: 'host@example.com' };
  const session = id => ({ id });
  const sessionControl = {
    verifyParticipantToken: token => ({ a: 'one', b: 'one', x: 'else' }[token]
      ? { user, session: session(token === 'x' ? 'other-room' : 'shared-room') } : null),
    verifyHostAudioToken: token => token === 'host' ? { user, session: session('shared-room') } : null,
    hostAudioSessionState: () => ({ active: true }),
    participantTokenState: () => ({ active: true }),
    registerParticipantGoogleEmail() {},
    sweepIdleSessions() {},
    appendLiveTranscriptSegment() {},
    appendLiveTranscriptSegments() {},
    touchSessionSpeech() {},
  };
  const apiFile = path.join(__dirname, '../server.js');
  const code = fs.readFileSync(apiFile, 'utf8');
  const fakeReq = name => ({ headers: { host: '127.0.0.1', origin: 'https://www.zapperapp.in' }, url: `/stt?token=${name}` });
  const fakeRequire = moduleName => {
    if (moduleName === './package.json') return require('../package.json');
    if (moduleName === 'dotenv') return { config() {} };
    if (moduleName === 'express') return fakeExpress;
    if (moduleName === 'cors') return () => () => {};
    if (moduleName === 'ws') return FakeDeepgram;
    if (moduleName === 'http') return { createServer: () => ({ listen(_p, _host, callback) { callback(); } }) };
    if (moduleName === './session-control') return () => sessionControl;
    if (moduleName === './live-caption-relay') return relayFactory;
    if (moduleName === './demo-inquiries') return { installDemoInquiries() {} };
    return require(moduleName);
  };
  vm.runInNewContext(code, {
    require: fakeRequire, __dirname: path.dirname(apiFile), process: { env: { JWT_SECRET: 'fake', DEEPGRAM_API_KEY: 'test-key', WEB_ORIGINS: 'https://www.zapperapp.in' } },
    Buffer, URL, URLSearchParams, console: { log() {}, error() {} },
    setInterval: (...args) => setInterval(...args), clearInterval, setTimeout, clearTimeout, setImmediate,
  }, { filename: apiFile });

  const desktopA = new ClientSocket(), desktopB = new ClientSocket(), foreign = new ClientSocket(), host = new ClientSocket();
  serverSocket.emit('connection', desktopA, fakeReq('a'));
  serverSocket.emit('connection', desktopB, fakeReq('b'));
  serverSocket.emit('connection', foreign, fakeReq('x'));
  serverSocket.emit('connection', host, fakeReq('host'));
  assert.equal(deepgramSockets.length, 0, 'desktop should listen without sending any PCM');
  host.emit('message', Buffer.alloc(3200), true);
  await new Promise(resolve => process.nextTick(resolve));
  assert.equal(deepgramSockets.length, 1, 'host PCM opens the transcription provider');
  const providerPayload = (text, final) => Buffer.from(JSON.stringify({
    is_final: final, speech_final: final, channel: { alternatives: [{ transcript: text, confidence: .9 }] }
  }));
  deepgramSockets[0].emit('message', providerPayload('hello from web host', false));
  deepgramSockets[0].emit('message', providerPayload('hello from web host', true));
  assert.deepEqual(desktopA.messages.filter(m => m.type === 'transcript').map(m => [m.text, m.isFinal]),
    [['hello from web host', false], ['hello from web host', true]]);
  assert.deepEqual(desktopB.messages.filter(m => m.type === 'transcript').map(m => m.source), ['host', 'host']);
  assert.equal(foreign.messages.filter(m => m.type === 'transcript').length, 0, 'another PIN cannot view host captions');

  // When Deepgram is not available, browser recognition sends signed text on
  // its existing host socket. The desktop must treat this as HOST speech, not
  // as its own Meet caption source, and must never echo to unrelated PINs.
  host.emit('message', Buffer.from(JSON.stringify({ type: 'local_caption', text: 'host browser speech fallback', isFinal: true, capturedAt: Date.now() })), false);
  await new Promise(resolve => process.nextTick(resolve));
  assert.equal(desktopA.messages.at(-1).source, 'host');
  assert.equal(desktopA.messages.at(-1).text, 'host browser speech fallback');
  assert.equal(desktopB.messages.at(-1).source, 'host');
  assert.equal(host.messages.at(-1).type, 'caption_delivery');
  assert.equal(host.messages.at(-1).viewerCount, 2);
  assert.equal(foreign.messages.filter(m => m.text === 'host browser speech fallback').length, 0);

  // Meet DOM caption path: text is persisted/relayed without opening Deepgram.
  const beforeLocalCaptionProviders = deepgramSockets.length;
  desktopA.emit('message', Buffer.from(JSON.stringify({ type: 'local_caption', text: 'caption from Meet DOM', isFinal: true, capturedAt: Date.now() })), false);
  await new Promise(resolve => process.nextTick(resolve));
  assert.equal(deepgramSockets.length, beforeLocalCaptionProviders, 'local Meet captions must not open Deepgram');
  assert.equal(desktopA.messages.filter(m => m.text === 'caption from Meet DOM').length, 0, 'sender renders locally and should not receive an echo');
  assert.equal(desktopB.messages.filter(m => m.text === 'caption from Meet DOM').at(-1)?.source, 'meet-captions');

  // Existing desktop -> backend transcription remains local, not rebroadcast.
  desktopA.emit('message', Buffer.alloc(3200), true);
  await new Promise(resolve => process.nextTick(resolve));
  assert.equal(deepgramSockets.length, 2);
  deepgramSockets[1].emit('message', providerPayload('desktop Meet audio', true));
  assert.equal(desktopA.messages.at(-1).text, 'desktop Meet audio');
  assert.equal(desktopB.messages.filter(m => m.text === 'desktop Meet audio').length, 0);

  desktopB.close();
  deepgramSockets[0].emit('message', providerPayload('after disconnect', true));
  assert.equal(desktopB.messages.filter(m => m.text === 'after disconnect').length, 0);
  assert.equal(desktopA.messages.at(-1).text, 'after disconnect');
  desktopA.close(); foreign.close(); host.close();
  console.log(JSON.stringify({ ok: true, hostCaptionForwardedToTwoSilentPINClients: true,
    interimAndFinal: true, crossSessionIsolated: true, desktopCaptureUnchanged: true, disconnectRemoved: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
