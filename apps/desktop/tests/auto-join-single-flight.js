'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
(async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../meet-controller/index.js'), 'utf8');
  const start = source.indexOf('async function joinMeet(');
  const end = source.indexOf('\nasync function leaveMeet()', start);
  assert(start >= 0 && end > start);
  const fakeWindow = { isDestroyed: () => false, loadURL: async () => {} };
  const statuses = [];
  let completeAutomation;
  const automationResult = new Promise(resolve => { completeAutomation = resolve; });
  let automationCalls = 0, attemptInterval;
  let admitted = false;
  const ctx = vm.createContext({
    normalizeMeetUrl: x => x, getBotSession: () => {}, createMeetWindow: () => {},
    isGoogleLoggedIn: async () => true, safeStatus: (_, msg) => statuses.push(msg),
    sleep: async () => {}, meetWindow: fakeWindow, pollTimer: null, manualJoinWatcher: null,
    clearInterval: () => {}, setInterval: fn => { attemptInterval = fn; return 22; },
    readMeetBodyText: async () => admitted ? 'waiting to be admitted' : '',
    isManualJoinSubmitted: s => s.includes('waiting to be admitted'),
    prepareMeetPreJoinOnly: async () => {},
    runMeetAutomation: async () => { automationCalls++; return automationResult; },
    console,
  });
  vm.runInContext(`${source.slice(start, end)}; this.joinMeet = joinMeet;`, ctx);
  await ctx.joinMeet('https://meet.google.com/abc-defg-hij', 'Viewer', () => {});
  assert.equal(typeof attemptInterval, 'function');
  const inFlight = attemptInterval();
  await Promise.resolve(); await Promise.resolve();
  const overlap1 = attemptInterval();
  const overlap2 = attemptInterval();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(automationCalls, 1, 'slow Meet automation must not be started concurrently');
  admitted = true;
  completeAutomation(true);
  await Promise.all([inFlight, overlap1, overlap2]);
  assert(statuses.some(t => /join request sent or admitted/.test(t)));
  assert(!statuses.some(t => /Could not auto-join/.test(t)));
  assert.equal(ctx.pollTimer, null, 'join polling stops after admission request');
  console.log(JSON.stringify({ ok:true, singleFlightJoin:true, waitingAdmissionRecognized:true }));
})().catch(e => { console.error(e); process.exitCode = 1; });
