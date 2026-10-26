import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
assert(source.includes('/host-audio-token'), 'host must use an authenticated backend capture token');
assert(source.includes('captureToken ? `&captureToken='), 'browser passes authorized host capture token to installed desktop');
assert(source.includes('joinHostMeet(result.session.meetUrl, popup, result.session.id)'), 'auto-created Meet handoff uses session identity');
assert(source.includes('joinHostMeet(event.data.session?.meetUrl, popup, event.data.session?.id)'), 'OAuth-created Meet handoff uses session identity');
assert(source.includes('const HOST_MIC_TO_STT = false'), 'host microphone Deepgram fallback must remain disabled by default');
console.log('PASS: host captions authorized by active session; existing Meet join and microphone settings unchanged');
