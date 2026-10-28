'use strict';
// Regression: v1.0.12 host/relay/session code stays intact; only a PIN
// participant's visible captions become local-first, with no added timers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const handlers = {};
const shown = [];
const saved = [];
const chats = [];
const statuses = [];
let now = 100000;
let remote = null;
let ended = false;
const sandbox = {
  ipcMain: { on: (name, cb) => { handlers[name] = cb; } },
  started: true,
  localCaptionReady: false, localCaptionLastAt: 0,
  localCaptionLastText: '', localCaptionLastWasFinal: false,
  hostRelayLastAt: 0, audibleWithoutCaptionSince: 0,
  deepgramFallbackActive: false, captionFallbackTimer: null,
  DEEPGRAM_FALLBACK_ENABLED: false, transcriptLimitReached: false,
  overlayWindow: {
    isDestroyed: () => false,
    webContents: { send: (name, data) => shown.push({ name, data }) }
  },
  correctTechnologyTerms: x => String(x).replace(/land graph/ig, 'LangGraph'),
  sendLocalCaption: payload => { saved.push(payload); return true; },
  sendTranscriptionSource: () => {}, sendStatus: () => {},
  clearTimeout: () => {}, Date: { now: () => now },
  BACKEND_URL: 'https://example.invalid', sessionToken: 'valid-pin', googleEmail: '',
  startRemoteTranscriptStream: (_opts, cb) => { remote = cb; },
  sendMeetChat: payload => chats.push(payload),
  stopActiveCaptureRuntime: () => { ended = true; return Promise.resolve(); },
  stopRemoteTranscriptStream: () => {},
  console
};
vm.createContext(sandbox);
const localStart = source.indexOf("ipcMain.on('meet-caption-message',");
const localEnd = source.indexOf("\nipcMain.handle('send-meet-chat-message'", localStart);
assert(localStart >= 0 && localEnd > localStart);
vm.runInContext(source.slice(localStart, localEnd), sandbox);
const remoteStart = source.indexOf('startRemoteTranscriptStream({ backendUrl: BACKEND_URL, sessionToken, googleEmail }, payload => {');
const remoteEnd = source.indexOf('\n    });\n\n    onAudioChunk(', remoteStart);
assert(remoteStart >= 0 && remoteEnd > remoteStart, 'locate the actual v1.0.12 socket callback');
vm.runInContext(source.slice(remoteStart, remoteEnd + '\n    });'.length), sandbox);
assert.equal(typeof remote, 'function');
function captions() { return shown.filter(m => m.name === 'transcript'); }
// Before local Meet yields captions, the established authorized host relay works.
remote({ fromHost: true, text: 'Fallback before admission', isFinal: false, source: 'meet-captions' });
assert.equal(captions().length, 1);
assert.equal(captions()[0].data.origin, 'host-relay');
// Local Meet must display immediately EVEN if the host sent a caption just now.
now += 25;
handlers['meet-caption-message']({}, { text: 'land graph is live', isFinal: false, capturedAt: now });
assert.equal(captions().length, 2);
assert.equal(captions()[1].data.text, 'LangGraph is live');
assert.equal(captions()[1].data.origin, 'local-meet');
assert.equal(saved.length, 1, 'local captions still go to Railway for persistence');
// A quiet spell must NOT permanently disable the authorized caption fallback.
// Local speech always displays immediately; host relay recovers the view when
// the participant Meet collector stalls for five seconds or longer.
now += 2500;
remote({ fromHost: true, text: 'Ignore relay while local works', isFinal: false, source: 'meet-captions' });
assert.equal(captions().length, 2, 'recent local captions keep priority');
now += 2600;
remote({ fromHost: true, text: 'Remote keeps captions moving', isFinal: true, source: 'meet-captions' });
assert.equal(captions().length, 3, 'stalled local Meet must recover through relay');
assert.equal(captions()[2].data.origin, 'host-relay');
// New local words are immediate without a relay round-trip.
handlers['meet-caption-message']({}, { text: 'Kubernetes has arrived', isFinal: true, capturedAt: now });
assert.equal(captions().length, 4);
assert.equal(captions()[3].data.text, 'Kubernetes has arrived');
// Chat and confirmed backend session end are unaffected by caption priority.
remote({ type: 'meet_chat', message: 'Actual message', sender: 'Participant' });
assert.equal(chats.length, 1);
remote({ type: 'session_ended', text: 'Host ended session' });
assert.equal(ended, true);
assert(shown.some(m => m.name === 'session-ended'));
// Baseline session reset must still clear local ownership for the next PIN.
const resetStart = source.indexOf('function resetRuntimeFlags() {');
const resetEnd = source.indexOf('\nfunction normalizeBackendHttpUrl(', resetStart);
assert(resetStart >= 0 && resetEnd > resetStart);
sandbox.stopSessionStatusPoller = () => {};
vm.runInContext(source.slice(resetStart, resetEnd) + '\nresetRuntimeFlags();', sandbox);
assert.equal(sandbox.localCaptionReady, false);
remote({ fromHost: true, text: 'New session fallback', isFinal: false, source: 'meet-captions' });
assert.equal(captions().length, 5);
assert.equal(captions()[4].data.origin, 'host-relay');
// Do not alter the Meet observer stabilization or the host relay logic.
assert.match(fs.readFileSync(path.join(__dirname, '../meet-controller/meet-preload.js'), 'utf8'), /CAPTION_STABLE_MS = 240/);
assert.match(source, /publishHostCaption\(\{ \.\.\.payload, text \}\)/);
assert.match(source, /const DEEPGRAM_FALLBACK_ENABLED = false/);
console.log(JSON.stringify({ ok: true, baseline: '1.0.12', localIpcImmediate: true, relayFallbackBeforeLocal: true,
  staleLocalRelayRecovery: true, backendPersistencePreserved: true, chatAndSessionEndPreserved: true }));
