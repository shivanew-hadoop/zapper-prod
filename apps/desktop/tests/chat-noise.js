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
