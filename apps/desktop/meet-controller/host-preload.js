// Host-only Meet preload. Reuses the verified native caption/chat observer and
// enforces the device chosen in the Zapper portal on the actual Meet mic track.
const { ipcRenderer } = require('electron');
let chosen = '';
try { chosen = decodeURIComponent((process.argv.find(a => a.startsWith('--zapper-host-mic=')) || '').slice('--zapper-host-mic='.length)); } catch (_) {}
const clean = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const connections = new Set();
let chosenTrack = null;
const media = navigator.mediaDevices;
if (media?.getUserMedia) {
  const nativeGetUserMedia = media.getUserMedia.bind(media);
  async function matchDevice() {
    if (!chosen) return '';
    const devices = await media.enumerateDevices();
    const label = clean(chosen);
    const found = devices.find(d => d.kind === 'audioinput' && clean(d.label) === label)
      || devices.find(d => d.kind === 'audioinput' && clean(d.label).includes(label));
    return found?.deviceId || '';
  }
  const patchedGetUserMedia = async function(constraints) {
    if (!chosen || !constraints?.audio) return nativeGetUserMedia(constraints);
    let deviceId = await matchDevice();
    // Device labels are hidden before first permission on some Chromium builds.
    // Grant microphone access on the default device once, then re-enumerate.
    if (!deviceId) {
      const permission = await nativeGetUserMedia({ audio: true, video: false });
      permission.getTracks().forEach(t => t.stop());
      deviceId = await matchDevice();
    }
    if (!deviceId) {
      ipcRenderer.send('host-mic-result', { success: false, label: chosen, error: 'Device not found; using default microphone' });
      return nativeGetUserMedia(constraints);
    }
    const audio = constraints.audio === true ? {} : { ...constraints.audio };
    audio.deviceId = { exact: deviceId };
    try {
      const stream = await nativeGetUserMedia({ ...constraints, audio });
      ipcRenderer.send('host-mic-result', { success: true, label: chosen });
      return stream;
    } catch (error) {
      // A failed exact device constraint must not prevent the meeting from starting.
      if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') {
        ipcRenderer.send('host-mic-result', { success: false, label: chosen, error: 'Selected device unavailable; using default microphone' });
        return nativeGetUserMedia(constraints);
      }
      throw error;
    }
  };
  try { media.getUserMedia = patchedGetUserMedia; } catch (_) {}
  async function applyMicrophone(label) {
    chosen = String(label || '').trim().slice(0, 250);
    try {
      const stream = await patchedGetUserMedia({ audio: true, video: false });
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('No microphone track returned');
      const senders = [...connections].flatMap(pc => {
        try { return pc.getSenders().filter(s => s.track?.kind === 'audio'); } catch (_) { return []; }
      });
      if (senders.length) {
        await Promise.all(senders.map(sender => sender.replaceTrack(track)));
        chosenTrack?.stop();
        chosenTrack = track;
      } else {
        track.stop(); // Meet will pick selected device at next getUserMedia
      }
      ipcRenderer.send('host-mic-result', { success: true, label: chosen || 'system default' });
    } catch (error) {
      ipcRenderer.send('host-mic-result', { success: false, label: chosen, error: error.message });
    }
  }
  ipcRenderer.on('host-mic-device', (_, label) => { void applyMicrophone(label); });
  const OrigRTC = window.RTCPeerConnection;
  if (OrigRTC) {
    function TrackableRTC(...args) {
      const pc = new OrigRTC(...args);
      connections.add(pc);
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'closed') connections.delete(pc);
      });
      return pc;
    }
    TrackableRTC.prototype = OrigRTC.prototype;
    for (const key of Object.getOwnPropertyNames(OrigRTC)) {
      try { TrackableRTC[key] = OrigRTC[key]; } catch (_) {}
    }
    window.RTCPeerConnection = TrackableRTC;
  }
}
// Use the existing participant's Meet captions/chat parser unchanged.
require('./meet-preload');
