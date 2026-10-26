// Behaviour test for the silence guard: extracts the guard from main.js and runs it with stubs.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const block = src.split('// SILENCE-GUARD-BEGIN')[1].split('// SILENCE-GUARD-END')[0];
assert(/ZAPPER_SILENCE_PROMPT_MS\) \|\| 10 \* 60 \* 1000/.test(block) && /ZAPPER_SILENCE_END_MS\) \|\| 15 \* 60 \* 1000/.test(block), 'defaults must be 10 and 15 minutes');

process.env.ZAPPER_SILENCE_PROMPT_MS = '400';
process.env.ZAPPER_SILENCE_END_MS = '900';
process.env.ZAPPER_SILENCE_EXIT_MS = '50';
const sent = [];
const handlers = {};
const events = [];
const ctx = {
  process, console, setTimeout, setInterval, clearInterval, Date, Math, Number, String, Boolean, Promise, Error,
  require: m => require(m),
  path, fs,
  app: { getPath: () => require('os').tmpdir() },
  BrowserWindow: class { constructor() { this.webContents = { printToPDF: async () => Buffer.from('%PDF-fake'), }; } async loadURL() {} destroy() {} },
  ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
  overlayWindow: { isDestroyed: () => false, isVisible: () => false, showInactive: () => events.push('show'), flashFrame() {}, webContents: { send: (c, d) => sent.push([c, d]) } },
  started: true,
  localCaptionLastText: '', localCaptionLastWasFinal: true, localCaptionLastAt: 0,
  enforceOverlayPrivacyAndTopmost() {},
  stopActiveCaptureRuntime: async () => { events.push('stopCapture'); ctx.started = false; },
  leaveHost: () => events.push('leaveHost'),
  terminateApplicationCompletely: async () => { events.push('exit'); },
};
vm.createContext(ctx);
vm.runInContext(block + '\n;globalThis.__t = { noteSpeechActivity, startSilenceMonitor, stopSilenceMonitor, get shown() { return silencePromptShown; } };', ctx);
const t = ctx.__t;
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  t.startSilenceMonitor();
  t.noteSpeechActivity('hello team', true);
  await wait(250); t.noteSpeechActivity('still talking', true);
  await wait(300);
  assert(!sent.some(([c]) => c === 'silence-prompt'), 'no prompt while people keep speaking');
  await wait(500);
  assert(sent.some(([c]) => c === 'silence-prompt'), 'prompt after the silent period');
  assert(events.includes('show'), 'hidden overlay must be brought back for the prompt');
  await handlers['silence-continue']();
  assert(sent.some(([c]) => c === 'silence-clear'), 'Continue clears the prompt');
  assert(!events.includes('stopCapture'), 'Continue keeps the session alive');
  await wait(1500); // silent again, nobody answers
  assert(events.includes('stopCapture') && events.includes('leaveHost'), 'no answer disconnects capture and host');
  assert(sent.some(([c, d]) => c === 'session-ended' && /Transcript saved/.test(d)), 'UI is told the session ended and where the PDF is');
  await wait(200);
  assert(events.includes('exit'), 'app exits after the notice');
  const dir = path.join(require('os').tmpdir(), 'Zapper Transcripts');
  const pdfs = fs.readdirSync(dir).filter(f => f.endsWith('.pdf'));
  assert(pdfs.length >= 1, 'PDF written');
  console.log(JSON.stringify({ ok: true, silenceGuard: true, pdf: pdfs[pdfs.length - 1] }));
})().catch(e => { console.error(e); process.exit(1); });
