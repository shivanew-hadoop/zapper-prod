const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../overlay/overlay.js'), 'utf8');
const start = source.indexOf('// Completed lines are append-only DOM nodes.');
const end = source.indexOf('\nfunction showJoinError(', start);
assert(start > 0 && end > start);
const nodes = [];
const transcriptEl = {
  children: [], scrollHeight: 200, clientHeight: 40, scrollTop: 0,
  set textContent(_) { this.children = []; },
  append(...items) { this.children.push(...items); },
  contains(item) { return this.children.includes(item); },
  removeChild(item) { const index = this.children.indexOf(item); if (index >= 0) this.children.splice(index, 1); },
  insertBefore(item, next) {
    const index = this.children.indexOf(next);
    assert(index >= 0);
    this.children.splice(index, 0, item);
  },
};
const context = {
  transcriptEl, document: { createTextNode(value) {
    const node = { nodeValue: value }; nodes.push(node); return node;
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
render(['I wanted to see'], 'coming to my roles');
const confirmedLine = transcriptEl.children[1];
assert.equal(confirmedLine.nodeValue, 'I wanted to see');
render(['I wanted to see'], 'coming to my roles and responsibilities');
const stableWord = transcriptEl.children.find(node => node.nodeValue === '\ncoming');
assert(stableWord, 'first settled provisional word is a separate immutable node');
render(['I wanted to see'], 'coming to my roles and responsibilities today');
assert.equal(stableWord.nodeValue, '\ncoming', 'locked word text is never changed');
assert(transcriptEl.contains(stableWord), 'locked word node never gets recreated on interim update');
assert.equal(transcriptEl.children[1], confirmedLine);
assert.equal(confirmedLine.nodeValue, 'I wanted to see');
render(['I wanted to see', 'coming to my roles and responsibilities today'], '');
const nextConfirmed = transcriptEl.children[2];
assert.equal(nextConfirmed.nodeValue, '\ncoming to my roles and responsibilities today');
render(['I wanted to see', 'coming to my roles and responsibilities today'], 'next sentence');
assert.equal(transcriptEl.children[1], confirmedLine);
assert.equal(transcriptEl.children[2], nextConfirmed);
render(['I wanted to see', 'coming to my roles and responsibilities today'], 'next sentence grows');
assert.equal(transcriptEl.children[1], confirmedLine, 'first finalized node never repainted');
assert.equal(transcriptEl.children[2], nextConfirmed, 'second finalized node never repainted');
render([], 'new host session');
assert(!transcriptEl.contains(confirmedLine), 'only a new session can clear prior final nodes');
console.log(JSON.stringify({ ok: true, immutableFinalLines: true, provisionalPrefixLocked: true, noRedraw: true, sessionReset: true }));
