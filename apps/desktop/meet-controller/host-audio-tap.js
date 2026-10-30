'use strict';
// Executes at document-start in the host Meet page's MAIN world.
// Captures the host's EXISTING getUserMedia mic track and incoming WebRTC audio
// tracks without disabling, replacing, muting or renegotiating any Meet track.
// No raw PCM leaves localhost. This is a capture-only observer.
function installHostAudioTap() {
  if (!/^https:\/\/meet\.google\.com\//.test(location.href)) return;
  if (window.__zapperHostAudioInstalled) return;
  window.__zapperHostAudioInstalled = true;
  const PORT = 'ws://127.0.0.1:9999/host-audio';
  let socket = null, context = null, bus = null, processor = null, silentSink = null;
  let inputCarry = new Float32Array(0);
  const seen = new WeakSet();
  const pcs = new Set();
  let connected = false;

  function connect() {
    try {
      socket = new WebSocket(PORT);
      socket.binaryType = 'arraybuffer';
      socket.addEventListener('open', () => { connected = true; });
      socket.addEventListener('close', () => { connected = false; setTimeout(connect, 900); });
      socket.addEventListener('error', () => { connected = false; });
    } catch (_) { setTimeout(connect, 1200); }
  }
  connect();

  function inCall() { return !!document.querySelector('[aria-label*="Leave call" i]'); }
  function encode(input, rate) {
    const merged = new Float32Array(inputCarry.length + input.length);
    merged.set(inputCarry); merged.set(input, inputCarry.length);
    const ratio = rate / 16000;
    const n = Math.floor(merged.length / ratio);
    if (!n) { inputCarry = merged; return null; }
    const data = new Int16Array(n);
    for (let i = 0; i < n; ++i) {
      const index = i * ratio, a = Math.floor(index), b = Math.min(a + 1, merged.length - 1);
      const s = Math.max(-1, Math.min(1, merged[a] + (merged[b] - merged[a]) * (index - a)));
      data[i] = s < 0 ? s * 32768 : s * 32767;
    }
    inputCarry = merged.slice(Math.floor(n * ratio));
    return data.buffer;
  }
  function ensureMixer() {
    if (context) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    context = new Audio();
    bus = context.createGain();
    processor = context.createScriptProcessor(1024, 1, 1);
    silentSink = context.createGain();
    silentSink.gain.value = 0;
    processor.onaudioprocess = ev => {
      // Do not capture prejoin UI mic checks or transcript muted calls.
      if (!inCall() || !connected || socket?.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > 256 * 1024) return;
      const data = encode(ev.inputBuffer.getChannelData(0), context.sampleRate);
      if (data) socket.send(data);
    };
    bus.connect(processor);
    processor.connect(silentSink);
    silentSink.connect(context.destination);
    context.resume().catch(() => {});
    document.addEventListener('click', () => context.resume().catch(() => {}));
  }
  function addTrack(track) {
    if (!track || track.kind !== 'audio' || seen.has(track)) return;
    seen.add(track);
    try {
      ensureMixer();
      if (!context) return;
      const source = context.createMediaStreamSource(new MediaStream([track]));
      source.connect(bus);
      track.addEventListener('ended', () => { try { source.disconnect(); } catch (_) {} }, { once: true });
    } catch (error) { console.warn('[ZapperHostAudio] Capture track unavailable:', error.message); }
  }
  const md = navigator.mediaDevices;
  if (md?.getUserMedia) {
    const original = md.getUserMedia.bind(md);
    md.getUserMedia = async (...args) => {
      const stream = await original(...args);
      // The original Meet stream is returned UNMODIFIED. Avoid secondary mic
      // permissions and don't affect Meet's own mute / camera state.
      if (args[0]?.audio) for (const track of stream.getAudioTracks()) addTrack(track);
      return stream;
    };
  }
  const RTC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (!RTC) return;
  const scan = () => {
    for (const pc of pcs) {
      try { for (const receiver of pc.getReceivers()) addTrack(receiver.track); } catch (_) {}
    }
  };
  function WrappedRTC(...args) {
    const pc = new RTC(...args);
    pcs.add(pc);
    pc.addEventListener('track', e => addTrack(e.track));
    const origSetRemoteDescription = pc.setRemoteDescription?.bind(pc);
    if (origSetRemoteDescription) pc.setRemoteDescription = async (...params) => {
      const res = await origSetRemoteDescription(...params);
      setTimeout(scan, 50); setTimeout(scan, 500);
      return res;
    };
    pc.addEventListener('connectionstatechange', () => {
      if (['closed', 'failed'].includes(pc.connectionState)) pcs.delete(pc);
    });
    return pc;
  }
  WrappedRTC.prototype = RTC.prototype;
  for (const key of Object.getOwnPropertyNames(RTC)) {
    try { WrappedRTC[key] = RTC[key]; } catch (_) {}
  }
  window.RTCPeerConnection = WrappedRTC;
  if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = WrappedRTC;
  setInterval(scan, 800);
}
module.exports = { installHostAudioTap };
