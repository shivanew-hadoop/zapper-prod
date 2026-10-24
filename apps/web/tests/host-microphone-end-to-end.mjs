// Browser-level fake audio/network regression: capture -> host token -> /stt ->
// fallback captions, without creating a real microphone permission prompt.
import assert from 'node:assert/strict';
import { startHostMicrophone } from '../src/host-microphone.js';
const sockets = [];
class Socket {
  static OPEN = 1;
  constructor(url) { this.url = url; this.readyState = 1; this.bufferedAmount = 0; this.sent = []; sockets.push(this); }
  send(chunk) { this.sent.push(chunk); }
  close() { this.readyState = 3; }
  serverMessage(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
}
class Node {
  constructor() { this.port = {}; }
  connect(other) { return other; }
  disconnect() {}
}
class Context {
  state = 'running';
  destination = {};
  audioWorklet = { addModule: async () => {} };
  createMediaStreamSource() { return new Node(); }
  createGain() { const node = new Node(); node.gain = { value: 1 }; return node; }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}
class Speech {
  constructor() { Speech.instance = this; }
  start() { this.onstart?.(); }
  abort() { this.aborted = true; }
}
const track = { enabled: true, stop() { this.stopped = true; } };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } } });
globalThis.window = { AudioContext: Context, AudioWorkletNode: Node, WebSocket: Socket, webkitSpeechRecognition: Speech };
globalThis.webkitSpeechRecognition = Speech;
globalThis.WebSocket = Socket;
globalThis.AudioContext = Context;
globalThis.AudioWorkletNode = Node;
const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
URL.createObjectURL = () => 'blob:test'; URL.revokeObjectURL = () => {};
try {
  const statuses = [], captions = [];
  const capture = await startHostMicrophone({ apiBase: 'https://api.zapperapp.in', sessionId: 'room-123',
    fetchCaptureToken: async () => 'signed-token', onStatus: x => statuses.push(x), onTranscript: x => captions.push(x), onStopped: () => {} });
  const socket = sockets[0];
  assert.equal(socket.url, 'wss://api.zapperapp.in/stt?token=signed-token');
  socket.onopen();
  socket.serverMessage({ type: 'host_stt_unavailable', message: 'Deepgram not configured' });
  assert.ok(Speech.instance, 'browser recognizer starts on missing Deepgram credentials');
  const speech = Speech.instance;
  speech.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'Mic reaches overlay' } }] });
  const forwarded = socket.sent.filter(x => typeof x === 'string').map(x => JSON.parse(x));
  assert.deepEqual(forwarded.map(x => [x.type, x.text, x.isFinal]), [['local_caption', 'Mic reaches overlay', true]]);
  assert.equal(captions.at(-1).source, 'browser-speech');
  socket.serverMessage({ type: 'caption_delivery', viewerCount: 1 });
  assert.match(statuses.at(-1), /1 connected PIN desktop socket/);
  capture.stop();
  assert.equal(track.stopped, true);
  assert.equal(speech.aborted, true);
  console.log('Host microphone capture: authenticated socket, automatic browser fallback, caption delivery, cleanup passed');
} finally {
  URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;
}
