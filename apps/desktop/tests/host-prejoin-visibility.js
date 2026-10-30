// Regression guard: Google Meet's compact prejoin UI must not hide its Join
// button or force endless reloads when a human sign-in/verification is required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../meet-controller/host-join.js'), 'utf8');
const start = code.indexOf('async function joinAsHost(');
const end = code.indexOf('// The host stays in the meeting', start);
assert(start > 0 && end > start);
let now = 100000;
let tick;
let openedWindow;
let prompts = [];
let showedWindow = 0;
let clickCount = 0;
let state = 'searching';
class MockWindow {
  constructor(options) {
    this.options = options;
    this.loaded = [];
    this.webContents = {
      getURL: () => this.loaded[this.loaded.length - 1],
      executeJavaScript: async () => state === 'ready'
        ? { state, x: 60, y: 60, text: 'join now' } : { state },
    };
    openedWindow = this;
  }
  on() {}
  isDestroyed() { return false; }
  async loadURL(url) { this.loaded.push(url); }
}
const context = {
  BrowserWindow: MockWindow,
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1366, height: 728 } }) },
  systemPreferences: {},
  path, __dirname: path.join(__dirname, '../meet-controller'),
  HOST_PARTITION: 'persist:zapper-host-meet',
  chooseHostPartition: async () => 'persist:gmeet-profile',
  hostAutomation() {},
  USER_AGENT: 'mock-chrome',
  MEET_URL: /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/,
  hostWindow: null,
  hostTimer: null,
  hostRecoveryTimer: null,
  sanitizeName: value => String(value || 'Host'),
  allowMediaForHostSession() {},
  stopHostTimer() {},
  stopHostRecoveryGuard() {},
  startHostRecoveryGuard() {},
  showHostWindow() { showedWindow++; },
  hideHostWindow() {},
  nativeClick: async () => { clickCount++; },
  setInterval: fn => { tick = fn; return { unref() {} }; },
  clearInterval() {},
  Date: { now: () => now },
  console,
  process: { platform: 'win32' },
};
vm.createContext(context);
vm.runInContext(code.slice(start, end), context);
(async () => {
  const room = 'https://meet.google.com/abc-defg-hij';
  await vm.runInContext('joinAsHost({ meetUrl: "https://meet.google.com/abc-defg-hij", name: "Host" }, msg => __messages.push(msg))',
    Object.assign(context, { __messages: prompts }));
  assert(openedWindow.options.width >= 900, 'Meet host window must offer desktop layout');
  assert(openedWindow.options.height >= 600, 'Meet host window must show entire join controls');
  await tick();
  now += 16000;
  await tick();
  assert.equal(showedWindow, 0, 'automatic host join never asks for a manual click on ordinary loading stalls');
  assert(prompts.some(m => m.includes('retrying automatically')), 'stalled Google Meet should retry automatically');
  assert.equal(openedWindow.options.webPreferences.partition, 'persist:gmeet-profile', 'reuse an existing authenticated profile');
  now += 60000;
  await tick();
  assert(openedWindow.loaded.length <= 3, 'automatic retries must be bounded');
  assert(!openedWindow.loaded.some(url => url.includes('accounts.google.com')), 'never navigate to embedded Google sign-in');
  state = 'ready';
  now += 6000;
  await tick();
  assert.equal(clickCount, 1, 'once Google presents Join, regular auto-join must resume');
  console.log(JSON.stringify({ ok: true, autoJoinWithoutManualPrompt: true, boundedRetries: true, joinResumes: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
