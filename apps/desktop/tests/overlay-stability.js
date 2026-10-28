const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../overlay/overlay.js'), 'utf8');
const start = source.indexOf('// Completed lines are append-only DOM nodes.');
const end = source.indexOf('\nfunction showJoinError(', start);
assert(start > 0 && end > start);
let clears = 0, removals = 0;
const transcriptEl = {
  children: [], clientHeight: 40, _scrollTop: 0, callbacks: {},
  get scrollHeight() { return Math.max(200, this.children.map(n => n.nodeValue || '').join('').length * 3); },
  get scrollTop() { return this._scrollTop; },
  set scrollTop(value) { this._scrollTop = Number(value); },
  set textContent(_) { clears++; this.children = []; },
  append(...items) { this.children.push(...items); },
  contains(item) { return this.children.includes(item); },
  removeChild(item) { removals++; const index = this.children.indexOf(item); if (index >= 0) this.children.splice(index, 1); },
  insertBefore(item, next) { const index = this.children.indexOf(next); assert(index >= 0); this.children.splice(index, 0, item); },
  addEventListener(type, callback) { this.callbacks[type] = callback; }
};
const context = {
  transcriptEl, document: { createTextNode(value) { return { nodeValue: value }; } },
  finalLines: [], interimText: '', transcriptAutoScroll: true,
  transcriptRenderRestoring: false, transcriptUserScrollIntent: false,
  transcriptScrollTopLock: 0, Math
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
function render(finals, interim) {
  context.finalLines = finals;
  context.interimText = interim;
  vm.runInContext('renderTranscript()', context);
}
function visible() { return transcriptEl.children.map(n => n.nodeValue).join(''); }
render([], 'I wanted to see');
assert.equal(visible(), 'I wanted to see');
const firstWord = transcriptEl.children.find(n => n.nodeValue === 'I wanted to see');
render([], 'I wanted to see our roles');
assert(visible().includes('I wanted to see our roles'));
render(['I wanted to see our roles'], '');
assert.equal(visible(), 'I wanted to see our roles', 'final must not replay or hide interim text');
assert(transcriptEl.contains(firstWord), 'finalization keeps the original printed words');
assert.equal(firstWord.nodeValue, 'I wanted to see');
render(['I wanted to see our roles'], 'Next sentence here');
assert(visible().endsWith('\nNext sentence here'));
const nextNode = transcriptEl.children.find(n => n.nodeValue === '\nNext sentence here');
render(['I wanted to see our roles'], 'Next sentence correction here');
assert(transcriptEl.contains(nextNode), 'recognition corrections must not remove settled words');
assert.equal(nextNode.nodeValue, '\nNext sentence here');
render(['I wanted to see our roles', 'Next sentence here'], '');
assert(transcriptEl.contains(nextNode), 'finalization must preserve next sentence nodes');
for (let i = 3; i <= 160; i++) {
  const lines = ['I wanted to see our roles', 'Next sentence here'];
  for (let j = 3; j <= i; j++) lines.push(`Sentence number ${j}`);
  render(lines, '');
}
assert.equal(clears, 1, '100+ lines must never trigger transcript clearing');
assert.equal(removals, 0, 'normal caption updates must never remove printed words');
assert(transcriptEl.contains(firstWord));
assert(transcriptEl.contains(nextNode));
assert.equal(vm.runInContext('renderedFinalLines.length', context), 160);
// Test the real scroll event handler: programmatic auto-follow must not be
// misidentified as a manual scroll-away (the source of delayed/batched display).
const scrollStart = source.indexOf("transcriptEl.addEventListener('scroll', () => {");
const scrollEnd = source.indexOf('\nfunction getRandomGuestName()', scrollStart);
assert(scrollStart >= 0 && scrollEnd > scrollStart);
const helperStart = source.indexOf('function transcriptIsNearBottom()');
const helperEnd = source.indexOf('// Wheel is the primary reading interaction.', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart);
context.TRANSCRIPT_BOTTOM_THRESHOLD_PX = 24;
vm.runInContext(source.slice(helperStart, helperEnd), context);
vm.runInContext(source.slice(scrollStart, scrollEnd), context);
transcriptEl.scrollTop = 100; // Simulate a delayed native scroll event.
transcriptEl.callbacks.scroll();
assert.equal(context.transcriptAutoScroll, true, 'programmatic scroll cannot disable auto-follow');
render([...context.finalLines, 'After two minutes still live'], '');
assert.equal(transcriptEl.scrollTop, transcriptEl.scrollHeight, 'caption remains visible instantly');
context.transcriptUserScrollIntent = true;
transcriptEl.scrollTop = 0;
transcriptEl.callbacks.scroll();
assert.equal(context.transcriptAutoScroll, false, 'explicit manual scroll still pauses follow');
context.transcriptUserScrollIntent = false;
render([...context.finalLines, 'Keep historical scroll still'], '');
assert.equal(transcriptEl.scrollTop, 0, 'manual scroll position remains stable');
render([], '');
assert.equal(clears, 2, 'explicit new session reset may clear old text');
// The native topmost guard must never reorder the protected overlay every 250 ms.
const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const guardStart = mainSource.indexOf('function enforceOverlayPrivacyAndTopmost()');
const guardEnd = mainSource.indexOf('function startOverlayTopmostGuard()', guardStart);
assert(guardStart > 0 && guardEnd > guardStart);
let raises = 0, topmostChanges = 0;
const fakeOverlay = {
  isDestroyed: () => false, isAlwaysOnTop: () => true, isVisible: () => true,
  setContentProtection: () => {}, setVisibleOnAllWorkspaces: () => {},
  setAlwaysOnTop: () => { topmostChanges++; },
  moveTop: () => { raises++; }
};
const guardContext = { overlayWindow: fakeOverlay, overlayPrivacyInitializedFor: null };
vm.createContext(guardContext);
vm.runInContext(mainSource.slice(guardStart, guardEnd), guardContext);
for (let i = 0; i < 100; i++) vm.runInContext('enforceOverlayPrivacyAndTopmost()', guardContext);
assert.equal(raises, 0, 'native window must not move up 4 times per second');
assert.equal(topmostChanges, 0, 'already topmost window must not be reset');
assert.match(mainSource, /if \(type === 'session_ended' \|\| type === 'limit_reached'\) \{\s*hostCaptionsAuthorized = false;\s*leaveHost\(\);/,
  'only confirmed session end may reset the host caption view');
console.log(JSON.stringify({ ok: true, finalizedNodesPreserved: true, linesRetained: 160,
  noCaptionRemovals: true, autoFollowStable: true, manualScrollStable: true,
  nativeWindowNotRaised: true, authFailureDoesNotClearHost: true }));
