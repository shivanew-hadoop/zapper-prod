// Group chat SEND path must work without finding/clicking a Google Meet chat box.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const start = source.indexOf("ipcMain.handle('send-meet-chat-message'");
const end = source.indexOf('\nfunction sendLoginRequired(', start);
assert(start !== -1 && end > start);
const relayCalls = [];
let handler = null;
const context = {
  ipcMain: { handle(name, fn) { assert.equal(name, 'send-meet-chat-message'); handler = fn; } },
  started: false,
  activeCaptureSessionToken: '',
  activeCaptureGoogleEmail: '',
  hostCaptionsAuthorized: true,
  publishHostChat: payload => { relayCalls.push({ audience: 'host', ...payload }); return true; },
  publishMeetChat: payload => { relayCalls.push({ audience: 'participant', ...payload }); return true; },
  require: name => require(name),
  Date,
  String,
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
(async () => {
  assert(handler);
  const longMessage = 'M'.repeat(12000);
  let result = await handler({}, longMessage);
  assert.equal(result.success, true);
  assert.equal(relayCalls[0].message.length, 12000, 'no app length truncation');
  assert.equal(relayCalls[0].sender, 'Host');
  context.hostCaptionsAuthorized = false;
  context.started = true;
  context.activeCaptureSessionToken = 'pin-authorized-token';
  context.activeCaptureGoogleEmail = 'guest@example.com';
  result = await handler({}, 'Hello everyone');
  assert.equal(result.success, true);
  assert.equal(relayCalls.at(-1).audience, 'participant');
  assert.equal(relayCalls.at(-1).message, 'Hello everyone');
  context.started = false;
  result = await handler({}, 'unauthorized message');
  assert.equal(result.success, false, 'chat cannot be sent outside a PIN or authorized host session');
  console.log(JSON.stringify({ ok: true, hostToGroup: true, pinToGroup: true, noMeetChatUIRequired: true, longMessages: true, authorization: true }));
})().catch(err => { console.error(err); process.exitCode = 1; });
