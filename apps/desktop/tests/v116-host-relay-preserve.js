'use strict';
// A host relay auth error must not be treated as the end of Google Meet.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const a = src.indexOf('onEnded: (reason, type) => {');
const b = src.indexOf('\n        }\n      });', a);
assert(a >= 0 && b > a);
const seen = [];
const ctx = vm.createContext({
  hostCaptionsAuthorized: true,
  overlayWindow: { isDestroyed: () => false, webContents: { send: (name, text) => seen.push({ name, text }) } },
  leaveHost: () => seen.push({ name: 'left-host' }),
  sendStatus: text => seen.push({ name: 'status', text }), String
});
vm.runInContext('this.onEnded = (reason, type) => {' + src.slice(a + 'onEnded: (reason, type) => {'.length, b) + '\n}', ctx);
ctx.onEnded('Authorization unavailable');
assert.equal(ctx.hostCaptionsAuthorized, true);
assert(!seen.some(e => e.name === 'host-session-stopped' || e.name === 'left-host'));
assert(seen.some(e => e.name === 'status'));
ctx.onEnded('Session ended', 'session_ended');
assert.equal(ctx.hostCaptionsAuthorized, false);
assert(seen.some(e => e.name === 'host-session-stopped'));
assert(seen.some(e => e.name === 'left-host'));
console.log(JSON.stringify({ ok: true, temporaryRelayFailureKeepsCaptions: true, verifiedEndStillStops: true }));
