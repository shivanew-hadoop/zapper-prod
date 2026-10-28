const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../overlay/overlay.js'), 'utf8');
const start = source.indexOf('// The live transcript is immutable ink:');
const end = source.indexOf('\nfunction showJoinError(', start);
assert(start > 0 && end > start);
const nodes = [];
let clears = 0, rewrites = 0;
const transcriptEl = {
  children: [], scrollHeight: 200, clientHeight: 40, scrollTop: 0,
  set textContent(_) { this.children = []; clears++; },
  append(...items) { this.children.push(...items); },
  contains(item) { return this.children.includes(item); },
  removeChild(item) {
    const index = this.children.indexOf(item);
    if (index >= 0) this.children.splice(index, 1);
  }
};
const context = {
  transcriptEl,
  document: { createTextNode(value) {
    let v = value;
    const node = {
      get nodeValue() { return v; },
      set nodeValue(next) { if (next !== v) rewrites++; v = next; }
    };
    nodes.push(node);
    return node;
  } },
  finalLines: [], interimText: '', transcriptAutoScroll: true,
  transcriptUserScrollIntent: false, transcriptScrollTopLock: 0, Math,
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
function render(finals, interim) {
  context.finalLines = finals;
  context.interimText = interim;
  vm.runInContext('renderTranscript()', context);
}
function displayText() { return transcriptEl.children.map(n => n.nodeValue).join(''); }
function assertUnchanged(oldNodes) {
  for (const n of oldNodes) assert(transcriptEl.contains(n), 'printed word must remain mounted');
}

render([], 'I wanted to');
assert.equal(displayText(), 'Waiting for host to speak...', 'unstable hypothesis should never flash');
render([], 'I wanted to see');
assert.equal(displayText(), 'I wanted to', 'repeated words become permanent ink');
const stable = transcriptEl.children.slice();
render([], 'I wanted to say');
assert.equal(displayText(), 'I wanted to', 'Meet correction cannot erase printed words');
assertUnchanged(stable);
render(['I wanted to see'], '');
assert.equal(displayText(), 'I wanted to see', 'final adds only missing words');
assertUnchanged(stable);
const firstLine = transcriptEl.children.slice();
render(['I wanted to see'], 'coming to my roles');
render(['I wanted to see'], 'coming to my roles and responsibilities');
assert.equal(displayText(), 'I wanted to see\ncoming to my roles');
const lastStable = transcriptEl.children.slice();
render(['I wanted to see', 'coming to my roles and responsibilities'], '');
assert.equal(displayText(), 'I wanted to see\ncoming to my roles and responsibilities');
assertUnchanged(lastStable);

const moreFinals = ['I wanted to see', 'coming to my roles and responsibilities'];
for (let i = 0; i < 130; i++) {
  moreFinals.push(`This line ${i} must remain visible`);
  render(moreFinals, '');
}
assert.equal(clears, 1, 'caption renderer must never clear the overlay after 100 lines');
assert.equal(rewrites, 0, 'no displayed word may be repainted');
assertUnchanged(firstLine);
assert.match(displayText(), /This line 129 must remain visible$/);
render([], 'new host session');
assert.equal(clears, 2, 'only explicit new session may reset transcript');
console.log(JSON.stringify({ ok: true, stableWordsNeverRemoved: true, noProvisionalBlink: true,
  no100LineReset: true, sessionReset: true, drawnLines: 132 }));
