// Host-only microphone capture for the web portal. Audio is sent to the
// EXISTING /stt backend and Deepgram path; no Google Meet tab is required for
// the host's *own* voice. This does not capture remote Google Meet attendees.
// Browser microphone permission and an open browser tab are still required.
const processorSource = `
class ZapperHostMic extends AudioWorkletProcessor {
  constructor() {
    super();
    this.position = 0;
    this.step = sampleRate / 16000;
    this.pcm = new Int16Array(1600); // 100 ms of 16kHz mono PCM
    this.count = 0;
  }
  process(inputs) {
    const samples = inputs[0] && inputs[0][0];
    if (!samples) return true;
    while (this.position < samples.length) {
      const at = Math.floor(this.position);
      const fraction = this.position - at;
      const value = (samples[at] || 0) * (1 - fraction) + (samples[Math.min(at + 1, samples.length - 1)] || 0) * fraction;
      this.pcm[this.count++] = Math.max(-32768, Math.min(32767, Math.round(Math.max(-1, Math.min(1, value)) * 32767)));
      if (this.count >= this.pcm.length) {
        this.port.postMessage(this.pcm.buffer, [this.pcm.buffer]);
        this.pcm = new Int16Array(1600);
        this.count = 0;
      }
      this.position += this.step;
    }
    this.position -= samples.length;
    return true;
  }
}
registerProcessor('zapper-host-microphone', ZapperHostMic);
`;

export async function startHostMicrophone({ apiBase, sessionId, fetchCaptureToken, onStatus, onTranscript, onStopped }) {
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode || !window.AudioContext || !window.WebSocket) {
    throw new Error('This browser does not support live microphone transcription. Use current Chrome or Edge on HTTPS.');
  }
  let stopped = false;
  let stream = null;
  let context = null;
  let source = null;
  let processor = null;
  let muteOutput = null;
  let socket = null;
  let reconnect = null;
  let attempts = 0;
  let socketGeneration = 0;
  let lastFailure = '';
  const apiWs = apiBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  const status = text => { if (!stopped) onStatus?.(text); };
  const cleanup = () => {
    if (reconnect) clearTimeout(reconnect);
    reconnect = null;
    if (socket) { try { socket.close(1000, 'microphone stopped'); } catch (_) {} }
    socket = null;
    if (processor) { processor.port.onmessage = null; try { processor.disconnect(); } catch (_) {} }
    if (source) try { source.disconnect(); } catch (_) {}
    if (muteOutput) try { muteOutput.disconnect(); } catch (_) {}
    stream?.getTracks().forEach(track => track.stop());
    if (context) context.close().catch(() => {});
    source = processor = muteOutput = context = stream = null;
  };
  const stop = (reason = '') => {
    if (stopped) return;
    stopped = true;
    ++socketGeneration;
    cleanup();
    onStopped?.(reason);
  };
  const connect = async () => {
    if (stopped) return;
    const generation = ++socketGeneration;
    try {
      const captureToken = await fetchCaptureToken(sessionId);
      if (stopped || generation !== socketGeneration) return;
      const url = `${apiWs}/stt?token=${encodeURIComponent(captureToken)}`;
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      socket = ws;
      ws.onopen = () => { if (stopped || socket !== ws) return; attempts = 0; status('Microphone active. Listening to your voice without opening Google Meet.'); };
      ws.onmessage = event => {
        if (stopped || socket !== ws) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'transcript') onTranscript?.(data);
          else if (data.type === 'status') status(data.text || 'Transcription connected.');
          else if (data.type === 'session_ended') stop('Session ended. Host microphone stopped.');
          else if (data.type === 'limit_reached') stop('Session time limit reached. Host microphone stopped.');
          else if (data.type === 'error') { lastFailure = data.message || 'Transcription could not start.'; status(lastFailure); }
        } catch (_) { /* Ignore malformed upstream notifications. */ }
      };
      ws.onclose = event => {
        if (stopped || socket !== ws) return;
        socket = null;
        if (event.code === 1008 || event.code === 1000) {
          stop(lastFailure || 'Microphone connection ended. Click Start microphone to retry.');
          return;
        }
        scheduleReconnect();
      };
      ws.onerror = () => { if (!stopped) status('Transcription connection interrupted. Retrying…'); };
    } catch (error) {
      if (!stopped) {
        lastFailure = error.message || 'Microphone authorization failed.';
        // An ended or disabled host session is not a transient network error.
        if (error.status === 403 || error.status === 404 || error.status === 409) stop(lastFailure);
        else scheduleReconnect();
      }
    }
  };
  const scheduleReconnect = () => {
    if (stopped || reconnect) return;
    if (++attempts > 8) { stop(lastFailure || 'Microphone connection failed. Click Start microphone to retry.'); return; }
    status('Microphone is on; reconnecting transcription…');
    reconnect = setTimeout(() => { reconnect = null; void connect(); }, Math.min(1500 * attempts, 12000));
  };
  try {
    status('Allow microphone access to transcribe your own voice. Camera stays off.');
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    // If permission is revoked mid-meeting, immediately release the socket.
    stream.getAudioTracks().forEach(track => { track.onended = () => stop('Microphone access ended. Click Start microphone to reconnect.'); });
    context = new AudioContext();
    const blobUrl = URL.createObjectURL(new Blob([processorSource], { type: 'text/javascript' }));
    try { await context.audioWorklet.addModule(blobUrl); }
    finally { URL.revokeObjectURL(blobUrl); }
    if (stopped) return { stop };
    source = context.createMediaStreamSource(stream);
    processor = new AudioWorkletNode(context, 'zapper-host-microphone');
    muteOutput = context.createGain();
    muteOutput.gain.value = 0;
    source.connect(processor).connect(muteOutput).connect(context.destination);
    processor.port.onmessage = event => {
      if (!stopped && socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 1024 * 1024 && event.data instanceof ArrayBuffer) {
        socket.send(event.data);
      }
    };
    await context.resume();
    await connect();
    return { stop, get stopped() { return stopped; } };
  } catch (error) {
    stop();
    throw error;
  }
}
