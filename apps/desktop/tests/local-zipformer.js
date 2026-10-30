'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const EventEmitter = require('node:events');
const { createFinalLedger } = require('../transcriber/localFinalLedger');
const { LocalZipformer } = require('../transcriber/localZipformer');
const { correctTechnologyTerms } = require('../transcriber/technologyCorrections');

const ledger = createFinalLedger(correctTechnologyTerms);
assert.equal(ledger.append('We use land chain and land graph.'), 'We use LangChain and LangGraph.');
assert.equal(ledger.append('We use land chain and land graph.'), '', 'duplicate final never reappears');
assert.equal(ledger.append('And we deploy on kuber net is.'), 'And we deploy on Kubernetes.');

class FakeWorker extends EventEmitter {
  constructor() { super(); this.sent = []; }
  postMessage(msg) { this.sent.push(msg); if (msg.type === 'flush') this.emit('message', { type: 'flushed' }); }
  terminate() { return Promise.resolve(0); }
}
(async () => {
  const finals = [], statuses = [];
  let worker;
  const recognizer = new LocalZipformer({
    model: () => ({ dir: 'mock-model', files: {} }),
    workerFactory: () => (worker = new FakeWorker()),
    onFinal: msg => finals.push(msg), onStatus: msg => statuses.push(msg)
  });
  recognizer.start();
  assert.equal(worker.sent.length, 0);
  recognizer.push(Buffer.alloc(3200));
  assert.equal(worker.sent.length, 0, 'initialization is asynchronous and PCM stays buffered');
  worker.emit('message', { type: 'ready' });
  assert.equal(worker.sent.length, 1);
  assert.equal(worker.sent[0].type, 'audio');
  assert.equal(worker.sent[0].pcm.byteLength, 3200);
  worker.emit('message', { type: 'consumed' });
  worker.emit('message', { type: 'final', text: 'we use land chain and land graph' });
  worker.emit('message', { type: 'final', text: 'we use land chain and land graph' });
  assert.deepEqual(finals, [{ text: 'we use LangChain and LangGraph', isFinal: true, source: 'local-zipformer' }]);
  assert(statuses.some(s => s.includes('Audio never leaves')));
  await recognizer.finish();
  assert.equal(worker.sent.at(-1).type, 'flush');
  recognizer.stop();
  worker.emit('message', { type: 'final', text: 'stale line after stop' });
  assert.equal(finals.length, 1, 'stale worker final must never leak into a new session');

  // Local-only architectural checks: no IPC raw audio to cloud or direct Deepgram.
  const root = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const tap = fs.readFileSync(path.join(root, 'meet-controller/host-audio-tap.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'audio-ws/server.js'), 'utf8');
  assert(!/sendAudioChunk\s*\(pcmBuffer\)/.test(main));
  assert(main.includes('onAudioChunk(pcm => participantLocalRecognizer?.push(pcm))'));
  assert(main.includes('onHostAudioChunk(pcm =>'));
  assert(tap.includes("ws://127.0.0.1:9999/host-audio"));
  assert(server.includes("host: '127.0.0.1'"));
  assert(main.includes("if (participantLocalRecognizer) return; // Remote text cannot overwrite"));
  assert(main.includes("if (participantLocalRecognizer) return; // Local PCM"));
  console.log(JSON.stringify({ok:true, standalonePerMachine:true, backendPCMDisabled:true,
    finalOnly:true, immutableFinals:true, techTerminology:true, workerIsolation:true, hostAndPinCapture:true }));
})().catch(e => { console.error(e); process.exitCode = 1; });
