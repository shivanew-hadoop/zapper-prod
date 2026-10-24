// Chrome/Edge Web Speech fallback for the host's own microphone. Results use
// the existing authenticated host /stt socket, so PIN permissions are unchanged.
// Not a Google Meet microphone or remote-attendee capture implementation.
export function createBrowserSpeechCaptions({ Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition, sendCaption, onStatus, onError, onCaption }) {
  if (!Recognition) return null;
  let stopped = true;
  let current = null;
  let restartTimer = null;
  let errors = 0;
  let generation = 0;
  let lastSent = { key: '', at: 0 };
  const status = value => onStatus?.(value);
  const stop = () => {
    stopped = true;
    ++generation;
    clearTimeout(restartTimer);
    restartTimer = null;
    const speech = current;
    current = null;
    if (speech) { speech.onresult = speech.onerror = speech.onend = null; try { speech.abort(); } catch (_) {} }
  };
  const launch = () => {
    if (stopped) return;
    const id = ++generation;
    const speech = new Recognition();
    current = speech;
    speech.lang = 'en-US';
    speech.continuous = true;
    speech.interimResults = true;
    const seen = new Map();
    speech.onstart = () => { if (!stopped && generation === id) { errors = 0; status('Browser speech recognition listening; captions are relayed to PIN participants.'); } };
    speech.onresult = event => {
      if (stopped || generation !== id) return;
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const item = event.results[index];
        const value = String(item?.[0]?.transcript || '').trim();
        if (!value) continue;
        const isFinal = Boolean(item.isFinal);
        if (seen.get(index) === `${value}\u0000${isFinal}`) continue;
        seen.set(index, `${value}\u0000${isFinal}`);
        const key = `${value.toLowerCase()}\u0000${isFinal}`;
        const now = Date.now();
        if (key === lastSent.key && now - lastSent.at < 1500) continue;
        lastSent = { key, at: now };
        const caption = { type: 'local_caption', text: value, isFinal, capturedAt: now };
        sendCaption(caption);
        onCaption?.({ text: value, isFinal, source: 'browser-speech' });
      }
    };
    speech.onerror = event => {
      if (stopped || generation !== id) return;
      const code = String(event?.error || 'unknown');
      if (code === 'no-speech' || code === 'aborted') return;
      if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
        const message = `Browser speech recognition blocked (${code}). Check microphone permission or choose a working Deepgram key.`;
        stop(); onError?.(message); return;
      }
      errors += 1;
      status(`Browser speech recognition problem (${code}); retrying…`);
      if (errors > 5) { stop(); onError?.(`Browser speech recognition unavailable (${code}). Verify the speech service/network or Deepgram credentials.`); }
    };
    speech.onend = () => {
      if (stopped || generation !== id) return;
      current = null;
      restartTimer = setTimeout(() => { restartTimer = null; try { launch(); } catch (error) { stop(); onError?.(`Speech recognition restart failed: ${error.message}`); } }, 500);
    };
    speech.start();
  };
  return { start() { if (!stopped) return; stopped = false; try { launch(); } catch (error) { stop(); throw error; } }, stop, get active() { return !stopped; } };
}
