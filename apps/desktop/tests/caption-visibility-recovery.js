// Regression coverage for lost host-session startup events and misleading prejoin labels.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'overlay/index.html'), 'utf8');
const overlay = fs.readFileSync(path.join(root, 'overlay/overlay.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const guest = fs.readFileSync(path.join(root, 'meet-controller/meet-preload.js'), 'utf8');
assert(!html.includes('transcriptionSource'), 'remove the Source badge from host and PIN overlays');
assert(preload.includes("getCaptionSessionState: () => ipcRenderer.invoke('get-caption-session-state')"));
assert(main.includes("ipcMain.handle('get-caption-session-state'"));
assert(main.includes('hostActive: hostMeetActive'), 'local host view must survive missing relay token');
assert(main.includes('if (!hostMeetActive || !payload?.text) return;'));
assert(main.includes('if (hostCaptionsAuthorized) publishHostCaption('), 'remote publish must remain token-gated');
// Losing the original host-session-active IPC signal cannot leave the overlay on the PIN screen.
const handshake = overlay.slice(overlay.lastIndexOf('// The portal can launch the host Meet'));
let shown = 0, rendered = 0;
const state = {
  window: { electronAPI: { getCaptionSessionState: () => Promise.resolve({ hostActive: true }) } },
  activeSessionToken: '', hostMirrorActive: false,
  showLive: () => { shown++; },
  leaveBtn: { classList: { add(label) { assert.equal(label, 'hidden'); } } },
  renderTranscript: () => { rendered++; }
};
vm.createContext(state);
vm.runInContext(handshake, state);
(async () => {
  await Promise.resolve(); await Promise.resolve();
  assert.equal(shown, 1, 'ready overlay restores live host mode');
  assert.equal(rendered, 1);
  vm.runInContext(handshake, state);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(shown, 1, 'state sync must not reinitialize an already active transcript');

  // Joined controls take priority over generic "join now" text elsewhere on Meet.
  const start = guest.indexOf('  function isInMeeting() {');
  const end = guest.indexOf('  // Primary transcription path:', start);
  assert(start > 0 && end > start);
  const context = { document: { body: { innerText: 'Someone said join now in chat' },
    querySelector: () => ({}) }, normalizeText: text => String(text || '') };
  vm.createContext(context);
  vm.runInContext(guest.slice(start, end), context);
  assert.equal(vm.runInContext('isInMeeting()', context), true, 'joined Meet must not be treated as prejoin');
  context.document.querySelector = () => null;
  assert.equal(vm.runInContext('isInMeeting()', context), false, 'unadmitted page remains blocked');
  console.log(JSON.stringify({ ok: true, sourceBadgeRemoved: true, hostStateRecovered: true,
    relayTokenStillRequired: true, joinedControlPriority: true }));
})().catch(e => { console.error(e); process.exitCode = 1; });
