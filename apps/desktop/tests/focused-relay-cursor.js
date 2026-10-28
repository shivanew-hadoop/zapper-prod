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
// A temporary token failure must not shut down local Meet caption rendering.
const onEndedStart = mainSource.indexOf('onEnded: (reason, type) => {');
const onEndedEnd = mainSource.indexOf('\n        }', onEndedStart);
const onEndedHandler = mainSource.slice(onEndedStart, onEndedEnd);
assert(onEndedHandler.indexOf('hostCaptionsAuthorized = false;') > onEndedHandler.indexOf("type !== 'session_ended'"),
  'local host captions remain enabled when only peer relay authorization fails');
hostRelay.stopHostCaptionRelay();

// Previous builds chased the pointer with a SECOND transparent, always-on-top
// BrowserWindow and raised the overlay every 250 ms. The two independent
// Windows surfaces caused full-window flashing under Electron on Windows.
const guardStart = mainSource.indexOf('function enforceOverlayPrivacyAndTopmost()');
const guardEnd = mainSource.indexOf('function stopOverlayManualResize()', guardStart);
assert(guardStart >= 0 && guardEnd > guardStart);
const guard = mainSource.slice(guardStart, guardEnd);
assert(!/\.moveTop\(/.test(guard), 'topmost health guard never raises the native window');
assert(!guard.includes('setBounds('), 'topmost health guard never changes window geometry');
assert(!mainSource.includes('createPrivateCursorWindow'), 'second native cursor window removed');
assert(!mainSource.includes('startOverlayPointerGuard'), '16ms native pointer monitor removed');
assert(!mainSource.includes('overlayWindow.show();\n      overlayWindow.focus();'),
  'browser-originated host control URLs must not continually refocus overlay');
assert.match(mainSource, /setInterval\(enforceOverlayPrivacyAndTopmost, 5000\)/,
  'slow conditional guard keeps topmost protection without compositor spam');
const overlayJS = fs.readFileSync(path.join(__dirname, '../overlay/overlay.js'), 'utf8');
const overlayCSS = fs.readFileSync(path.join(__dirname, '../overlay/overlay.css'), 'utf8');
assert.match(overlayJS, /document\.addEventListener\('pointermove'/,
  'protected renderer manages its own cursor without another window');
assert.match(overlayCSS, /\.privateCursor\.visible \{ display: block; \}/);
assert(!overlayCSS.includes('.privateCursor { display: none !important; }'));

// Exercise the native guard with a simulated Windows overlay. Rechecking must
// not cause capture-affinity or z-order changes after initial setup.
let protections = 0, workspaceCalls = 0, topmostCalls = 0;
const nativeOverlay = {
  isDestroyed: () => false,
  setContentProtection() { protections++; },
  setVisibleOnAllWorkspaces() { workspaceCalls++; },
  isAlwaysOnTop: () => true,
  setAlwaysOnTop() { topmostCalls++; },
  moveTop() { throw new Error('full-window flash from moveTop'); },
};
const nativeContext = { overlayWindow: nativeOverlay, setInterval() {}, clearInterval() {} };
vm.createContext(nativeContext);
vm.runInContext(mainSource.slice(mainSource.indexOf('let overlayPrivacyInitializedFor = null;'), guardEnd), nativeContext);
for (let i = 0; i < 100; i++) vm.runInContext('enforceOverlayPrivacyAndTopmost()', nativeContext);
assert.equal(protections, 1);
assert.equal(workspaceCalls, 1);
assert.equal(topmostCalls, 0);

// In-panel cursor follows only DOM pointer events, no native surface moves.
const eventHandlers = new Map();
const cursor = {style: {}, classList: {classes: new Set(), add(v){this.classes.add(v);}, remove(v){this.classes.delete(v);} }};
const htmlElement = {classList: {add() {}}};
const doc = {
  getElementById: () => cursor,
  documentElement: htmlElement,
  addEventListener: (event, cb) => eventHandlers.set(event, cb)
};
const win = {innerWidth: 600, innerHeight: 300, addEventListener: (event, cb) => eventHandlers.set(`win-${event}`, cb)};
const pointerStart = overlayJS.indexOf('function initPrivateCursor()');
const pointerEnd = overlayJS.indexOf('\n// Resize through renderer-owned', pointerStart);
assert(pointerStart >= 0 && pointerEnd > pointerStart);
const pointerContext = { document: doc, window: win, privateCursor: null, Math };
vm.createContext(pointerContext);
vm.runInContext(overlayJS.slice(pointerStart, pointerEnd), pointerContext);
eventHandlers.get('pointermove')({clientX: 120, clientY: 80});
assert.equal(cursor.style.transform, 'translate3d(120px, 80px, 0)');
assert(cursor.classList.classes.has('visible'));
eventHandlers.get('pointerleave')();
assert(!cursor.classList.classes.has('visible'));

const participantSource = fs.readFileSync(path.join(__dirname, '../meet-controller/meet-preload.js'), 'utf8');
assert(participantSource.includes('if (!input) { knownChatRoot = null; return null; }'));
assert(!participantSource.includes('if (!root) { scanAnyVisibleChatBlocks(); return; }'));
assert(!participantSource.includes('if (!rows.length) rows.push(...parseRootStream(root));'));
console.log(JSON.stringify({ ok: true, hostFallbackWired: true, cursorInsideProtectedOverlay: true, noNativeRecompositing: true, noPageWideChatScan: true }));
