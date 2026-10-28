'use strict';
// Actual desktop caption handoff: Google Meet caption text goes through the
// LOCAL technology dictionary before being sent to Electron and the relay.
// No microphone processing, external STT, delay, or new network service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const overlaySource = fs.readFileSync(path.join(__dirname, '../overlay/overlay.js'), 'utf8');
const { correctTechnologyTerms } = require('../transcriber/technologyCorrections');
const handlers = {};
const received = [];
const uploaded = [];
const ctx = vm.createContext({
  ipcMain: { on: (name, fn) => { handlers[name] = fn; } },
  overlayWindow: { isDestroyed: () => false, webContents: { send: (name, data) => received.push({ name, data }) } },
  hostCaptionsAuthorized: true, started: false, lastHostLocalCaptionAt: 0,
  publishHostCaption: c => uploaded.push(c), sendLocalCaption: c => uploaded.push(c),
  correctTechnologyTerms, localCaptionReady: false, localCaptionLastAt: 0,
  localCaptionLastText: '', localCaptionLastWasFinal: false,
  audibleWithoutCaptionSince: 0, deepgramFallbackActive: false,
  captionFallbackTimer: null, sendTranscriptionSource: () => {}, sendStatus: () => {},
  clearTimeout, Date, console
});
function install(startMarker, endMarker) {
  const a = source.indexOf(startMarker), b = source.indexOf(endMarker, a);
  assert(a >= 0 && b > a);
  vm.runInContext(source.slice(a, b), ctx);
}
install("ipcMain.on('host-caption-message',", "\nipcMain.on('meet-caption-message',");
install("ipcMain.on('meet-caption-message',", "\nipcMain.handle('send-meet-chat-message'");
handlers['host-caption-message']({}, { text: 'We deploy land graph and kubernet', isFinal: false });
assert.equal(uploaded[0].text, 'We deploy LangGraph and Kubernetes');
assert.equal(received.find(x => x.name === 'transcript').data.text, 'We deploy LangGraph and Kubernetes');
ctx.started = true;
handlers['meet-caption-message']({}, { text: 'Our land chain uses terrafrom', isFinal: true });
assert.equal(uploaded[1].text, 'Our LangChain uses Terraform');
assert.equal(received.filter(x => x.name === 'transcript')[1].data.text, 'Our LangChain uses Terraform');
// Verify the exact renderer receives already-corrected text and retains it.
const start = overlaySource.indexOf('// Displayed captions are append-only');
const end = overlaySource.indexOf('\nfunction showJoinError(', start);
const el = {
  nodes: [], scrollHeight: 400, clientHeight: 40, scrollTop: 0,
  set textContent(_) { this.nodes = []; }, append(node) { this.nodes.push(node); },
  contains(node) { return this.nodes.includes(node); }
};
const screen = vm.createContext({ transcriptEl: el, document: { createTextNode: nodeValue => ({ nodeValue }) },
  Date, Math, transcriptAutoScroll: true, transcriptUserScrollIntent: false, transcriptScrollTopLock: 0 });
vm.runInContext(overlaySource.slice(start,end), screen);
const host = received.find(x => x.name === 'transcript').data;
screen.renderTranscript(host);
const first = el.nodes[1];
screen.renderTranscript({ ...host, text: 'We deploy LangGraph and Kubernetes in the cluster', isFinal: true });
assert(el.nodes.includes(first), 'the initial corrected caption never disappears');
assert(el.nodes.map(n => n.nodeValue).join('').includes('LangGraph and Kubernetes'));
assert(source.includes('const DEEPGRAM_FALLBACK_ENABLED = false'));
console.log(JSON.stringify({ ok: true, actualDesktopHostAndPINHandoff: true,
  real84TermCorrectionAppliedBeforeIPC: true, visibleWordsPermanent: true, deepgramOff: true }));
