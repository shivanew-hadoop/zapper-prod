const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === 'electron') return { BrowserWindow: class {}, screen: {}, session: {}, systemPreferences: {} };
  return originalLoad.call(this, request, ...args);
};
const { hostAutomation } = require('../meet-controller/host-join');
Module._load = originalLoad;
const oldDocument = global.document;
const oldGetComputedStyle = global.getComputedStyle;
const oldInputEvent = global.InputEvent;
function mock(text) {
  global.document = { body: { innerText: text }, querySelectorAll: () => [], querySelector: () => null };
  global.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
  global.InputEvent = Event;
}
(async () => {
  mock('This browser version is no longer supported. Please upgrade to a supported browser. Getting ready...');
  assert.equal((await hostAutomation('Host')).state, 'browser_unsupported');
  mock('Getting ready...');
  assert.equal((await hostAutomation('Host')).state, 'getting_ready');
  mock("You can't join this video call. Returning to home screen.");
  assert.equal((await hostAutomation('Host')).state, 'cant_join');
  console.log(JSON.stringify({ ok: true, unsupportedBrowserDetected: true, spinnerDetected: true, joinRejectionDetected: true }));
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => {
  global.document = oldDocument;
  global.getComputedStyle = oldGetComputedStyle;
  global.InputEvent = oldInputEvent;
});
