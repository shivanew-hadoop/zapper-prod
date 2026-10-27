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
    touchSessionCaption() {},
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
    require: fakeRequire, __dirname: path.dirname(apiFile), process: { env: { JWT_SECRET: 'fake', DEEPGRAM_API_KEY: 'test-key', ZAPPER_ENABLE_DEEPGRAM_STT: 'true', WEB_ORIGINS: 'https://www.zapperapp.in' } },
    Buffer, URL, URLSearchParams, console: { log() {}, error() {} },
    setInterval: (...args) => setInterval(...args), clearInterval, setTimeout, clearTimeout, setImmediate,
  }, { filename: apiFile });

  const desktopA = new ClientSocket(), desktopB = new ClientSocket(), foreign = new ClientSocket(), host = new ClientSocket();
  serverSocket.emit('connection', desktopA, fakeReq('a'));
  serverSocket.emit('connection', desktopB, fakeReq('b'));
  serverSocket.emit('connection', foreign, fakeReq('x'));
  serverSocket.emit('connection', host, fakeReq('host'));
  assert.equal(deepgramSockets.length, 0, 'desktop should listen without sending any PCM');
  // Deepgram is hard OFF even when a deployment still has the old key and
  // enable flag. Host and participant audio must never reach a provider.
  host.emit('message', Buffer.alloc(3200), true);
  desktopA.emit('message', Buffer.alloc(3200), true);
  await new Promise(resolve => process.nextTick(resolve));
  assert.equal(deepgramSockets.length, 0, 'no provider connection even with legacy enable flag');

  // The primary caption path stays live: original text from Meet is persisted
  // and relayed only to viewers authorized for the same session.
  host.emit('message', Buffer.from(JSON.stringify({
    type: 'local_caption', text: 'I wanted to see', isFinal: true, capturedAt: Date.now()
  })), false);
  await new Promise(resolve => process.nextTick(resolve));
  assert.equal(desktopA.messages.find(m => m.text === 'I wanted to see')?.source, 'meet-captions');
  assert.equal(desktopB.messages.find(m => m.text === 'I wanted to see')?.isFinal, true);
  assert.equal(foreign.messages.filter(m => m.type === 'transcript').length, 0, 'PIN isolation preserved');
  assert.equal(host.messages.filter(m => m.text === 'I wanted to see').length, 0, 'no local echo');

  desktopA.emit('message', Buffer.from(JSON.stringify({
    type: 'local_caption', text: 'caption from Meet DOM', isFinal: false, capturedAt: Date.now()
  })), false);
  await new Promise(resolve => process.nextTick(resolve));
  assert.equal(desktopB.messages.find(m => m.text === 'caption from Meet DOM'), undefined,
    'secondary PIN viewers must not replace the host as the caption relay leader');
  assert.equal(desktopA.messages.find(m => m.text === 'caption from Meet DOM'), undefined, 'no echo to sender');
  assert.equal(deepgramSockets.length, 0, 'transcript relay never invokes Deepgram');

  desktopB.close();
  host.emit('message', Buffer.from(JSON.stringify({
    type: 'local_caption', text: 'after disconnect', isFinal: true, capturedAt: Date.now()
  })), false);
  await new Promise(resolve => process.nextTick(resolve));
  assert.equal(desktopB.messages.filter(m => m.text === 'after disconnect').length, 0);
  assert.equal(desktopA.messages.find(m => m.text === 'after disconnect')?.text, 'after disconnect');
  // Native desktop host token is allowed without a browser Origin; a hostile
  // website with a different Origin is still rejected.
  const nativeHost = new ClientSocket();
  serverSocket.emit('connection', nativeHost, { headers: { host: 'localhost' }, url: '/stt?token=host' });
  assert.equal(nativeHost.readyState, 1, 'native host caption relay may use authorized token without browser Origin');
  const hostile = new ClientSocket();
  serverSocket.emit('connection', hostile, { headers: { host: 'localhost', origin: 'https://evil.example' }, url: '/stt?token=host' });
  assert.equal(hostile.readyState, 3, 'unauthorized browser origin must still be rejected');
  nativeHost.close();
  desktopA.close(); foreign.close(); host.close();

  // Default mode: no STT flag and even a configured legacy key must NEVER
  // start a provider connection on binary PCM; authorized Meet captions relay.
  const previousProviderCount = deepgramSockets.length;
  vm.runInNewContext(code, {
    require: fakeRequire, __dirname: path.dirname(apiFile),
    process: { env: { JWT_SECRET: 'fake', DEEPGRAM_API_KEY: 'test-key', WEB_ORIGINS: 'https://www.zapperapp.in' } },
    Buffer, URL, URLSearchParams, console: { log() {}, error() {} },
    setInterval, clearInterval, setTimeout, clearTimeout, setImmediate,
  }, { filename: apiFile });
  const onlyCaptionSender = new ClientSocket(), onlyCaptionViewer = new ClientSocket();
  serverSocket.emit('connection', onlyCaptionSender, fakeReq('a'));
  serverSocket.emit('connection', onlyCaptionViewer, fakeReq('b'));
  onlyCaptionSender.emit('message', Buffer.alloc(3200), true);
  await new Promise(resolve => process.nextTick(resolve));
  assert.equal(deepgramSockets.length, previousProviderCount, 'Deepgram stays OFF even with a legacy key');
  onlyCaptionSender.emit('message', Buffer.from(JSON.stringify({
    type: 'local_caption', text: 'Native Meet remains live', isFinal: true, capturedAt: Date.now()
  })), false);
  await new Promise(resolve => process.nextTick(resolve));
  assert.equal(onlyCaptionViewer.messages.find(m => m.text === 'Native Meet remains live')?.source, 'meet-captions',
    'caption-only mode retains authorized host/PIN relay');
  onlyCaptionSender.close(); onlyCaptionViewer.close();
  console.log(JSON.stringify({ ok: true, hostCaptionForwardedToTwoSilentPINClients: true,
    deepgramHardOff: true, nativeCaptionRelayPreserved: true,
    interimAndFinal: true, crossSessionIsolated: true, disconnectRemoved: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
