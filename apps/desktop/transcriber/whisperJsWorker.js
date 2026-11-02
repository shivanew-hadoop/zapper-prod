'use strict';
const { parentPort } = require('node:worker_threads');
const SAMPLE_RATE = 16000;
const WINDOW_MS = Math.max(600, Number(process.env.ZAPPER_ASR_WINDOW_MS || 1200));
const TARGET_SAMPLES = Math.round(SAMPLE_RATE * WINDOW_MS / 1000);
const MODEL = process.env.ZAPPER_ASR_MODEL || 'Xenova/whisper-base.en';
const path = require('node:path');
const fs = require('node:fs');
const packagedModelDir = path.join(process.resourcesPath || '', 'asr-models');
const hasPackagedModel = fs.existsSync(path.join(packagedModelDir, 'Xenova', 'whisper-base.en', 'config.json'));
const terms = require('./technologyVocabulary.json').terms.map(x => x.term).join(', ');
const { correctTechnologyTerms } = require('./technologyCorrections');
let transcribe = null;
let pending = [];
let pendingSamples = 0;
let busy = false;
let running = true;
const emit = msg => parentPort.postMessage(msg);
async function initialize() {
  try {
    const { pipeline, env } = await import('@huggingface/transformers');
    // First run downloads model files; subsequent runs reuse the cache offline.
    if (hasPackagedModel) { env.localModelPath = packagedModelDir + path.sep; env.allowLocalModels = true; }
    env.allowRemoteModels = !hasPackagedModel && process.env.ZAPPER_ASR_OFFLINE !== '1';
    transcribe = await pipeline('automatic-speech-recognition', MODEL, { device: 'cpu', dtype: 'q8' });
    emit({type:'status', ready:true, text:`JS Whisper ready (${MODEL})`});
  } catch (err) {
    emit({type:'status', ready:false, text:`JS Whisper unavailable: ${err.message}`});
  }
}
async function drain() {
  if (busy || !transcribe || !running || pendingSamples < TARGET_SAMPLES) return;
  busy = true;
  const audio = new Float32Array(TARGET_SAMPLES);
  let offset = 0;
  while (offset < TARGET_SAMPLES && pending.length) {
    const head = pending[0];
    const count = Math.min(head.length, TARGET_SAMPLES - offset);
    audio.set(head.subarray(0, count), offset);
    offset += count;
    pendingSamples -= count;
    if (count === head.length) pending.shift();
    else pending[0] = head.subarray(count);
  }
  // Drop stale backlog if model is slower than real time.
  if (pendingSamples > SAMPLE_RATE * 2) { pending = []; pendingSamples = 0; }
  try {
    const result = await transcribe(audio, {
      language: 'english', task: 'transcribe',
      // Whisper prompt support varies by model/backend; deterministic correction below is authoritative.
    });
    const text = correctTechnologyTerms(String(result?.text || '').trim());
    if (text) emit({type:'transcript', source:'local-whisper-js', text, isFinal:true});
  } catch (err) { emit({type:'status', text:`JS Whisper inference failed: ${err.message}`}); }
  finally { busy = false; setImmediate(drain); }
}
parentPort.on('message', message => {
  if (message.type !== 'audio' || !transcribe) return;
  const pcm = message.pcm;
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const samples = new Float32Array(Math.floor(pcm.byteLength / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
  pending.push(samples);
  pendingSamples += samples.length;
  if (pendingSamples > SAMPLE_RATE * 4) { pending = pending.slice(-10); pendingSamples = pending.reduce((n, x) => n + x.length, 0); }
  void drain();
});
void initialize();
