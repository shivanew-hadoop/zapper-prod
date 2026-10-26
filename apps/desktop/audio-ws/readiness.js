// A small acknowledgement for the host website. Never send session or user data.
function overlayReadinessMessage(isOverlayReady) {
  let ready = false;
  try { ready = Boolean(isOverlayReady?.()); } catch (_) {}
  return JSON.stringify({ type: 'zapper-overlay-ready', ready });
}
module.exports = { overlayReadinessMessage };
