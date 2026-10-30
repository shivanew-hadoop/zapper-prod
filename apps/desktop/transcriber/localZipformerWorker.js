'use strict';
// One worker PER Zapper desktop process, decoding in native code off UI thread.
const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
let recognizer, stream;
let lastText = '';
let lastResultTime = Date.now();
let utteranceStarted = Date.now();
let lastSampleCount = 0;

function emitFinal() {
  const text = String(recognizer.getResult(stream)?.text || lastText || '').trim();
  if (text) parentPort.postMessage({ type: 'final', text });
  lastText = '';
  recognizer.reset(stream);
  utteranceStarted = Date.now();
  lastResultTime = utteranceStarted;
  lastSampleCount = 0;
}
function appendPcm(data) {
  if (!(data instanceof ArrayBuffer) || !data.byteLength || data.byteLength % 2) return;
  const input = new Int16Array(data);
  const samples = new Float32Array(input.length);
  for (let i = 0; i < input.length; ++i) samples[i] = input[i] / 32768;
  stream.acceptWaveform({ samples, sampleRate: 16000 });
  lastSampleCount += samples.length;
  let loops = 0;
  // Defend against broken models spinning isReady forever.
  while (recognizer.isReady(stream) && loops++ < 600) recognizer.decode(stream);
  const result = String(recognizer.getResult(stream)?.text || '').trim();
  if (result && result !== lastText) { lastText = result; lastResultTime = Date.now(); }
  if (recognizer.isEndpoint(stream)) emitFinal();
  // Continuous speech can lack a VAD endpoint for minutes. Split at a
  // bounded speech duration rather than suppressing captions indefinitely.
  else if (lastText && lastSampleCount >= 16_000 * 18) emitFinal();
}
function init() {
  try {
    // Production uses the installed native N-API addon. Test injection only
    // permits a fixed path supplied by the dedicated local worker unit test.
    const addon = workerData.addonPath ? require(workerData.addonPath) : require('sherpa-onnx-node');
    const file = key => path.join(workerData.dir, workerData.files[key]);
    recognizer = new addon.OnlineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: { encoder: file('encoder'), decoder: file('decoder'), joiner: file('joiner') },
        tokens: file('tokens'), numThreads: 2, provider: 'cpu', debug: false
      },
      decodingMethod: 'greedy_search', enableEndpoint: true,
      rule1MinTrailingSilence: 1.15,
      rule2MinTrailingSilence: 0.7,
      rule3MinUtteranceLength: 18
    });
    stream = recognizer.createStream();
    parentPort.postMessage({ type: 'ready' });
  } catch (e) { parentPort.postMessage({ type: 'error', message: `Local Zipformer initialization failed: ${e.message}` }); }
}
parentPort.on('message', msg => {
  if (!recognizer || !stream) return;
  try {
    if (msg.type === 'audio') {
      appendPcm(msg.pcm);
      parentPort.postMessage({ type: 'consumed' });
    }
    if (msg.type === 'flush') {
      stream.inputFinished?.();
      let i = 0;
      while (recognizer.isReady(stream) && i++ < 600) recognizer.decode(stream);
      if (lastText || String(recognizer.getResult(stream)?.text || '').trim()) emitFinal();
      parentPort.postMessage({ type: 'flushed' });
    }
  } catch (e) { parentPort.postMessage({ type: 'error', message: `Local recognition failed: ${e.message}` }); }
});
init();
