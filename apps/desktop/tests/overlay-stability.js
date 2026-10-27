const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../overlay/overlay.js'), 'utf8');
const start = source.indexOf('// Keep committed text nodes alive:');
const end = source.indexOf('\nfunction showJoinError(', start);
assert(start > 0 && end > start, 'append-only transcript renderer must exist');
const nodes = [];
const transcriptEl = {
  children: [], scrollHeight: 100, clientHeight: 10, scrollTop: 0,
  set textContent(_) { this.children = []; },
  append(...n) { this.children.push(...n); },
  contains(n) { return this.children.includes(n); }
};
const context = {
  transcriptEl, document: { createTextNode(s) { const node = { nodeValue: s }; nodes.push(node); return node; } },
  finalLines: [], interimText: '', transcriptAutoScroll: true, transcriptRenderVersion: 0,
  transcriptRenderRestoring: false, transcriptScrollTopLock: 0,
  requestAnimationFrame(cb) { cb(); }, Math
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
function render(finals, interim) {
  context.finalLines = finals;
  context.interimText = interim;
  vm.runInContext('renderTranscript()', context);
}
render(['Settled words stay'], 'now');
const first = [...transcriptEl.children];
assert.equal(first.length, 2);
assert.equal(first[0].nodeValue, 'Settled words stay\n');
render(['Settled words stay'], 'now quickly');
assert.equal(transcriptEl.children[0], first[0], 'final text node identity must remain unchanged');
assert.equal(transcriptEl.children[0].nodeValue, 'Settled words stay\n');
assert.equal(transcriptEl.children[1], first[1], 'interim span must also remain mounted');
render(['Settled words stay', 'now quickly'], '');
render(['Settled words stay', 'now quickly'], 'more');
assert.equal(transcriptEl.children[0], first[0], 'no full rewrite on new committed lines');
assert.equal(nodes.length, 2, 'no flashing caused by recreating final caption nodes');
console.log(JSON.stringify({ok:true,stableCommittedNode:true,interimNoFullRedraw:true}));
