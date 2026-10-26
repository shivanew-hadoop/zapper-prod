const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('module');
class Socket extends EventEmitter {
  static OPEN = 1;
  static CONNECTING = 0;
  constructor(url) { super(); this.url = url; this.readyState = 0; this.bufferedAmount = 0; this.sent = []; Socket.instances.push(this); }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.emit('close', 1000); }
}
Socket.instances = [];
const oldLoad = Module._load;
Module._load = function(name, ...args) { return name === 'ws' ? Socket : oldLoad.call(this, name, ...args); };
const { startHostCaptionRelay, stopHostCaptionRelay, publishHostCaption } = require('../transcriber/hostCaptionRelay');
Module._load = oldLoad;
assert.equal(startHostCaptionRelay({ backendUrl: 'https://api.zapperapp.in', captureToken: 'private-opaque' }), true);
const first = Socket.instances[0];
assert(first.url.startsWith('wss://api.zapperapp.in/stt?token=private-opaque'));
assert.equal(publishHostCaption({ text: 'First word', isFinal: false }), false, 'interims must not queue while offline');
assert.equal(publishHostCaption({ text: 'First final phrase', isFinal: true }), false);
first.readyState = Socket.OPEN;
first.emit('open');
assert.deepEqual(first.sent.map(x => x.text), ['First final phrase'], 'pending final must flush on connect');
assert.equal(publishHostCaption({ text: 'Hello world', isFinal: false }), true);
assert.deepEqual(first.sent.map(x => x.isFinal), [true, false]);
stopHostCaptionRelay();
assert.equal(publishHostCaption({ text: 'No active session', isFinal: true }), false);
assert.equal(first.readyState, 3, 'host leave closes only the separate host caption socket');
console.log(JSON.stringify({ok:true, authenticatedHostSocket:true, offlineFinalsOnly:true, cleanup:true}));
