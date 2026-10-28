'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { correctMeetCaptionText: fix } = require('../transcriber/captionCorrections');

const examples = [
  ['I wanted Tu Si', 'I wanted to see'],
  ['I wanted Tu', 'I wanted to'],
  ['I wanted to Si', 'I wanted to see'],
  ['Coming Tu my rolls and responsibilities.', 'Coming to my roles and responsibilities.'],
  ['Coming Tu my rolls', 'Coming to my roles'],
  ['Thank u for joining the call.', 'Thank you for joining the call.'],
  ['Can u hear me?', 'Can you hear me?'],
  ['What are you doing on a daily bases?', 'What are you doing on a daily basis?'],
  ['I work on a daily bases', 'I work on a daily basis'],
  ['I wanted to see', 'I wanted to see'],
  ['Can you please confirm the rolls are fresh?', 'Can you please confirm the rolls are fresh?'],
  ['We met Tu Si yesterday', 'We met Tu Si yesterday'],
  ['I saw Si at the meeting', 'I saw Si at the meeting'],
  ['Roles and responsibilities', 'Roles and responsibilities'],
  ['Thank you for joining!', 'Thank you for joining!'],
  ['Aise hi what I wanted', 'Aise hi what I wanted'],
  ['I wanted to see b', 'I wanted to see b'],
];
for (const [given, expected] of examples) {
  assert.equal(fix(given), expected, JSON.stringify(given));
  assert.equal(fix(fix(given)), expected, 'all corrections must be idempotent');
}
assert.equal(fix(''), '');
assert.equal(fix(null), null);
assert.equal(fix(undefined), undefined);

// Growing Google caption prefixes must never rewrite a previously painted
// word: v1.0.8 deliberately makes visible words immutable.
const growing = [
  'I wanted Tu Si and I can hear you',
  'Coming Tu my rolls and responsibilities',
  'Thank u for joining the call',
  'I work on a daily bases every week',
];
for (const example of growing) {
  const words = example.split(' ');
  let last = '';
  for (let i = 1; i <= words.length; i++) {
    const next = fix(words.slice(0, i).join(' '));
    assert(!last || next === last || next.startsWith(last + ' '),
      `prefix stability broken by ${JSON.stringify(next)} after ${JSON.stringify(last)}`);
    last = next;
  }
}

// The same corrected text must feed host/local view, authorized relay and
// peer relay; no changes to the collector's 120ms/240ms stabilization.
const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const hostPath = main.slice(main.indexOf("ipcMain.on('host-caption-message'"), main.indexOf("ipcMain.on('meet-caption-message'"));
const pinPath = main.slice(main.indexOf("ipcMain.on('meet-caption-message'"), main.indexOf("ipcMain.handle('send-meet-chat-message'"));
assert(hostPath.indexOf('correctMeetCaptionText(') >= 0 && hostPath.indexOf('correctMeetCaptionText(') < hostPath.indexOf('publishHostCaption(payload)'), 'correct before host relay');
assert(pinPath.includes('const text = correctMeetCaptionText('), 'correct before local view and PIN relay');
assert(pinPath.includes('sendLocalCaption({ text,'), 'corrected PIN text must reach authorized relay');
assert(main.includes('text: correctMeetCaptionText(payload.text)'), 'peer relay correction for older desktop peers');
assert(main.includes('text: correctMeetCaptionText(String(caption.text))'), 'host peer fallback correction');
assert(main.includes('const DEEPGRAM_FALLBACK_ENABLED = false'), 'Deepgram remains OFF');
const hostCollector = fs.readFileSync(path.join(__dirname, '../meet-controller/host-caption-preload.js'), 'utf8');
const participantCollector = fs.readFileSync(path.join(__dirname, '../meet-controller/meet-preload.js'), 'utf8');
assert(hostCollector.includes('const now = Date.now()') && hostCollector.includes('>= 240'), 'host stabilization unchanged');
assert(participantCollector.includes('const CAPTION_STABLE_MS = 240'), 'participant stabilization unchanged');

// Synchronous processing cost, excluding DOM/Google/transport. This does not
// claim end-to-end sub-second performance; a live call is still required.
const sample = 'I wanted Tu Si. Coming Tu my rolls and responsibilities.';
const start = performance.now();
for (let i = 0; i < 30000; i++) fix(sample);
const elapsed = performance.now() - start;
const averageMs = elapsed / 30000;
assert(averageMs < 0.5, `excessive synchronous correction overhead: ${averageMs.toFixed(4)}ms`);
console.log(JSON.stringify({ ok: true, cases: examples.length, growingPrefixes: true,
  relayWiringChecked: true, deepgramOff: true, averageCorrectionMs: Number(averageMs.toFixed(5)) }));
