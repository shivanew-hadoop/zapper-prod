const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Module = require('node:module');
const EventEmitter = require('node:events');

class MockWS extends EventEmitter {
  static OPEN = 1;
  constructor() { super(); this.readyState = 0; this.bufferedAmount = 0; MockWS.instance = this; }
  send() {}
  close() { this.readyState = 3; }
}
const original = Module._load;
Module._load = function(id, ...args) { return id === 'ws' ? MockWS : original.call(this, id, ...args); };
const hostRelay = require('../transcriber/hostCaptionRelay');
Module._load = original;
const received = [];
assert(hostRelay.startHostCaptionRelay({ backendUrl: 'https://api.example.test', captureToken: 'valid-host-token', onCaption: m => received.push(m) }));
MockWS.instance.readyState = MockWS.OPEN;
MockWS.instance.emit('open');
MockWS.instance.emit('message', JSON.stringify({type:'transcript', text:'participant continues while host Meet stalled', isFinal:false, fromHost:false}));
assert.deepEqual(received.map(item=>item.text), ['participant continues while host Meet stalled'],
  'host caption socket must deliver an authorized participant relay as a fallback');
const relaySource = fs.readFileSync(path.join(__dirname, '../transcriber/hostCaptionRelay.js'), 'utf8');
assert.match(relaySource, /message\.type === 'transcript' && message\.text\) onCaption\(message\)/);
const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
assert.match(mainSource, /Date\.now\(\) - lastHostLocalCaptionAt < 2000/);
assert.match(mainSource, /origin: 'peer-relay'/);
hostRelay.stopHostCaptionRelay();

let boundsChanged = 0, protectionChanged = 0, topmostChanged = 0, showCount = 0, hideCount = 0;
const fakeCursor = {
  destroyed: false, visible: false,
  isDestroyed() { return this.destroyed; }, isVisible() { return this.visible; },
  setBounds() { boundsChanged++; }, setContentProtection() { protectionChanged++; },
  setAlwaysOnTop() { topmostChanged++; }, setVisibleOnAllWorkspaces() {},
  setIgnoreMouseEvents() {}, loadURL() {}, on() {},
  moveTop() {}, showInactive() { this.visible = true; showCount++; }, hide() { this.visible = false; hideCount++; },
  destroy() { this.destroyed = true; }
};
const start = mainSource.indexOf('function createPrivateCursorWindow()');
const end = mainSource.indexOf('function startOverlayPointerGuard()', start);
assert(start >= 0 && end > start);
const ctx = { privateCursorWindow: null, BrowserWindow: function() { return fakeCursor; }, encodeURIComponent, Math };
vm.createContext(ctx);
vm.runInContext(mainSource.slice(start, end), ctx);
vm.runInContext(`showPrivateCursorAt({ x: 100, y: 200 });
  showPrivateCursorAt({ x: 100, y: 200 });
  showPrivateCursorAt({ x: 101, y: 200 });`, ctx);
assert.equal(boundsChanged, 2, 'still cursor must not cause native window repaint');
assert.equal(protectionChanged, 1, 'capture protection configured once, not every frame');
assert.equal(topmostChanged, 1, 'topmost flag configured once, not every frame');
assert.equal(showCount, 1, 'cursor must not be shown again every 16ms');
vm.runInContext('hidePrivateCursorWindow(); hidePrivateCursorWindow();', ctx);
assert.equal(hideCount, 1, 'pointer should not hide twice at the same boundary');
assert(!mainSource.includes("overlayWindow.webContents.send('private-pointer-position'"), 'no unused per-frame cursor IPC');

// The 250 ms native guard must never reposition or raise the overlay.
const guardStart = mainSource.indexOf('function enforceOverlayPrivacyAndTopmost()');
const guardEnd = mainSource.indexOf('function startOverlayTopmostGuard()', guardStart);
assert(guardStart >= 0 && guardEnd > guardStart);
assert(!mainSource.slice(guardStart, guardEnd).includes('overlayWindow.moveTop('), 'native overlay must not be raised on the periodic guard');
const participantSource = fs.readFileSync(path.join(__dirname, '../meet-controller/meet-preload.js'), 'utf8');
assert(participantSource.includes('if (!input) { knownChatRoot = null; return null; }'));
assert(!participantSource.includes('if (!root) { scanAnyVisibleChatBlocks(); return; }'));
assert(!participantSource.includes('if (!rows.length) rows.push(...parseRootStream(root));'));
console.log(JSON.stringify({ ok: true, hostFallbackWired: true, cursorStable: true, noPageWideChatScan: true }));
