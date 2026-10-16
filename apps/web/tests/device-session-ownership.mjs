import assert from 'node:assert/strict';
import { getDeviceSessionId, saveDeviceSessionId, selectDeviceSession, clearDeviceSessionId } from '../src/host-session-selection.js';

function storage() {
  const m = new Map();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
const host = 901;
const localA = storage(), localB = storage();
const s1 = { id: 'host-901-room-a', pin: '101001', status: 'active', active: true };
const s2 = { id: 'host-901-room-b', pin: '202002', status: 'active', active: true };
const s3 = { id: 'host-901-room-c', pin: '303003', status: 'active', active: true };
assert.equal(getDeviceSessionId(localA, host), '');
assert.equal(getDeviceSessionId(localB, host), '');
saveDeviceSessionId(localA, host, s1.id);
assert.equal(selectDeviceSession([s2,s3,s1], getDeviceSessionId(localA, host)).id, s1.id);
assert.equal(getDeviceSessionId(localB, host), '', 'second machine must not inherit first machine\'s room');
saveDeviceSessionId(localB, host, s2.id);
assert.equal(selectDeviceSession([s3,s1,s2], getDeviceSessionId(localB,host)).pin, '202002');
const secondTabSameBrowser = localA;
assert.equal(getDeviceSessionId(secondTabSameBrowser, host), s1.id, 'tabs in same browser profile share one device room');
const endedS1 = { ...s1, status: 'ended', active: false };
assert.equal(selectDeviceSession([endedS1,s2,s3], getDeviceSessionId(localA,host)), null, 'ending A must not select B');
clearDeviceSessionId(localA,host);
assert.equal(getDeviceSessionId(localA,host), '', 'device A can create again after A ends');
assert.equal(getDeviceSessionId(localB,host),s2.id,'device B remains locked to its own PIN');
assert.equal(getDeviceSessionId(localB,host+1), '', 'different host account never inherits a session');
console.log('PASS: device storage, independent computers, session lifecycle, same-browser tab ownership');
