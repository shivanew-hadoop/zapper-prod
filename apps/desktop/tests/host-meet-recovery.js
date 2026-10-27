const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../meet-controller/host-join.js'), 'utf8');
const start = code.indexOf('function stopHostRecoveryGuard()');
const end = code.indexOf('async function joinAsHost(', start);
assert(start !== -1 && end > start);
let recoveries = 0;
let ended = false;
let timerFn;
const win = {
  isDestroyed: () => false,
  webContents: { executeJavaScript: async () => ended },
  __zapperMeetUrl: 'https://meet.google.com/abc-defg-hij',
  __zapperHostName: 'Host',
  __zapperOnStatus: () => {},
};
const context = {
  hostWindow: win, hostRecoveryTimer: null, recentHostRecoveries: [],
  setInterval(fn) { timerFn = fn; return { unref() {} }; },
  clearInterval() {},
  leaveHost() { context.hostWindow = null; },
  async joinAsHost({ meetUrl }) {
    assert.equal(meetUrl, win.__zapperMeetUrl);
    recoveries++;
    context.hostWindow = { isDestroyed: () => false };
  },
  Date, console,
};
vm.createContext(context);
vm.runInContext(code.slice(start, end), context);
(async () => {
  vm.runInContext('startHostRecoveryGuard(hostWindow)', context);
  await timerFn();
  assert.equal(recoveries, 0, 'a connected Meet must never reload');
  ended = true;
  await timerFn();
  assert.equal(recoveries, 1, 'only a confirmed Google ended page triggers rejoin');
  console.log(JSON.stringify({ ok: true, liveMeetUntouched: true, explicitEndedPageRejoined: true }));
})().catch(err => { console.error(err); process.exitCode = 1; });
