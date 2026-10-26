// Offline fake-browser test: host preload must force the selected microphone
// into Meet's getUserMedia constraints and replace an existing outgoing track.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const listeners = new Map();
const events = [];
const requested = [];
const replaced = [];
class OriginalRTC {
  addEventListener() {}
  getSenders() { return [{ track: { kind: 'audio' }, replaceTrack: async track => replaced.push(track.id) }]; }
}
const media = {
  enumerateDevices: async () => [
    { deviceId: 'id-one', kind: 'audioinput', label: 'USB Microphone One' },
    { deviceId: 'id-two', kind: 'audioinput', label: 'USB Microphone Two' },
  ],
  getUserMedia: async constraints => {
    requested.push(constraints);
    const id = constraints?.audio?.deviceId?.exact || 'default';
    return { getAudioTracks: () => [{ id, kind: 'audio', stop() {} }], getTracks: () => [{ stop() {} }] };
  },
};
const source = fs.readFileSync(path.join(__dirname, '../meet-controller/host-preload.js'), 'utf8');
const context = {
  process: { argv: ['--zapper-host-mode', '--zapper-host-mic=USB%20Microphone%20One'] },
  navigator: { mediaDevices: media },
  window: { RTCPeerConnection: OriginalRTC },
  require: name => name === 'electron'
    ? { ipcRenderer: { on: (event, cb) => listeners.set(event, cb), send: (name, payload) => events.push({ name, payload }) } }
    : name === './meet-preload' ? null : (() => { throw new Error('Unknown module: ' + name); })(),
  decodeURIComponent,
  DOMException,
};
(async () => {
  vm.runInNewContext(source, context, { filename: 'host-preload.js' });
  const stream = await media.getUserMedia({ audio: { echoCancellation: true }, video: false });
  assert.equal(stream.getAudioTracks()[0].id, 'id-one');
  assert.equal(requested.at(-1).audio.deviceId.exact, 'id-one');
  assert.equal(requested.at(-1).audio.echoCancellation, true);
  new context.window.RTCPeerConnection();
  assert.ok(listeners.has('host-mic-device'));
  listeners.get('host-mic-device')(null, 'USB Microphone Two');
  await new Promise(r => setImmediate(r));
  assert.ok(replaced.includes('id-two'), 'live WebRTC microphone track should be switched');
  listeners.get('host-mic-device')(null, '');
  await new Promise(r => setImmediate(r));
  assert.ok(replaced.includes('default'), 'default selection should switch live track too');
  assert.ok(events.some(e => e.name === 'host-mic-result' && e.payload.success));
  console.log(JSON.stringify({ ok: true, initialMicrophoneSelected: true, liveTrackSwitched: true, defaultRestored: true }));
})().catch(err => { console.error(err); process.exitCode = 1; });
