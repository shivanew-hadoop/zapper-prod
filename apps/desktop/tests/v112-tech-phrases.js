'use strict';
// Regression gate for changes cherry-picked onto the uploaded v1.0.7 source.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { correctTechnologyTerms, compileVocabulary } = require('../transcriber/technologyCorrections');
const { terms } = require('../transcriber/technologyVocabulary.json');

assert.equal(terms.length, 84);
for (const [before, after] of [
  ['We deployed kuberneties on aws', 'We deployed Kubernetes on AWS'],
  ['We use terrafrom and postgressql', 'We use Terraform and PostgreSQL'],
  ['Using docker, cicd and devops', 'Using Docker, CI/CD and DevOps'],
  ['Apache spark consumes apache kafca events', 'Apache Spark consumes apache Kafka events'],
  ['We use react with typescript and nodejs', 'We use React with TypeScript and Node.js'],
  ['Our database sequel queries run on mongodb', 'Our database SQL queries run on MongoDB'],
  ['We have llm rag systems', 'We have LLM RAG systems'],
  ['I am using kubernet in the cluster', 'I am using Kubernetes in the cluster'],
  ['We use land chain with land graph', 'We use LangChain with LangGraph'],
  ['I use lang chain and lang graph', 'I use LangChain and LangGraph'],
  ['The landchain agents communicate with landgraph', 'The LangChain agents communicate with LangGraph'],
  ['We use land   chain and land\ngraph', 'We use LangChain and LangGraph'],
  ['I use lang-chain and lang-graph', 'I use LangChain and LangGraph'],
  ['We use kuber netes and cuber netes', 'We use Kubernetes and Kubernetes'],
  ['We like azur and gcp', 'We like azur and GCP'], // Azure needs earlier cloud context
  ['We deploy cloud azur with gcp', 'We deploy cloud Azure with GCP'],
]) {
  assert.equal(correctTechnologyTerms(before), after, before);
  assert.equal(correctTechnologyTerms(correctTechnologyTerms(before)), after, 'idempotence: ' + before);
}
for (const untouched of [
  'The spark made the fire grow',
  'The snowflake fell on the garden',
  'The sequel to the movie was great',
  'Please react to the message',
  'We need the helm of this ship',
  'I wanted to see the results',
  'Normal English (UK) is still enabled',
]) assert.equal(correctTechnologyTerms(untouched), untouched, 'false positive: ' + untouched);

// Incremental text must not retroactively alter an already corrected word.
for (const text of [
  'We deployed kuberneties on aws with terrafrom',
  'We use react with typescript and nodejs',
  'Apache spark consumes apache kafca events',
  'Our database sequel queries work on postgressql',
]) {
  const chunks = text.split(' ');
  let previous = '';
  for (let n = 1; n <= chunks.length; n++) {
    const corrected = correctTechnologyTerms(chunks.slice(0, n).join(' '));
    assert(!previous || corrected === previous || corrected.startsWith(previous + ' '), `${text} changed: ${previous} -> ${corrected}`);
    previous = corrected;
  }
}
assert.throws(() => compileVocabulary([{term:'X',variants:['hello     world']}]), /Unsafe/);
assert.throws(() => compileVocabulary([{term:'X',variants:['a b c d e']}]), /Unsafe/);
assert.equal(correctTechnologyTerms('land chain'), 'LangChain');
assert.equal(correctTechnologyTerms('land graph'), 'LangGraph');
assert.equal(correctTechnologyTerms('kubernet'), 'Kubernetes');
assert.equal(correctTechnologyTerms('weblinkchain'), 'weblinkchain');
assert.equal(correctTechnologyTerms('LangChain / LangGraph / Kubernetes'), 'LangChain / LangGraph / Kubernetes');
assert.throws(() => compileVocabulary([{term:'X',variants:['foo','foo']}]), /Duplicate/);

const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
const overlay = fs.readFileSync(path.join(__dirname, '../overlay/overlay.js'), 'utf8');
const hostCollector = fs.readFileSync(path.join(__dirname, '../meet-controller/host-caption-preload.js'), 'utf8');
const pinCollector = fs.readFileSync(path.join(__dirname, '../meet-controller/meet-preload.js'), 'utf8');
assert.equal(pkg.version, '1.0.16');
assert(pkg.build.files.includes('transcriber/**/*'), 'dictionary must be bundled in installer');
assert(main.includes("require('./transcriber/technologyCorrections')"));
assert(main.includes('const DEEPGRAM_FALLBACK_ENABLED = false'));
assert(main.includes('publishHostCaption({ ...payload, text })'), 'host relay receives corrected captions');
assert(main.includes('text: correctTechnologyTerms(String(payload.text || \'\'))'), 'PIN relays correct incoming captions');
assert(main.includes('const text = correctTechnologyTerms(String(payload.text || \'\').trim())'), 'PIN-local caption corrections');
assert(hostCollector.includes('UK_LANGUAGE') && pinCollector.includes('UK_LANGUAGE'), 'English (UK) selectors preserved');
assert(!overlay.includes('MAX_LINES = 100'), 'remove line count restriction');
assert(!overlay.includes('trimTranscriptHistoryIfFollowing'), 'remove history trimming, not just increase threshold');

// Exercise the real append-only overlay with 155 finalized captions.
// The original 100-line cap must not erase any visible text.
const start = overlay.indexOf('// Displayed captions are append-only');
const end = overlay.indexOf('\nfunction showJoinError(', start);
assert(start > -1 && end > start);
const transcriptEl = {
  children: [], scrollHeight: 320, clientHeight: 80, scrollTop: 0,
  clearCount: 0,
  set textContent(value) { assert.equal(value, ''); this.clearCount++; this.children = []; },
  append(...items) { this.children.push(...items); },
  contains(item) { return this.children.includes(item); },
};
const state = {
  transcriptEl, document: { createTextNode(nodeValue) { return { nodeValue }; } },
  Date, transcriptAutoScroll: true,
  transcriptUserScrollIntent: false, transcriptScrollTopLock: 0, Math,
};
vm.createContext(state);
vm.runInContext(overlay.slice(start, end), state);
let firstFinalNode;
for (let count = 1; count <= 155; count++) {
  state.renderTranscript({ text: `Final line number ${count}`, isFinal: true, origin: 'host-meet' });
  if (count === 1) firstFinalNode = transcriptEl.children[1];
  assert(transcriptEl.contains(firstFinalNode), 'first line survives ' + count);
  assert.equal(transcriptEl.clearCount, 1, 'only initial construction can clear for line ' + count);
}
assert.equal(transcriptEl.children.length, 156);
assert.equal(firstFinalNode.nodeValue, 'Final line number 1');

// No deliberate timer / network request / buffering stage, and measure only
// synchronous correction cost, not Google Meet -> overlay transport latency.
const sample = 'We deployed kuberneties on AWS with terrafrom, postgressql, graphql and llm rag.';
const count = 25000;
const t0 = performance.now();
for (let i = 0; i < count; i++) correctTechnologyTerms(sample);
const avgMs = (performance.now() - t0) / count;
assert(avgMs < 0.75, `unexpected processing overhead: ${avgMs}ms`);
console.log(JSON.stringify({ ok: true, base: '1.0.7', version: '1.0.16', terms: terms.length,
  retainedLines: 155, noHistoryRedraw: true, ukPreserved: true, deepgramOff: true,
  averageCorrectionMs: +avgMs.toFixed(4) }));
