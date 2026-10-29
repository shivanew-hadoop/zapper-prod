'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = path.resolve(__dirname, '..');
const overlay = fs.readFileSync(path.join(base, 'overlay/overlay.js'), 'utf8');
const begin = overlay.indexOf('// Completed lines are append-only DOM nodes.');
const end = overlay.indexOf('\nfunction showJoinError(', begin);
assert(begin >= 0 && end > begin);
const transcriptEl = {
  children: [], clears: 0, scrollHeight: 300, clientHeight: 50, scrollTop: 0,
  set textContent(value) { assert.equal(value, ''); this.clears++; this.children = []; },
  append(...nodes) { this.children.push(...nodes); },
  contains(node) { return this.children.includes(node); },
  removeChild(node) { const i = this.children.indexOf(node); assert(i !== -1); this.children.splice(i, 1); },
  insertBefore(node, target) { const i = this.children.indexOf(target); assert(i !== -1); this.children.splice(i, 0, node); },
};
const state = { transcriptEl, document: { createTextNode: nodeValue => ({ nodeValue }) }, finalLines: [],
  interimText: '', transcriptAutoScroll: false, transcriptUserScrollIntent: true,
  transcriptScrollTopLock: 12, Math };
vm.createContext(state);
vm.runInContext(overlay.slice(begin, end), state);
const visible = () => transcriptEl.children.map(node => node.nodeValue).join('');
function draw(finals, interim) {
  state.finalLines = finals; state.interimText = interim;
  vm.runInContext('renderTranscript()', state);
}
draw(['Previously finalized sentence'], 'Today we are using LangChain for our project');
const committedFirst = transcriptEl.children.find(node => node.nodeValue === 'Previously finalized sentence');
const previouslyPrinted = visible();
const clearCount = transcriptEl.clears;
// Google Meet temporarily emits only a single word from the old row after a pause.
draw(['Previously finalized sentence'], 'Today');
assert.equal(visible(), previouslyPrinted, 'short interim must not remove already printed words');
draw(['Previously finalized sentence'], 'Today we are using LangChain');
assert.equal(visible(), previouslyPrinted, 'old visible row must not rewind');
// Google corrects one recent word while continuing the sentence; never repaint.
draw(['Previously finalized sentence'], 'Today we are using LangChain for our projects tomorrow');
assert.equal(visible(), previouslyPrinted + ' tomorrow', 'append new suffix without rewriting earlier printed text');
assert(transcriptEl.contains(committedFirst));
assert.equal(transcriptEl.clears, clearCount);
// Collector marks the old caption final before delivering a fresh one-word row.
draw(['Previously finalized sentence', 'Today we are using LangChain for our project tomorrow'], '');
const finalSecond = transcriptEl.children.find(node => node.nodeValue === '\nToday we are using LangChain for our project tomorrow');
assert(finalSecond);
draw(['Previously finalized sentence', 'Today we are using LangChain for our project tomorrow'], 'Kubernetes');
assert(visible().endsWith('\nKubernetes'), 'new single-word row must be visible');
assert(transcriptEl.contains(committedFirst));
assert(transcriptEl.contains(finalSecond));
assert.equal(transcriptEl.clears, clearCount);
for (let i = 3; i <= 170; i++) {
  const finals = ['Previously finalized sentence', 'Today we are using LangChain for our project tomorrow'];
  for (let j = 3; j <= i; j++) finals.push(`Line number ${j}`);
  draw(finals, '');
}
assert(transcriptEl.contains(committedFirst), 'oldest finalized node survives 170 lines');
assert.equal(transcriptEl.clears, clearCount, 'history must never be erased or redrawn');
// The generic English word "language" must not be treated as a tech term.
const { correctTechnologyTerms } = require('../transcriber/technologyCorrections');
assert.equal(correctTechnologyTerms('lag chain with LAN graph'), 'LangChain with LangGraph');
assert.equal(correctTechnologyTerms('language classes'), 'language classes');
console.log(JSON.stringify({ ok:true, oneWordPause:true, rollingRevision:true, immutableFinals:true, longTranscript:170, terminology:true }));
