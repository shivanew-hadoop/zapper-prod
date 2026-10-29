'use strict';
// Reproduces the real host startup order: host state arrives, then config finishes.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const src = fs.readFileSync(path.join(__dirname, '../overlay/overlay.js'),'utf8');
const begin = src.indexOf('function showJoin({ force = false } = {}) {');
const end = src.indexOf('\nfunction setSessionInfo(',begin);
assert(begin>=0 && end>begin);
const functionText = src.slice(begin,end);
function makeClassList() {
  const names = new Set();
  return {add(name){names.add(name);},remove(name){names.delete(name);},toggle(name,active){if(active)names.add(name);else names.delete(name);},contains(name){return names.has(name);}};
}
const state = {
  hostMirrorActive: true, activeSessionToken: '', currentPanel: 'live',
  appEl: { classList: makeClassList() }, joinPanel: { classList: makeClassList() },
  livePanel: { classList: makeClassList() }, leaveBtn: { classList: makeClassList() },
  backToLiveBtn: { classList: makeClassList() }
};
state.appEl.classList.add('session-active');
state.joinPanel.classList.add('hidden');
vm.createContext(state);
vm.runInContext(functionText,state);
const reset = vm.runInContext('showJoin()',state);
assert.equal(reset,false,'late config may NOT hide host live view');
assert.equal(state.currentPanel,'live');
assert(state.joinPanel.classList.contains('hidden'));
assert(!state.livePanel.classList.contains('hidden'));
state.hostMirrorActive=false;
assert.equal(vm.runInContext('showJoin({force:true})',state),true,'host End must still restore PIN panel');
assert.equal(state.currentPanel,'join');
assert(state.livePanel.classList.contains('hidden'));
console.log(JSON.stringify({ok:true, hostVisibleAfterLateConfig:true, endRestoresJoin:true}));
