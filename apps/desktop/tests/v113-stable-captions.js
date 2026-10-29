// v1.0.13: printed words are never taken back, and a revised word inside an
// already committed sentence never makes the whole Meet row print again.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { correctTechnologyTerms } = require('../transcriber/technologyCorrections');

// ---------- overlay renderer ----------
const overlay = fs.readFileSync(path.join(__dirname, '../overlay/overlay.js'), 'utf8');
const start = overlay.indexOf('// Completed lines are append-only DOM nodes.');
const end = overlay.indexOf('\nfunction showJoinError(', start);
assert(start > 0 && end > start);
const transcriptEl = {
  children: [], scrollHeight: 200, clientHeight: 40, scrollTop: 0,
  set textContent(_) { this.children = []; },
  append(...items) { this.children.push(...items); },
  contains(item) { return this.children.includes(item); },
  removeChild(item) { const i = this.children.indexOf(item); if (i >= 0) this.children.splice(i, 1); },
  insertBefore(item, next) { const i = this.children.indexOf(next); assert(i >= 0); this.children.splice(i, 0, item); },
};
const ctx = {
  transcriptEl, document: { createTextNode: nodeValue => ({ nodeValue }) },
  finalLines: [], interimText: '', transcriptAutoScroll: true,
  transcriptUserScrollIntent: false, transcriptScrollTopLock: 0, Math,
};
vm.createContext(ctx);
vm.runInContext(overlay.slice(start, end), ctx);
const screen = () => transcriptEl.children.map(n => n.nodeValue).join('');
function render(finals, interim) {
  ctx.finalLines = finals.slice(); ctx.interimText = interim;
  vm.runInContext('renderTranscript()', ctx);
  return screen();
}
// A client driver identical to the overlay's onTranscript for finals.
const finals = [];
function interim(text) { return render(finals, correctTechnologyTerms(text)); }
function final(text) {
  const shown = vm.runInContext('reconcileFinal(previousLiveWords.slice(), ' + JSON.stringify(correctTechnologyTerms(text)) + ')', ctx);
  if (shown.promote) finals.push(shown.promote);
  finals.push(shown.text);
  return render(finals, '');
}

// 1. a dip in the stable-word list (Meet revises a word) never erases words
interim('we are building a rag pipeline today');
interim('we are building a rag pipeline today with');
const before = screen();
assert.equal(interim('we are building a rag'), before, 'shorter interim must not take printed words away');
assert.equal(interim('we are building'), before, 'even shorter interim must not take printed words away');
interim('we are building a rag pipeline today with the retriever');
// 2. Meet changes a word that was already settled: screen keeps what was printed
const settled = interim('we are building a rag pipeline today with the retriever and');
const revised = interim('we are building a drag pipeline today with the retriever and tools');
assert(revised.startsWith(settled.replace(/ and$/, '')), 'printed words are not rewritten: ' + revised);
assert(revised.includes('rag pipeline') && !revised.includes('drag'), 'settled word keeps its printed form');
assert(revised.endsWith('tools'), 'new words are still appended');
// 3. a final may extend the sentence but never rewrites the printed words
const printed = screen();
const afterFinal = final('We are building a drag pipeline today with the retriever and tools for search');
assert(afterFinal.startsWith(printed.replace(/ tools$/, '')), 'final keeps printed words: ' + afterFinal);
assert(afterFinal.endsWith('tools for search'), 'final still adds its new words: ' + afterFinal);
assert(!afterFinal.includes('drag'));
// 4. earlier finished lines are append-only through many sentences
const lines = [afterFinal];
for (let n = 1; n <= 8; n++) {
  interim(`sentence number ${n} is spoken`);
  interim(`sentence number ${n} is spoken now`);
  lines.push(final(`Sentence number ${n} is spoken now`));
}
assert.equal(screen().split('\n').length, 9, 'nine sentences on screen');
for (const n of [1, 4, 8]) assert(screen().includes(`entence number ${n} is spoken now`), `sentence ${n} still on screen`);
assert(screen().startsWith('we are building a rag pipeline'), 'first sentence untouched after 9 sentences');
// 5. an unrelated sentence with no final for the previous one does not erase it
interim('the quick brown fox jumps');
interim('the quick brown fox jumps over the lazy dog');
const withFox = screen();
const next = interim('completely different words appear here now');
assert(next.includes('the quick brown fox jumps over the lazy dog'), 'orphan interim stays visible');
assert(next.endsWith('completely different words appear here now'));
final('Completely different words appear here now');
// 6. technology corrections still show up in the live tail
interim('we deploy on kuber');
interim('we deploy on kuber net is');
assert(/on kuber net is$/.test(screen()) || /on Kubernetes$/.test(screen()));
interim('we deploy on kuber net is clusters today');
assert(screen().includes('Kubernetes clusters today'), 'multi-word phonetic variant is corrected on screen: ' + screen());
interim('we use land chain and land graph');
assert(screen().endsWith('LangChain and LangGraph'), screen());

// ---------- caption collectors (host observer) ----------
function hostObserver(file) {
  const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const emitted = [], intervals = [], timers = [];
  let now = 100000, captionText = '';
  const textNode = { textContent: '', innerText: '', closest: () => null };
  const block = { querySelector: s => s === '[jsname="bVV8Bd"]' ? textNode : null };
  const container = { closest: () => null, querySelectorAll: s => s === '[jsname="YSxPC"]' ? [block] : [] };
  const doc = { readyState: 'complete', querySelector: s => s.includes('Leave call') ? {} : container, querySelectorAll: () => [] };
  const MockDate = class extends Date { static now() { return now; } };
  vm.runInNewContext(code, {
    require: () => ({ ipcRenderer: { send: (_, payload) => emitted.push(payload) } }),
    document: doc, Date: MockDate, console,
    setInterval: (fn, delay) => intervals.push({ fn, delay }),
    setTimeout: (fn, delay) => { const t = { fn, at: now + delay }; timers.push(t); return t; },
    clearTimeout: t => { t.fn = null; },
  });
  const tick = ms => {
    now += ms; textNode.textContent = textNode.innerText = captionText;
    for (const { fn, delay } of intervals) if (delay === 120) fn();
    for (const t of timers) if (t.fn && t.at <= now) { const cb = t.fn; t.fn = null; cb(); }
  };
  return { emitted, say(text) { captionText = text; tick(150); tick(300); }, pause: ms => tick(ms) };
}
const sentences = ['We are building a rag pipeline today.', 'The retriever uses embeddings for search.',
  'Then we call the model with context.', 'After that we evaluate the answers carefully.',
  'Finally we deploy it on kubernetes.', 'And monitor latency in production.'];
const host = hostObserver('../meet-controller/host-caption-preload.js');
let row = '';
for (const sentence of sentences) {
  for (const word of sentence.split(' ')) { row += (row ? ' ' : '') + word; host.say(row); }
  host.pause(2600);
}
const committedFinals = host.emitted.filter(e => e.isFinal).length;
assert.equal(committedFinals, sentences.length);
// Meet inserts/revises a word in the MIDDLE of the already committed row
row = row.replace('rag pipeline', 'drag and pipeline'); host.say(row); host.pause(2600);
row = row.replace('retriever', 'retrieval'); host.say(row); host.pause(2600);
// Meet scrolls the oldest words off the front of the row
row = row.split(' ').slice(9).join(' '); host.say(row); host.pause(2600);
// More speech continues in the same row
row += ' And then we say thanks'; host.say(row); host.pause(2600);
const hostFinals = host.emitted.filter(e => e.isFinal).map(e => e.text);
assert.equal(hostFinals.length, sentences.length + 1, 'only the genuinely new speech is a new final: ' + JSON.stringify(hostFinals.slice(sentences.length)));
assert.equal(hostFinals.at(-1), 'And then we say thanks');
assert.equal(new Set(hostFinals.map(t => t.toLowerCase())).size, hostFinals.length, 'no sentence printed twice');
// A truly new utterance is still printed
host.say('Completely unrelated new sentence arrives'); host.pause(2600);
assert.equal(host.emitted.filter(e => e.isFinal).at(-1).text, 'Completely unrelated new sentence arrives');

// ---------- caption collectors (PIN participant) ----------
const pin = fs.readFileSync(path.join(__dirname, '../meet-controller/meet-preload.js'), 'utf8');
function extract(source, name) {
  const marker = `function ${name}(`; const from = source.indexOf(marker); assert(from >= 0, name);
  let depth = 0, i = source.indexOf('{', from);
  for (; i < source.length; i++) { if (source[i] === '{') depth++; else if (source[i] === '}' && --depth === 0) break; }
  return source.slice(from, i + 1);
}
const normalizeText = v => String(v || '').replace(/\s+/g, ' ').trim();
const pctx = vm.createContext({ normalizeText, captionCommitted: [] });
for (const name of ['captionWordsOf', 'captionTokenNear', 'captionCommittedEnd', 'captionDelta', 'isCaptionContinuation'])
  vm.runInContext(`${extract(pin, name)}; this.${name} = ${name};`, pctx);
const committedRow = sentences.join(' ');
vm.runInContext(`captionCommitted = captionWordsOf(${JSON.stringify(committedRow)}).norm;`, pctx);
assert.equal(pctx.captionDelta(committedRow.replace('rag pipeline', 'drag and pipeline')), '', 'PIN: mid-row revision is not replayed');
assert.equal(pctx.captionDelta(committedRow.replace('rag pipeline', 'drag and pipeline') + ' And thanks'), 'And thanks');
assert.equal(pctx.isCaptionContinuation(committedRow, committedRow.replace('rag pipeline', 'drag and pipeline'), '', ''), true);
assert.equal(pctx.isCaptionContinuation(committedRow, 'Completely unrelated new sentence arrives', '', ''), false);
assert.equal(pctx.captionDelta('Completely unrelated new sentence arrives'), 'Completely unrelated new sentence arrives');

console.log(JSON.stringify({ ok: true, printedWordsNeverRemoved: true, printedWordsNeverRewritten: true,
  finalAppendsOnly: true, orphanInterimKept: true, techCorrectionsStillApplied: true,
  midRowRevisionNoReprint: true, hostAndPinCollectors: true }));
