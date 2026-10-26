// Regression guard: stale/absent mic labels must not prevent Google Meet capture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const requests = [];
const notifications = [];
const media = {
  enumerateDevices: async () => [{ deviceId: 'real-device', kind: 'audioinput', label: 'Laptop Microphone' }],
  getUserMedia: async constraints => {
    requests.push(constraints);
    if (constraints.audio?.deviceId?.exact === 'unplugged') {
      const err = Error('Unavailable'); err.name = 'NotFoundError'; throw err;
    }
    return { getAudioTracks: () => [{ id: 'default', kind: 'audio', stop() {} }], getTracks: () => [] };
  },
};
const source = fs.readFileSync(path.join(__dirname, '../meet-controller/host-preload.js'), 'utf8');
const context = {
  process: { argv: ['--zapper-host-mode', '--zapper-host-mic=Unplugged%20Microphone'] },
  navigator: { mediaDevices: media },
  window: {},
  decodeURIComponent,
  require: name => name === 'electron'
    ? { ipcRenderer: { on: () => {}, send: (event, payload) => notifications.push({ event, payload }) } }
    : name === './meet-preload' ? null : (() => { throw Error('Unexpected ' + name); })(),
};
(async () => {
  vm.runInNewContext(source, context);
  const stream = await media.getUserMedia({ audio: true, video: false });
  assert.equal(stream.getAudioTracks()[0].id, 'default');
  assert.ok(requests.length >= 2, 'probe plus fallback must occur');
  assert.ok(notifications.some(msg => msg.event === 'host-mic-result' && !msg.payload.success));
  console.log(JSON.stringify({ok: true, missingMicDoesNotBlockMeeting: true}));
})().catch(error => { console.error(error); process.exitCode = 1; });
