'use strict';
// Per-desktop recognition controller. NEVER opens an external socket. PCM stays
// between the localhost Meet audio tap, Electron main and a worker thread.
const { Worker } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const { correctTechnologyTerms } = require('./technologyCorrections');
const { createFinalLedger } = require('./localFinalLedger');

const MODEL_NAME = 'sherpa-onnx-streaming-zipformer-en-2023-06-21';
const MODEL_FILES = Object.freeze({
  encoder: 'encoder-epoch-99-avg-1.int8.onnx',
  decoder: 'decoder-epoch-99-avg-1.onnx',
  joiner: 'joiner-epoch-99-avg-1.int8.onnx',
  tokens: 'tokens.txt',
});
function locateModel() {
  // Environment override is for offline developer setups. No runtime download.
  const configured = process.env.ZAPPER_LOCAL_STT_MODEL_DIR;
  const base = configured ? path.resolve(configured) : process.resourcesPath && process.resourcesPath !== __dirname
    ? path.join(process.resourcesPath, 'models', MODEL_NAME)
    : path.join(__dirname, '..', 'models', MODEL_NAME);
  // In Electron dev, process.resourcesPath points to Electron's runtime,
  // not this project. Probe the checked-in build-staging path as well.
  const fallback = path.join(__dirname, '..', 'models', MODEL_NAME);
  const dir = !configured && !fs.existsSync(base) && fs.existsSync(fallback) ? fallback : base;
  for (const [key, name] of Object.entries(MODEL_FILES)) {
    if (!fs.existsSync(path.join(dir, name))) {
      throw new Error(`Local speech model missing: ${name}. Provision ${MODEL_NAME} using scripts/install-local-stt-model.ps1 before building.`);
    }
  }
  return { dir, files: MODEL_FILES };
}

class LocalZipformer {
  constructor({ onFinal = () => {}, onStatus = () => {}, onError = () => {},
    model = locateModel, workerFactory = options => new Worker(path.join(__dirname, 'localZipformerWorker.js'), options) } = {}) {
    this.onFinal = onFinal;
    this.onStatus = onStatus;
    this.onError = onError;
    this.model = model;
    this.workerFactory = workerFactory;
    this.worker = null;
    this.ready = false;
    this.generation = 0;
    this.buffers = [];
    this.bufferedBytes = 0;
    this.flushTimer = null;
    this.ledger = createFinalLedger(correctTechnologyTerms);
    this.flushResolve = null;
    this.inFlight = false;
    this.lastOverflowNoticeAt = 0;
  }
  start() {
    this.stop();
    const { dir, files } = this.model();
    const gen = this.generation;
    const worker = this.workerFactory({ workerData: { dir, files } });
    this.worker = worker;
    this.ready = false;
    worker.on('message', msg => {
      if (gen !== this.generation || this.worker !== worker) return;
      if (msg.type === 'ready') {
        this.ready = true;
        this.onStatus('Local Streaming Zipformer ready. Audio never leaves this computer.');
        this.drain();
      } else if (msg.type === 'consumed') {
        this.inFlight = false;
        this.drain();
      } else if (msg.type === 'flushed') {
        if (this.flushResolve) this.flushResolve();
      } else if (msg.type === 'final') {
        const final = this.ledger.append(msg.text);
        if (final) this.onFinal({ text: final, isFinal: true, source: 'local-zipformer' });
      } else if (msg.type === 'error') { this.onError(msg.message); this.stop(); }
    });
    worker.on('error', err => { if (gen === this.generation) this.onError(err.message); });
    worker.on('exit', code => {
      if (gen !== this.generation || this.worker !== worker) return;
      this.worker = null;
      this.ready = false;
      if (code) this.onError(`Local recognition worker exited (${code}).`);
    });
    this.flushTimer = setInterval(() => this.drain(), 75);
    this.flushTimer.unref?.();
    return true;
  }
  push(buffer) {
    if (!this.worker || !buffer || buffer.length < 2) return;
    // 16 kHz, mono, signed little-endian PCM16; only bounded local memory.
    if (buffer.length % 2) return;
    this.buffers.push(Buffer.from(buffer));
    this.bufferedBytes += buffer.length;
    // 4s ring while the native model initializes or an overloaded PC stalls.
    // Report overflow visibly; never pretend dropped audio was transcribed.
    while (this.bufferedBytes > 4 * 16000 * 2) {
      this.bufferedBytes -= this.buffers.shift().length;
      if (Date.now() - this.lastOverflowNoticeAt > 5000) {
        this.lastOverflowNoticeAt = Date.now();
        this.onStatus('Local transcription is falling behind; some audio was dropped.');
      }
    }
    if (this.ready && this.bufferedBytes >= 3200) this.drain();
  }
  drain() {
    if (!this.ready || !this.worker || this.inFlight || !this.buffers.length) return;
    const pcm = Buffer.concat(this.buffers, this.bufferedBytes);
    this.buffers = [];
    this.bufferedBytes = 0;
    // Int16Array copy is transferable, never shared with a remote endpoint.
    const ab = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
    this.inFlight = true;
    this.worker.postMessage({ type: 'audio', pcm: ab }, [ab]);
  }
  async finish(timeoutMs = 700) {
    if (!this.worker || !this.ready) return;
    // Wait until every accepted audio frame is decoded before finalizing.
    const until = Date.now() + timeoutMs;
    while ((this.inFlight || this.buffers.length) && Date.now() < until) {
      this.drain();
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    const worker = this.worker;
    await Promise.race([
      new Promise(resolve => { this.flushResolve = resolve; worker.postMessage({ type: 'flush' }); }),
      new Promise(resolve => setTimeout(resolve, timeoutMs))
    ]);
    this.flushResolve = null;
  }
  stop() {
    this.generation++;
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    const worker = this.worker;
    this.worker = null;
    this.ready = false;
    this.buffers = [];
    this.bufferedBytes = 0;
    this.inFlight = false;
    if (this.flushResolve) this.flushResolve();
    this.flushResolve = null;
    this.ledger.reset();
    if (worker) {
      try { worker.postMessage({ type: 'flush' }); } catch (_) {}
      // Teardown is intentionally nonblocking; a stopped worker cannot emit
      // stale captions into a newly joined session.
      setTimeout(() => { worker.terminate().catch(() => {}); }, 350).unref?.();
    }
  }
}
module.exports = { LocalZipformer, locateModel, MODEL_NAME, MODEL_FILES };
