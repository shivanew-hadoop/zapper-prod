const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const sessionId = '9d2c840e-a780-4d8b-bb10-30ba96976751';
const meetUrl = 'https://meet.google.com/abc-defg-hij';
function flush() { return new Promise(resolve => setTimeout(resolve, 30)); }
async function backgroundTest() {
  let messageListener; let updatedListener; let removedListener;
  const storage = {};
  const tabs = new Map([[1, { id: 1, url: 'https://zapperapp.in/', windowId: 11, active: true }]]);
  let nextId = 2; const created = [], removed = [], delivered = [], enabled = [];
  const chrome = {
    runtime: { onMessage: { addListener(fn) { messageListener = fn; } } },
    tabs: {
      async get(id) { if (!tabs.has(id)) throw Error('Missing tab'); return tabs.get(id); },
      async create(info) { const tab = { id: nextId++, windowId: info.windowId, url: info.url, active: info.active }; tabs.set(tab.id, tab); created.push(tab); return tab; },
      async remove(id) { removed.push(id); tabs.delete(id); },
      async update(id, opts) { Object.assign(tabs.get(id), opts); },
      async sendMessage(id, msg) { delivered.push({ id, msg }); return { ok: true }; },
      onUpdated: { addListener(fn) { updatedListener = fn; } },
      onRemoved: { addListener(fn) { removedListener = fn; } },
    },
    storage: { session: {
      async get(k) { return { [k]: storage[k] }; },
      async set(vals) { Object.assign(storage, vals); },
      async remove(key) { delete storage[key]; },
    } },
    contentSettings: { microphone: { async set(value) { enabled.push(value); } } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), { chrome, console, URL, setTimeout, clearTimeout, Date }, { filename: 'background.js' });
  const sender = { url: 'https://zapperapp.in/', tab: tabs.get(1) };
  const send = (payload, from = sender) => new Promise(resolve => {
    const asyncCall = messageListener(payload, from, resolve);
    assert.equal(asyncCall, true);
  });
  const createdReply = await send({ type: 'zapper-web-host-command', action: 'start', sessionId, meetUrl });
  assert.equal(createdReply.ok, true);
  assert.equal(created.length, 1);
  assert.equal(created[0].url, meetUrl);
  assert.equal(enabled.length, 1);
  assert.equal(enabled[0].setting, 'allow');
  const repeated = await send({ type: 'zapper-web-host-command', action: 'start', sessionId, meetUrl });
  assert.equal(repeated.reused, true, 'same session must reuse original Meet tab');
  assert.equal(created.length, 1);
  await send({ type: 'zapper-meet-host-progress', sessionId, status: 'joined', message: 'joined' }, { tab: created[0] });
  assert.equal(tabs.get(1).active, true);
  assert(delivered.some(item => item.id === 1 && item.msg.status === 'joined'));
  const other = await send({ type: 'zapper-web-host-command', action: 'start', sessionId, meetUrl }, { url: 'https://attack.invalid/', tab: tabs.get(1) });
  assert.equal(other.ok, false, 'untrusted web origins cannot start Google Meet');
  const muted = await send({ type: 'zapper-web-host-command', action: 'mute', sessionId });
  assert.equal(muted.ok, true);
  assert(delivered.some(item => item.id === created[0].id && item.msg.enabled === false));
  const stopped = await send({ type: 'zapper-web-host-command', action: 'stop', sessionId });
  assert.equal(stopped.ok, true);
  assert.deepEqual(removed, [created[0].id]);
  // /new fallback: create room in local signed-in Chrome, then reuse it for hosting.
  const createPromise = send({ type: 'zapper-web-host-command', action: 'create', sessionId: '' });
  await flush();
  const staging = created[1];
  assert.equal(staging.url, 'https://meet.google.com/new');
  staging.url = meetUrl; // Google's real /new redirect.
  const fallback = await createPromise;
  assert.equal(fallback.meetUrl, meetUrl);
  const started = await send({ type: 'zapper-web-host-command', action: 'start', sessionId, meetUrl });
  assert.equal(started.ok, true);
  assert.equal(created.length, 2, 'the just-created room must not open a duplicate host tab');
  updatedListener(staging.id, { status: 'complete' });
  removedListener(88);
  await flush();
  console.log('Host extension: trusted origin, mic grant, deduplicated start, tab restore, mute, stop, /new -> PIN handoff passed');
}
async function meetDomTest() {
  let micOn = false; let cameraOn = true; let inCall = false;
  const outcomes = [];
  let callback; let timerTick;
  const btn = (name, handler) => ({
    getAttribute(attr) { return attr === 'aria-label' ? name : null; },
    get textContent() { return name; },
    getBoundingClientRect() { return { width: 100, height: 30 }; },
    click: handler,
  });
  const document = {
    body: { innerText: 'Ready to join?' },
    querySelectorAll() {
      return [
        btn(micOn ? 'Turn off microphone' : 'Turn on microphone', () => { micOn = !micOn; }),
        btn(cameraOn ? 'Turn off camera' : 'Turn on camera', () => { cameraOn = !cameraOn; }),
        ...(inCall ? [btn('Leave call', () => { inCall = false; })]
          : [btn('Join now', () => { if (micOn && !cameraOn) inCall = true; })]),
      ];
    },
  };
  const chrome = { runtime: {
    onMessage: { addListener(fn) { callback = fn; } },
    sendMessage: async payload => { outcomes.push(payload); },
  } };
  const context = { chrome, console, document, navigator: { permissions: { query: async () => ({ state: 'granted' }) } },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    setInterval: fn => { timerTick = fn; return 1; }, clearInterval: () => {}, Date, Promise, setTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'meet-host.js'), 'utf8'), context, { filename: 'meet-host.js' });
  let result;
  callback({ type: 'zapper-host-meet-start', sessionId }, null, r => { result = r; });
  assert.equal(result.ok, true);
  await flush();
  // First tick switches mic/camera to safe settings. Trigger an idempotent start.
  callback({ type: 'zapper-host-meet-start', sessionId }, null, r => { result = r; });
  assert.equal(result.alreadyRunning, true);
  assert.equal(micOn, true);
  assert.equal(cameraOn, false);
  // Poll again: Meet now has the required prejoin state, so click Join now.
  await timerTick();
  assert.equal(inCall, true, 'automation must click Join now');
  await timerTick();
  assert(outcomes.some(value => value.status === 'joined'), 'host must report verified joined state');
  assert(fs.readFileSync(path.join(root, 'meet-host.js'), 'utf8').includes('currentCamera?.enabled !== false'));
  console.log('Host Meet content script: mic ON, camera OFF, automatic Join now, verified joined state passed');
}
(async () => {
  await backgroundTest();
  await meetDomTest();
})().catch(error => { console.error(error); process.exitCode = 1; });
