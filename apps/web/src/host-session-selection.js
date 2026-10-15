// Browser-tab session selection is scoped to the signed-in Zapper host.
// Never share the selected room via localStorage: multiple computers (or tabs)
// using the same host account must not follow each other's latest session.
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
