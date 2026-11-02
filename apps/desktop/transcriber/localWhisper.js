'use strict';
// JS-only offline-capable Whisper worker. Uses the existing 16kHz PCM16LE Meet stream.
// Native Meet captions and the existing relay remain authoritative in main.js.
const { Worker } = require('node:worker_threads');
const path = require('node:path');
let worker = null;
let ready = false;
let onStatusFn = () => {};
function startLocalWhisper({onTranscript = () => {}, onStatus = () => {}} = {}) {
  if (worker) return true;
  if (process.env.ZAPPER_LOCAL_ASR === '0') return false; // enabled by default for every Zapper participant
  onStatusFn = onStatus;
  ready = false;
  const instance = new Worker(path.join(__dirname, 'whisperJsWorker.js'), {
    env: { ...process.env },
  });
  worker = instance;
  instance.on('message', msg => {
    if (msg.type === 'status') { ready = msg.ready === true; onStatus(msg.text); }
    if (msg.type === 'transcript' && msg.text) onTranscript(msg);
  });
  instance.on('error', error => { ready = false; onStatus('Local JS ASR error: ' + error.message); });
  instance.on('exit', code => { if (worker === instance) worker = null; ready = false; if (code) onStatus('Local JS ASR exited (' + code + ')'); });
  return true;
}
function pushLocalAudio(buffer) {
  if (!worker || !ready || !buffer || !buffer.length) return;
  // Drop old chunks inside worker when inference cannot keep up.
  worker.postMessage({ type: 'audio', pcm: Uint8Array.from(buffer) });
}
function stopLocalWhisper() {
  const old = worker; worker = null; ready = false;
  if (old) old.terminate();
}
module.exports = { startLocalWhisper, pushLocalAudio, stopLocalWhisper };
