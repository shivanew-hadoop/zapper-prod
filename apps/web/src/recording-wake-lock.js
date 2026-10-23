// Screen Wake Lock keeps a *visible* mobile host dashboard awake while it records.
// Browser/OS power-saving restrictions still apply; hidden/locked tabs cannot be guaranteed.
export function createRecordingWakeLock({ navigatorObject = globalThis.navigator, documentObject = globalThis.document, onState = () => {} } = {}) {
  let desired = false;
  let sentinel = null;
  let requestInFlight = null;
  let generation = 0;
  const visible = () => documentObject?.visibilityState !== 'hidden';
  async function acquire() {
    if (!desired || !visible() || sentinel || requestInFlight) return;
    if (!navigatorObject?.wakeLock?.request) {
      onState('Keep this browser visible and your phone awake while recording; this browser does not support screen wake lock.');
      return;
    }
    const current = generation;
    requestInFlight = Promise.resolve().then(() => navigatorObject.wakeLock.request('screen'));
    try {
      const lock = await requestInFlight;
      if (!desired || !visible() || current !== generation) {
        await lock.release().catch(() => {});
        return;
      }
      sentinel = lock;
      onState('Screen kept awake while the microphone is on. Keep Zapper visible to continue recording.');
      lock.addEventListener?.('release', () => {
        if (sentinel !== lock) return;
        sentinel = null;
        if (desired) onState('Screen wake lock released by the device. Keep Zapper visible to continue recording.');
      });
    } catch (_) {
      if (desired) onState('Could not prevent screen lock. Keep the browser visible and disable phone auto-lock during recording.');
    } finally {
      requestInFlight = null;
    }
  }
  async function stop() {
    desired = false;
    ++generation;
    const lock = sentinel;
    sentinel = null;
    onState('');
    if (lock) try { await lock.release(); } catch (_) {}
  }
  function start() { desired = true; void acquire(); }
  documentObject?.addEventListener?.('visibilitychange', () => {
    if (desired && visible()) void acquire();
  });
  return { start, stop, get active() { return desired; } };
}
