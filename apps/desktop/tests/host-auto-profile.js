// Guard: host uses its existing authenticated profile, or existing Zapper
// Google profile, with NO credentials copied, no scripted OAuth or forced login.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../meet-controller/host-join.js'), 'utf8');
const start = source.indexOf('const GOOGLE_AUTH_COOKIE_NAMES');
const end = source.indexOf('function allowMediaForHostSession(', start);
assert(start !== -1 && end > start);
const partitions = {};
const ctx = {
  HOST_PARTITION: 'persist:zapper-host-meet',
  SHARED_GOOGLE_PARTITION: 'persist:gmeet-profile',
  session: { fromPartition: p => ({ cookies: { get: async () => partitions[p] || [] } }) },
};
vm.createContext(ctx);
vm.runInContext(source.slice(start, end), ctx);
(async () => {
  const choose = () => vm.runInContext('chooseHostPartition()', ctx);
  assert.equal(await choose(), 'persist:zapper-host-meet', 'guest fallback with no signed-in profiles');
  partitions['persist:gmeet-profile'] = [{ name: 'SAPISID' }];
  assert.equal(await choose(), 'persist:gmeet-profile', 'reuse already signed-in Zapper Google profile');
  partitions['persist:zapper-host-meet'] = [{ name: 'SID' }];
  assert.equal(await choose(), 'persist:zapper-host-meet', 'prefer previously signed-in host profile');
  assert(!source.includes('accounts.google.com/ServiceLogin'), 'host must never force an embedded sign-in page');
  assert(!source.includes('sign in to Google in the Zapper Host window'), 'host must never request manual sign-in by default');
  console.log(JSON.stringify({ ok: true, reuseExistingGoogleSession: true, noManualSignInRedirect: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
