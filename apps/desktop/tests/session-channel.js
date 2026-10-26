const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
// Run without npm install: inject the fake socket through the existing ws require.
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request === 'ws') return class { static OPEN = 1; };
  return originalLoad.call(this, request, ...args);
};
const { createSessionChannel } = require('../transcriber/session-channel');
Module._load = originalLoad;
class FakeSocket extends EventEmitter {
  static OPEN = 1;
  static sockets = [];
  constructor(url) { super(); this.url = url; this.readyState = 0; this.messages = []; FakeSocket.sockets.push(this); }
  send(x) { this.messages.push(JSON.parse(x)); }
  ping() {}
  close() { this.readyState = 3; this.emit('close'); }
  open() { this.readyState = 1; this.emit('open'); }
  msg(x) { this.emit('message', Buffer.from(JSON.stringify(x))); }
}
(async () => {
const events = [];
const channel = createSessionChannel({ backendUrl: 'https://api.example.test', token: 'abc.def', WebSocketImpl: FakeSocket, onEvent: e => events.push(e) });
assert.match(FakeSocket.sockets[0].url, /^wss:\/\/api\.example\.test\/stt\?token=/);
const id = channel.chat('Hello everyone', 'Host');
channel.caption({ text: 'speech arrived', isFinal: true });
const ws = FakeSocket.sockets[0];
ws.open();
assert.equal(ws.messages.filter(m => m.type === 'chat_message').length, 1);
assert.equal(ws.messages.filter(m => m.type === 'local_caption').length, 1);
ws.msg({ type: 'chat_ack', id });
ws.msg({ type: 'chat_message', message: 'Reply', sender: 'Guest', id: 'other-message' });
assert.equal(events.filter(m => m.type === 'chat_message').length, 1);
// An unacknowledged message must be replayed after the transport reconnects.
const missingId = channel.chat('Message during network trouble', 'Host');
ws.close();
await new Promise(resolve => setTimeout(resolve, 1150));
const resumed = FakeSocket.sockets.at(-1);
assert.notEqual(resumed, ws);
resumed.open();
assert.ok(resumed.messages.some(m => m.id === missingId), 'unacknowledged chat should replay');
assert.ok(!resumed.messages.some(m => m.id === id), 'acknowledged chat must not replay');
channel.stop();
assert.equal(resumed.readyState, 3);
assert.throws(() => createSessionChannel({ backendUrl: 'https://api.example.test', token: 'not-jwt', WebSocketImpl: FakeSocket }));
console.log(JSON.stringify({ok:true,hostAuthSocket:true,queuedCaptions:true,queuedChat:true,chatAcknowledgements:true,reconnectReplay:true}));
})().catch(error => { console.error(error); process.exitCode = 1; });
