const assert = require('node:assert/strict');
const { parseRows, system } = require('../meet-controller/meet-chat-rows');
const raw = [
  'You', '10:31 AM', 'Host announcement to all participants',
  'Alice Kumar', '10:32 AM', 'I have reviewed it',
  'Bob', '10:33 AM', 'Are you still there?',
  'Bob', '10:34 AM', 'We should stay in the call tomorrow',
  'You', '10:35 AM', 'A'.repeat(12000)
].join('\n');
const rows = parseRows(raw);
assert.deepEqual(rows.map(r => r.sender), ['Host', 'Alice Kumar', 'Bob', 'Host']);
assert.equal(rows[0].message, 'Host announcement to all participants');
assert.equal(rows[1].message, 'I have reviewed it');
assert.equal(rows[2].message, 'We should stay in the call tomorrow');
assert.equal(rows[3].message.length, 12000, 'long messages are not truncated by Zapper');
for (const prompt of ['Are you still there?', 'Stay in the call', 'Leave now', 'The call ended because everyone left', 'Chat here']) {
  assert(system(prompt), `System text forwarded: ${prompt}`);
}
assert(!system('Leave now if you need to attend the other meeting'));
console.log(JSON.stringify({ ok: true, hostAndParticipantRows: true, noMeetSystemPrompts: true, noCustomLengthCap: true }));
