// End-to-end simulated host Meet DOM: no Electron or network needed.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const code = fs.readFileSync(path.join(__dirname, '../meet-controller/host-caption-preload.js'), 'utf8');
const emitted = [], intervals = [], timers = [];
let now = 100000;
let captionText = '';
let ccOff = true, clicks = 0;
const textNode = { textContent: '', closest: () => null };
const block = {
  querySelector: selector => selector === '[jsname="bVV8Bd"]' ? textNode : null,
};
const captionContainer = {
  closest: () => null,
  querySelectorAll: selector => selector === '[jsname="YSxPC"]' ? [block] : [],
};
const button = {
  getAttribute: name => name === 'aria-label' ? (ccOff ? 'Turn on captions' : 'Turn off captions') : '',
  click: () => { clicks++; ccOff = false; }
};
const doc = {
  readyState: 'complete',
  querySelector: selector => selector.includes('Leave call') ? {} : captionContainer,
  querySelectorAll: () => [button],
};
const MockDate = class extends Date { static now() { return now; } };
const ctx = {
  require: name => { assert.equal(name, 'electron'); return { ipcRenderer: { send: (channel, payload) => emitted.push({ channel, ...payload }) } }; },
  document: doc, Date: MockDate, console,
  setInterval: (fn, delay) => intervals.push({ fn, delay }),
  setTimeout: (fn, delay) => { const t = { fn, at: now + delay }; timers.push(t); return t; },
  clearTimeout: timer => { timer.fn = null; },
};
vm.runInNewContext(code, ctx);
assert.equal(intervals.length, 1);
assert.equal(intervals[0].delay, 120);
function tick(ms = 0) {
  now += ms;
  textNode.textContent = captionText;
  for (const { fn } of intervals) fn();
  for (const timer of timers) if (timer.fn && timer.at <= now) { const cb = timer.fn; timer.fn = null; cb(); }
}
captionText = 'Thank you for joining the call';
tick();
assert.equal(clicks, 1, 'host caption switch should be enabled');
tick(320);
assert.deepEqual(emitted.filter(e => !e.isFinal).map(e => e.text), ['Thank you for joining the call'],
  'low latency interim after stability');
tick(1300);
assert.deepEqual(emitted.filter(e => e.isFinal).map(e => e.text), ['Thank you for joining the call']);
captionText = 'Thank u for joining the call';
tick(130);
tick(1400);
assert.deepEqual(emitted.filter(e => e.isFinal).map(e => e.text), ['Thank you for joining the call'],
  'recognition correction cannot produce a duplicate line');
captionText = 'Coming to my roles and responsibilities';
tick(150);
tick(1500);
assert.deepEqual(emitted.filter(e => e.isFinal).map(e => e.text),
  ['Thank you for joining the call', 'Coming to my roles and responsibilities']);
assert(emitted.every(e => e.channel === 'host-caption-message'), 'host captions must use their own IPC channel');
assert(!code.includes('getUserMedia ='), 'host capture must never mute microphone');
console.log(JSON.stringify({ ok: true, hostCaptionsAutoEnabled: true, lowLatency: true, noDuplicateRevision: true, microphonePreserved: true }));
