'use strict';
// Test-only native-module stand-in; NEVER bundled into installer.
class OnlineRecognizer {
  constructor(config) {
    if (config?.featConfig?.sampleRate !== 16000 || !config?.enableEndpoint)
      throw new Error('Invalid streaming configuration');
  }
  createStream() {
    return { frames: [], text: '', endpoint: false, acceptWaveform({samples, sampleRate}) {
      if (!(samples instanceof Float32Array) || sampleRate !== 16000) throw new Error('expected 16-kHz float32');
      this.frames.push(samples);
    }, inputFinished() { this.endpoint = true; } };
  }
  isReady(s) { return s.frames.length > 0; }
  decode(s) {
    const data = s.frames.shift();
    if (data.some(x => Math.abs(x) > 0.1)) s.text = 'we use land chain and land graph';
    else if (s.text) s.endpoint = true;
  }
  getResult(s) { return { text: s.text }; }
  isEndpoint(s) { return s.endpoint; }
  reset(s) { s.text = ''; s.endpoint = false; }
}
module.exports = { OnlineRecognizer };
