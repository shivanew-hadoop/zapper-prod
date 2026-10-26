import assert from 'node:assert/strict';
import { canCreateHostSession, getDeviceSessionId, saveDeviceSessionId, clearDeviceSessionId } from '../src/host-session-selection.js';

const base = {
  hostEligible: true,
  overlayReady: true,
  creating: false,
  currentSessionId: '',
  browserSessionId: ''
};
assert.equal(canCreateHostSession(base), true, 'ready host with no session may create');
assert.equal(canCreateHostSession({ ...base, overlayReady: false }), false, 'overlay closed => Create disabled');
assert.equal(canCreateHostSession({ ...base, hostEligible: false }), false, 'not a logged-in eligible host');
assert.equal(canCreateHostSession({ ...base, creating: true }), false, 'pending creation => Create disabled');
assert.equal(canCreateHostSession({ ...base, currentSessionId: 'active-a' }), false, 'active current session => disabled');
assert.equal(canCreateHostSession({ ...base, browserSessionId: 'active-a' }), false, 'stored active browser session => disabled even before restore');

const entries = new Map();
const browserStore = {
  getItem: key => entries.get(key) || null,
  setItem: (key, value) => entries.set(key, String(value)),
  removeItem: key => entries.delete(key)
};
saveDeviceSessionId(browserStore, 'host-a', 'existing-a');
assert.equal(canCreateHostSession({ ...base, browserSessionId: getDeviceSessionId(browserStore, 'host-a') }), false,
  'page reload must not briefly enable Create when browser owns another session');
assert.equal(canCreateHostSession({ ...base, browserSessionId: getDeviceSessionId(browserStore, 'host-b') }), true,
  'session ownership remains account-specific');
clearDeviceSessionId(browserStore, 'host-a');
assert.equal(canCreateHostSession({ ...base, browserSessionId: getDeviceSessionId(browserStore, 'host-a') }), true,
  'once session ends, overlay-ready host can create again');
console.log('PASS: Create Session overlay gate + one-session-per-browser lock');
