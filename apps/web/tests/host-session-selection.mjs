import assert from 'node:assert/strict';
import { deviceSessionKey, getDeviceSessionId, saveDeviceSessionId, clearDeviceSessionId, selectDeviceSession } from '../src/host-session-selection.js';

function tabStorage() {
  const records = new Map();
  return {
    getItem(key) { return records.has(key) ? records.get(key) : null; },
    setItem(key, value) { records.set(key, String(value)); },
    removeItem(key) { records.delete(key); },
  };
}
const hostId = 73;
const sessionA = { id: 'meeting-a', pin: '123456', active: true, status: 'active' };
const sessionB = { id: 'meeting-b', pin: '654321', active: true, status: 'active' };
const tabA = tabStorage();
const tabB = tabStorage();
assert.equal(deviceSessionKey(hostId), 'zapperHostSession:73');
assert.equal(selectDeviceSession([sessionA, sessionB], ''), null, 'new computer must not steal latest');
saveDeviceSessionId(tabA, hostId, sessionA.id);
saveDeviceSessionId(tabB, hostId, sessionB.id);
for (const sessions of [[sessionA], [sessionB, sessionA], [sessionA, sessionB]]) {
  assert.equal(selectDeviceSession(sessions, getDeviceSessionId(tabA, hostId))?.id, 'meeting-a', 'computer A retains its own PIN');
}
assert.equal(selectDeviceSession([sessionB, sessionA], getDeviceSessionId(tabB, hostId))?.id, 'meeting-b', 'computer B retains its own PIN');
assert.equal(getDeviceSessionId(tabA, hostId), 'meeting-a', 'switching computers must not mutate A');
assert.equal(selectDeviceSession([{ ...sessionA, active: false, status: 'ended' }, sessionB], getDeviceSessionId(tabA, hostId)), null, 'ending A must not select B');
assert.equal(selectDeviceSession([sessionB], getDeviceSessionId(tabB, hostId))?.id, 'meeting-b', 'ending A must not end B');
saveDeviceSessionId(tabA, hostId, sessionB.id);
assert.equal(getDeviceSessionId(tabA, hostId), 'meeting-b', 'explicit session switch is allowed on A');
assert.equal(getDeviceSessionId(tabB, hostId), 'meeting-b', 'switch does not affect B');
clearDeviceSessionId(tabB, hostId);
assert.equal(getDeviceSessionId(tabB, hostId), '', 'ended / deselected B is cleared');
assert.equal(getDeviceSessionId(tabA, hostId), 'meeting-b', 'other tab unaffected');
assert.equal(getDeviceSessionId(tabA, 74), '', 'different signed-in host cannot inherit selection');
const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
assert.doesNotThrow(() => saveDeviceSessionId(blocked, hostId, 'id'));
assert.doesNotThrow(() => clearDeviceSessionId(blocked, hostId));
assert.equal(getDeviceSessionId(blocked, hostId), '');
console.log('PASS: two-computer and multi-tab sessions are independently selected, restored, cleared and isolated');
