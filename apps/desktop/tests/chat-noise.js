const fs = require('fs');
const assert = require('assert');
const source = fs.readFileSync(require('path').join(__dirname, '../meet-controller/meet-preload.js'), 'utf8');
const match = source.match(/function isMeetInactivityPrompt\(value\) \{[\s\S]*?\n  \}/);
assert(match, 'Google Meet inactivity prompt filter must exist');
const keyText = v => String(v || '').toLowerCase().trim().replace(/\s+/g, ' ');
const filter = new Function('keyText', `return (${match[0]});`)(keyText);
for (const text of ['Are you still there?', 'Leave now', 'Stay in the call', 'To stop seeing this, go to Settings > General.', 'Are you still there? Leave now Stay in the call']) {
  assert(filter(text), `Google system prompt leaked to chat: ${text}`);
}
for (const text of ['Can we continue the meeting?', 'Please leave now if you need to', 'The client is still there in the lobby', 'Stay in this channel', 'Project status update']) {
  assert(!filter(text), `Ordinary chat was incorrectly removed: ${text}`);
}
console.log(JSON.stringify({ok:true,exactSystemPromptsFiltered:true,ordinaryMessagesPreserved:true}));

// Automatic Meet / Zapper notices must never be delivered as chat; real messages must pass.
for (const file of ['../meet-controller/meet-preload.js', '../overlay/overlay.js']) {
  const src = fs.readFileSync(require('path').join(__dirname, file), 'utf8');
  const a = src.indexOf('const MEET_SYSTEM_CHAT_RE');
  const b = src.indexOf('MEET_SYSTEM_CHAT_RE.test(t);');
  assert(a >= 0 && b > a, `${file} must contain the Meet system-message filter`);
  const isSystem = new Function(`${src.slice(a, b)}MEET_SYSTEM_CHAT_RE.test(t); }\nreturn isMeetSystemChatText;`.replace(/^/, ''))();
  for (const text of ['Messages can only be seen by people in the call and are deleted when the call ends', 'Alex joined the call', 'chat here', 'Continuous chat is turned off', '10:41 AM | izn-pmnq-hhk', 'Priya raised their hand', 'Recording started']) {
    assert(isSystem(text), `${file}: automatic notice must be filtered: ${text}`);
  }
  for (const text of ['hello host, can you hear me', 'yes loud and clear', 'I joined late, sorry', 'what is the agenda today', 'ok', 'the meeting is at 5', 'left side looks good']) {
    assert(!isSystem(text), `${file}: real chat must pass: ${text}`);
  }
}
assert(!fs.readFileSync(require('path').join(__dirname, '../meet-controller/meet-preload.js'), 'utf8').includes("sendChatToMeet('chat here')"), 'Zapper must not post its own chat message');
console.log(JSON.stringify({ ok: true, noAutomaticChatMessages: true }));
