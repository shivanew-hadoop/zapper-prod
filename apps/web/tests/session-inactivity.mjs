import assert from 'node:assert/strict';
import { inactivityAlertState } from '../src/session-inactivity.js';
const now = Date.now();
assert.equal(inactivityAlertState({ active: true, monitored: true, showWarning: true, endAt: now + 90000 }, now).secondsLeft, 90);
assert.equal(inactivityAlertState({ active: true, monitored: true, showWarning: true, endAt: now + 90000 }, now).visible, true);
assert.equal(inactivityAlertState({ active: false, monitored: true, showWarning: true, endAt: now }, now).visible, false);
assert.equal(inactivityAlertState({ active: true, monitored: false, showWarning: true, endAt: now }, now).visible, false);
console.log('PASS: host-only notice and countdown');
