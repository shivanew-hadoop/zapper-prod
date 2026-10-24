import assert from 'node:assert/strict';
import { acquireHostMicOwnership } from '../src/host-mic-ownership.js';
let held = false;
const locks = { async request(name, options, cb) {
  assert.equal(name, 'zapper-host-mic:shared-room');
  assert.equal(options.ifAvailable, true);
  if (held) return cb(null);
  held = true;
  try { return await cb({ name }); } finally { held = false; }
} };
const first = await acquireHostMicOwnership('shared-room', locks);
assert.equal(first.supported, true);
assert.equal(await acquireHostMicOwnership('shared-room', locks), null);
first.release();
await new Promise(resolve => setTimeout(resolve, 0));
const second = await acquireHostMicOwnership('shared-room', locks);
assert.ok(second, 'another tab can acquire after first tab releases');
second.release();
const unsupported = await acquireHostMicOwnership('room', null);
assert.equal(unsupported.supported, false);
console.log('Host microphone cross-tab exclusive ownership passed');
