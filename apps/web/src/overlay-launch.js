// Session creation is held until a *specific* launch request has been accepted
// by the installed desktop app AND its real overlay has become visible.
// No fixed timer can establish Windows protocol-confirmation or overlay readiness.
export const ZAPPER_READY_URL = 'http://127.0.0.1:43791/overlay-ready';

export async function waitForOverlayReady(nonce, { signal, fetcher = fetch, pollMs = 450 } = {}) {
  if (!/^[a-f0-9-]{36}$/i.test(nonce)) throw new Error('Invalid Zapper launch request.');
  while (!signal?.aborted) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const requestDeadline = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetcher(`${ZAPPER_READY_URL}?nonce=${encodeURIComponent(nonce)}`, {
        cache: 'no-store', mode: 'cors', signal: controller.signal
      });
      if (response.ok && (await response.json()).ready === true && !signal?.aborted) return true;
    } catch (_) {
      // App not installed, protocol still awaiting browser confirmation, or
      // overlay still opening. Do not create a session in any of these cases.
    } finally {
      clearTimeout(requestDeadline);
      signal?.removeEventListener('abort', cancel);
    }
    await new Promise(resolve => {
      const timer = setTimeout(done, pollMs);
      function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
      signal?.addEventListener('abort', done, { once: true });
    });
  }
  return false;
}
