// Host Meet screenshot-independent chat test. The host preload is sandboxed;
// it cannot depend on node `require` beyond Electron's ipcRenderer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../meet-controller/host-caption-preload.js'), 'utf8');
const messages = [], intervals = [];
let now = 123456;
function element({ text = '', id = '', sender = '', children = [], role = '' } = {}) {
  const el = {
    innerText: text, textContent: text, parentElement: null,
    getAttribute: k => k === 'data-message-id' ? id : k === 'data-sender-name' ? sender : k === 'role' ? role : '',
    getBoundingClientRect: () => ({ width: 200, height: 30 }),
    querySelector: () => null,
    querySelectorAll: () => children,
    click: () => {},
    closest: () => null,
  };
  for (const c of children) c.parentElement = el;
  return el;
}
const rowHost = element({ text: 'You\n10:31 AM\nMessage from the host', id: 'm1' });
const rowPerson = element({ text: 'Alice Kumar\n10:32 AM\nMessage from participant', id: 'm2' });
const rowSystem = element({ text: 'Google Meet\n10:33 AM\nAre you still there?', id: 'm3' });
const panel = element({ text: [rowHost, rowPerson, rowSystem].map(x => x.innerText).join('\n'), children: [rowHost, rowPerson, rowSystem] });
const input = element();
input.getAttribute = key => key === 'aria-label' ? 'Message everyone' : '';
input.parentElement = panel;
const document = {
  readyState: 'complete', body: element(),
  querySelector: q => q.includes('Leave call') ? {} : null,
  querySelectorAll: q => q.startsWith('textarea, input,') ? [input] : []
};
vm.runInNewContext(source, {
  document,
  require: name => { assert.equal(name, 'electron', 'sandbox preloader must not require custom sibling modules'); return { ipcRenderer: { send(channel, payload) { messages.push({ channel, ...payload }); } } }; },
  setInterval: (fn, duration) => intervals.push({ fn, duration }),
  setTimeout: () => 1, clearTimeout() {},
  Date: class extends Date { static now() { return now; } },
  getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  console
});
const chatScan = intervals.find(item => item.duration === 650);
assert(chatScan, 'host chat must be observed on a dedicated interval');
chatScan.fn();
chatScan.fn();
const chat = messages.filter(m => m.channel === 'host-meet-chat-message');
assert.equal(chat.length, 2, 'real people forwarded once; Meet admin notices removed');
assert.deepEqual(chat.map(m => m.sender), ['Host', 'Alice Kumar']);
assert.deepEqual(chat.map(m => m.message), ['Message from the host', 'Message from participant']);
console.log(JSON.stringify({ ok: true, sandboxSafeHostChat: true, groupObservers: true, systemFiltered: true, deduped: true }));
