// Caption-based inactivity; confirmations never masquerade as microphone speech.
const SILENCE_WARNING_MS = 12 * 60 * 1000;
const RESPONSE_GRACE_MS = 2 * 60 * 1000;
function inactivityState(row, now = Date.now()) {
  const trackingAt = Number(row?.inactivity_started_at_ms || 0);
  if (!trackingAt || !row || !Number(row.active) || row.status !== 'active') {
    return { monitored: false, showWarning: false, shouldEnd: false, lastActivityAt: 0, warningAt: 0, endAt: 0 };
  }
  const lastActivityAt = Math.max(trackingAt, Number(row.last_caption_at_ms || 0), Number(row.last_confirmed_at_ms || 0));
  const warningAt = lastActivityAt + SILENCE_WARNING_MS;
  const endAt = warningAt + RESPONSE_GRACE_MS;
  return { monitored: true, showWarning: now >= warningAt, shouldEnd: now >= endAt, lastActivityAt, warningAt, endAt };
}
module.exports = { inactivityState, SILENCE_WARNING_MS, RESPONSE_GRACE_MS };
