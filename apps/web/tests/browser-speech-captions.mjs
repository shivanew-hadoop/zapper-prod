import assert from 'node:assert/strict';
import { createBrowserSpeechCaptions } from '../src/browser-speech-captions.js';
class Recognition {
  constructor() { Recognition.instances.push(this); }
  static instances = [];
  start() { this.onstart?.(); }
  abort() { this.aborted = true; }
}
const sent = [], status = [], errors = [], preview = [];
const captioner = createBrowserSpeechCaptions({ Recognition, sendCaption: x => sent.push(x), onStatus: x => status.push(x), onError: x => errors.push(x), onCaption: x => preview.push(x) });
assert.ok(captioner);
captioner.start();
assert.equal(Recognition.instances.length, 1);
const current = Recognition.instances[0];
assert.equal(current.interimResults, true);
assert.equal(current.continuous, true);
const interim = [{ isFinal: false, 0: { transcript: 'hello' } }];
current.onresult({ resultIndex: 0, results: interim });
current.onresult({ resultIndex: 0, results: interim });
assert.equal(sent.length, 1, 'identical interim must not be duplicated');
current.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'hello' } }] });
assert.equal(sent.length, 2);
assert.equal(sent[1].isFinal, true);
assert.equal(sent[1].type, 'local_caption');
assert.equal(preview.length, 2);
captioner.stop();
assert.ok(current.aborted);
assert.equal(captioner.active, false);
assert.equal(errors.length, 0);
assert.equal(createBrowserSpeechCaptions({ Recognition: null, sendCaption: () => {} }), null);
console.log('Browser speech fallback: interim/final, dedupe and stop passed');
