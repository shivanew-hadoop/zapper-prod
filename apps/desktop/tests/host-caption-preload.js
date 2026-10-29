// End-to-end simulated host Meet DOM: no Electron or network needed.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const code = fs.readFileSync(path.join(__dirname, '../meet-controller/host-caption-preload.js'), 'utf8');
const emitted = [], intervals = [], timers = [];
let now = 100000;
let captionText = '';
let ccOff = true, clicks = 0, languageMenuOpen = false, ukSelected = false;
let visiblyRenderedCaption = '';
const textNode = { textContent: '', innerText: '', closest: () => null };
const languagePicker = {
  innerText: 'English (India)', textContent: 'English (India)',
  closest: () => null,
  hasAttribute: name => name === 'aria-expanded',
  getAttribute: name => name === 'aria-haspopup' ? 'listbox' : '',
  click: () => { languageMenuOpen = true; }
};
const ukOption = {
  innerText: 'English (UK)', textContent: 'English (UK)',
  getAttribute: () => '',
  click: () => {
    ukSelected = true;
    languageMenuOpen = false;
    languagePicker.innerText = 'English (UK)';
    languagePicker.textContent = 'English (UK)';
  }
};
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
  querySelectorAll: selector => selector.startsWith('textarea, input,') ? [] : selector.includes('[role="option"]') ? (languageMenuOpen ? [ukOption] : []) : [button, languagePicker],
};
const MockDate = class extends Date { static now() { return now; } };
const ctx = {
  require: name => { if (name === './meet-chat-rows') return require('../meet-controller/meet-chat-rows'); assert.equal(name, 'electron'); return { ipcRenderer: { send: (channel, payload) => emitted.push({ channel, ...payload }) } }; },
  document: doc, Date: MockDate, console,
  setInterval: (fn, delay) => intervals.push({ fn, delay }),
  setTimeout: (fn, delay) => { const t = { fn, at: now + delay }; timers.push(t); return t; },
  clearTimeout: timer => { timer.fn = null; },
};
vm.runInNewContext(code, ctx);
assert.equal(intervals.length, 2);
assert.equal(intervals[0].delay, 120);
function tick(ms = 0) {
  now += ms;
  textNode.textContent = captionText;
  textNode.innerText = visiblyRenderedCaption || captionText;
  for (const { fn, delay } of intervals) if (delay === 120) fn();
  for (const timer of timers) if (timer.fn && timer.at <= now) { const cb = timer.fn; timer.fn = null; cb(); }
}
captionText = 'Thank you for joining the call';
tick();
assert.equal(clicks, 1, 'host caption switch should be enabled');
assert.equal(languageMenuOpen, true, 'host opens a verified English caption-language chooser');
tick(320);
assert.equal(ukSelected, true, 'host picks Google Meet English (UK)');
assert.deepEqual(emitted.filter(e => !e.isFinal).map(e => e.text), ['Thank you for joining the call'],
  'low latency interim after stability');
tick(2500);
assert.deepEqual(emitted.filter(e => e.isFinal).map(e => e.text), ['Thank you for joining the call']);
captionText = 'Thank u for joining the call';
tick(130);
tick(2500);
assert.deepEqual(emitted.filter(e => e.isFinal).map(e => e.text), ['Thank you for joining the call'],
  'recognition correction cannot produce a duplicate line');
captionText = 'Coming to my roles and responsibilities';
tick(150);
tick(2500);
assert.deepEqual(emitted.filter(e => e.isFinal).map(e => e.text),
  ['Thank you for joining the call', 'Coming to my roles and responsibilities']);
// The visually rendered words take priority over stale/hidden DOM textContent.
captionText = 'I wanted Tu Si';
visiblyRenderedCaption = 'I wanted to see';
tick(150);
tick(350);
assert.equal(emitted.filter(e => !e.isFinal).at(-1).text, 'I wanted to see',
  'overlay interim must match the displayed Meet caption, not alternate DOM transcription');
tick(2500);
assert.equal(emitted.filter(e => e.isFinal).at(-1).text, 'I wanted to see',
  'overlay final must preserve the human-visible caption exactly');
assert(!emitted.some(e => e.isFinal && e.text === 'I wanted Tu Si'), 'stale DOM spelling must never be committed');
// After several minutes Google can leave a stale caption tray mounted while
// rendering speech in a new tray. The collector must not keep reading the old.
const oldBlock = { querySelector: selector => selector === '[jsname="bVV8Bd"]'
  ? { innerText: 'old stale caption text', textContent: 'old stale caption text', closest: () => null } : null };
const oldTray = { closest: () => null, getBoundingClientRect: () => ({ width: 160, height: 40 }),
  querySelectorAll: selector => selector === '[jsname="YSxPC"]' ? [oldBlock] : [] };
const oldQueryAll = doc.querySelectorAll;
doc.querySelectorAll = selector => selector.startsWith('[jsname="tgaKEf"]')
  ? [oldTray, captionContainer] : oldQueryAll(selector);
captionText = 'New words after three minutes';
visiblyRenderedCaption = '';
tick(150);
tick(300);
assert.equal(emitted.filter(e => !e.isFinal).at(-1).text, 'New words after three minutes',
  'a stale first Meet caption region cannot freeze the host overlay');
assert(emitted.every(e => e.channel === 'host-caption-message'), 'host captions must use their own IPC channel');
assert(!code.includes('getUserMedia ='), 'host capture must never mute microphone');
console.log(JSON.stringify({ ok: true, hostCaptionsAutoEnabled: true, lowLatency: true, noDuplicateRevision: true, microphonePreserved: true, visibleCaptionPriority: true, ukCaptionSelected: true }));
