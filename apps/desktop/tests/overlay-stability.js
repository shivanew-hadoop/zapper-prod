'use strict';
// Regression: displayed words are append-only, including interim -> final,
// recognition revisions, relay replays, long meetings and scroll-follow.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../overlay/overlay.js'), 'utf8');
const start = source.indexOf('// Displayed captions are append-only');
const end = source.indexOf('\nfunction showJoinError(', start);
assert(start > 0 && end > start);
const transcriptEl = {
  children: [], clears: 0, scrollHeight: 200, clientHeight: 40, scrollTop: 0,
  set textContent(v) { this.clears++; this.children = []; },
  append(...items) { this.children.push(...items); },
  contains(item) { return this.children.includes(item); }
};
let now = 100000;
const context = vm.createContext({
  transcriptEl, document: { createTextNode: value => ({ nodeValue: value }) },
  Date: { now: () => now }, Math,
  transcriptAutoScroll: true, transcriptUserScrollIntent: false,
  transcriptScrollTopLock: 0
});
vm.runInContext(source.slice(start, end), context);
function show(text, isFinal = false, origin = 'local-meet') {
  now += 60;
  context.renderTranscript({ text, isFinal, origin });
}
const visible = () => transcriptEl.children.map(n => n.nodeValue).join('');
show('I wanted');
const first = transcriptEl.children[1];
show('I wanted to see');
assert.equal(visible(), 'I wanted to see');
show('I wanted Tu Si', true); // Meet corrects a recognized final after interim
assert(visible().startsWith('I wanted to see'), 'printed words never disappear on final correction');
assert(transcriptEl.contains(first), 'original word node survives Google correction');
show('I wanted Tu Si', true, 'host-relay');
assert.equal(transcriptEl.children.filter(Boolean).length, 3, 'relay echo cannot duplicate sentence');
now += 1800;
show('Coming to roles');
show('Coming to roles and responsibilities');
assert(visible().includes('Coming to roles and responsibilities'));
for (let i = 0; i < 160; i++) {
  now += 1300;
  show(`line${i} Kubernetes`, true);
}
const beforeNodes = transcriptEl.children.slice();
const before = visible();
context.renderTranscript(); // status/scroll refresh must not rebuild anything
assert.equal(visible(), before);
assert(beforeNodes.every((node, i) => node === transcriptEl.children[i]), 'no transcript nodes replaced');
assert.equal(transcriptEl.clears, 1, 'only the initial session construction may clear');
assert(visible().includes('line159 Kubernetes'), '160+ final lines are retained');
context.resetCaptionDisplay();
assert.equal(transcriptEl.clears, 2, 'an explicit new session is allowed to clear old captions');
assert.equal(visible(), 'Waiting for host to speak...');
assert(/!transcriptUserScrollIntent/.test(source), 'programmatic scrolling cannot disable follow mode');
console.log(JSON.stringify({ ok: true, printedWordsPermanent: true, noFinalSwap: true, noRelayEcho: true,
  moreThan160Lines: true, scrollGuard: true, explicitSessionResetOnly: true }));
