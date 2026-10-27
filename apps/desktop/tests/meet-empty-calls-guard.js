// Simulated Google Meet page: ensure the host preference is turned OFF and
// verified, not merely assumed from a click. Never edit non-matching controls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../meet-controller/host-caption-preload.js'), 'utf8');

function scenario({ initiallyOn = true, clickSucceeds = true, inCall = true, aloneWording = false } = {}) {
  let now = 100_000, stage = 0, switchOn = initiallyOn;
  let moreClicks = 0, settingsClicks = 0, generalClicks = 0, toggleClicks = 0;
  let reminder = false, stayClicks = 0;
  const events = [], intervals = [], timers = [];
  const element = (name, click, extra = {}) => ({
    innerText: name, textContent: name,
    getAttribute: key => key === 'aria-label' ? name : '',
    getBoundingClientRect: () => ({ width: 120, height: 30 }),
    click, closest: () => null, ...extra
  });
  const more = element('More options', () => { moreClicks++; stage = 1; });
  const settings = element('Settings', () => { settingsClicks++; stage = 2; });
  const general = element('General', () => { generalClicks++; stage = 3; });
  const toggle = element('Leave empty calls', () => {
    toggleClicks++;
    if (clickSucceeds) switchOn = !switchOn;
  }, { getAttribute: key => key === 'aria-label' ? 'Leave empty calls' : key === 'aria-checked' ? String(switchOn) : '' });
  const stay = element('Stay in the call', () => { stayClicks++; reminder = false; });
  const reminderDialog = element(aloneWording ? 'You are alone in this meeting' : "Are you still there? You're the only one here", () => {}, { contains: node => node === stay });
  const doc = {
    readyState: 'complete',
    querySelector: selector => selector.includes('Leave call') && inCall ? {} : null,
    querySelectorAll: selector => {
      if (selector === '[role="switch"],[role="checkbox"],input[type="checkbox"]') return stage === 3 ? [toggle] : [];
      if (selector === 'label,span,div,p') return [];
      if (selector === '[role="dialog"],[role="alertdialog"]') return reminder ? [reminderDialog] : [];
      if (selector.includes('button')) return [more, ...(stage >= 1 ? [settings] : []), ...(stage >= 2 ? [general] : []), ...(reminder ? [stay] : [])];
      return [];
    }
  };
  const MockDate = class extends Date { static now() { return now; } };
  vm.runInNewContext(source, {
    require: name => { if (name === './meet-chat-rows') return require('../meet-controller/meet-chat-rows'); assert.equal(name, 'electron'); return { ipcRenderer: { send: (...args) => events.push(args) } }; },
    document: doc, Date: MockDate, console,
    setInterval: (fn, ms) => intervals.push({ fn, ms }),
    setTimeout: (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t; },
    clearTimeout: t => { t.fn = null; }
  });
  assert.equal(intervals.length, 2);
  function tick(ms) {
    now += ms;
    intervals[0].fn();
    for (const timer of timers) if (timer.fn && timer.at <= now) { const f = timer.fn; timer.fn = null; f(); }
  }
  return {
    tick,
    prompt() { reminder = true; },
    get state() { return { switchOn, moreClicks, settingsClicks, generalClicks, toggleClicks, stayClicks, reminder }; }
  };
}

const enabled = scenario();
// UK selection attempt times out after six seconds, then empty-call guard begins.
enabled.tick(0);
enabled.tick(6100);
enabled.tick(1500);
enabled.tick(1500);
enabled.tick(1500);
assert.equal(enabled.state.toggleClicks, 1, 'switch ON clicked exactly once');
assert.equal(enabled.state.switchOn, false, 'Google Meet checkbox is OFF');
enabled.tick(1500);
enabled.tick(12000);
assert.equal(enabled.state.toggleClicks, 1, 'verified OFF never clicked again');

const alreadyOff = scenario({ initiallyOn: false });
alreadyOff.tick(0);
for (const ms of [6100, 1500, 1500, 1500, 1500]) alreadyOff.tick(ms);
assert.equal(alreadyOff.state.toggleClicks, 0, 'OFF switch is not accidentally toggled ON');

const rejected = scenario({ clickSucceeds: false });
rejected.tick(0);
for (const ms of [6100, 1500, 1500, 1500, 1500, 5000, 1500]) rejected.tick(ms);
assert(rejected.state.toggleClicks > 1, 'failed switch click must be retried, not marked done');
assert.equal(rejected.state.switchOn, true);
rejected.prompt();
rejected.tick(3000);
assert.equal(rejected.state.stayClicks, 1, 'host-initiated session stays connected until Zapper inactivity decision');
assert.equal(rejected.state.reminder, false);
const hiddenLeaveButton = scenario({ inCall: false, aloneWording: true });
hiddenLeaveButton.prompt();
hiddenLeaveButton.tick(100);
assert.equal(hiddenLeaveButton.state.stayClicks, 1,
  'Google reminder must be dismissed even when it hides the ordinary Leave call control');
console.log(JSON.stringify({ ok: true, autoSettingsOpened: true, verifiedOff: true, safeWhenAlreadyOff: true, failedClickRetried: true, earlyGoogleReminderHandled: true }));
