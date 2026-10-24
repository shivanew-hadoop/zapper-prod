// Hold an exclusive browser-profile Web Lock while a session's host microphone
// runs. Prevents two Zapper tabs from capturing and transcribing the same host.
// Browsers without Web Locks retain the original single-tab behavior.
export async function acquireHostMicOwnership(sessionId, locks = globalThis.navigator?.locks) {
  if (!locks?.request) return { release() {}, supported: false };
  let resolveClaim;
  const claim = new Promise(resolve => { resolveClaim = resolve; });
  let releaseClaim;
  const pending = locks.request(`zapper-host-mic:${sessionId}`, { mode: 'exclusive', ifAvailable: true }, lock => {
    if (!lock) { resolveClaim(false); return; }
    resolveClaim(true);
    return new Promise(resolve => { releaseClaim = resolve; });
  });
  const granted = await claim;
  if (!granted) { await pending; return null; }
  let released = false;
  return {
    supported: true,
    release() { if (released) return; released = true; releaseClaim?.(); },
  };
}
