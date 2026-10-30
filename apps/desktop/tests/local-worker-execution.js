'use strict';
const assert = require('node:assert/strict');
const { Worker } = require('node:worker_threads');
const path = require('node:path');
(async () => {
  const worker = new Worker(path.join(__dirname, '../transcriber/localZipformerWorker.js'), {
    workerData: {
      addonPath: require.resolve('./mock-sherpa-node'),
      dir: 'fake',
      files: { encoder: 'encoder.onnx', decoder: 'decoder.onnx', joiner: 'joiner.onnx', tokens: 'tokens.txt' }
    }
  });
  const events = [];
  let ready;
  const started = new Promise((resolve, reject) => {
    worker.on('message', msg => { events.push(msg); if (msg.type === 'ready') resolve(); if (msg.type === 'error') reject(new Error(msg.message)); });
    worker.on('error', reject);
  });
  await started;
  const speech = new Int16Array(1600).fill(20000);
  const silence = new Int16Array(1600);
  const send = samples => worker.postMessage({ type: 'audio', pcm: samples.buffer.slice(0) });
  send(speech); send(silence);
  const deadline = Date.now() + 2500;
  while (!events.some(e => e.type === 'final') && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(events.filter(x => x.type === 'final').length, 1);
  assert.equal(events.find(x => x.type === 'final').text, 'we use land chain and land graph');
  assert.equal(events.filter(x => x.type === 'consumed').length, 2);
  await worker.terminate();
  console.log(JSON.stringify({ ok: true, liveWorkerFrames: true, localEndpoint: true, workerFinalOnly: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
