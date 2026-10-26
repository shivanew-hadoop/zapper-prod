// A browser profile owns at most one selected room for each signed-in host.
// The UI stores this key in localStorage so tabs in that profile share it;
// different computers keep their own localStorage and can host different rooms.
// The server still validates session ownership and PINs independently.
export function deviceSessionKey(accountId) {
  return accountId === null || accountId === undefined || String(accountId) === ''
    ? '' : `zapperHostSession:${accountId}`;
}

export function getDeviceSessionId(storage, accountId) {
  const key = deviceSessionKey(accountId);
  if (!key) return '';
  try { return String(storage.getItem(key) || ''); } catch (_) { return ''; }
}

export function saveDeviceSessionId(storage, accountId, id) {
  const key = deviceSessionKey(accountId);
  if (!key || !id) return;
  try { storage.setItem(key, String(id)); } catch (_) { /* Storage may be blocked. In-memory selection still works. */ }
}

export function clearDeviceSessionId(storage, accountId) {
  const key = deviceSessionKey(accountId);
  if (!key) return;
  try { storage.removeItem(key); } catch (_) { /* Storage may be blocked. */ }
}

export function selectDeviceSession(sessions, sessionId) {
  if (!sessionId) return null;
  return (sessions || []).find(session => session.id === sessionId &&
    session.status === 'active' && session.active !== false) || null;
}

// Browser-level create-session gate: restored sessions must keep Create Session
// disabled even before /api/sessions finishes loading after refresh/login.
export function canCreateHostSession({ hostEligible, overlayReady, creating, currentSessionId, browserSessionId }) {
  return Boolean(hostEligible && overlayReady && !creating && !currentSessionId && !browserSessionId);
}
