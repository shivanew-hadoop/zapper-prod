const assert = require('node:assert/strict');
const { dedupeTranscriptForPdf } = require('../transcript-output-dedupe');
const input = [
  { text: 'We are discussing the budget this morning.', source_id: 'host-1', captured_at_ms: 100000 },
  { text: 'We are discussing the budget this morning.', source_id: 'desktop-2', captured_at_ms: 106000 },
  { text: 'The other participant has a different question.', source_id: 'desktop-2', captured_at_ms: 108000 },
  { text: 'We are discussing the budget this morning.', source_id: 'host-1', captured_at_ms: 136000 },
  { text: 'A short answer.', source_id: 'host-1', captured_at_ms: 140000 },
  { text: 'A short answer.', source_id: 'host-1', captured_at_ms: 141000 },
  { text: 'Yes.', source_id: 'host-1', captured_at_ms: 148000 },
  { text: 'Yes.', source_id: 'host-1', captured_at_ms: 158000 },
  { text: 'Yes.', source_id: 'desktop-2', captured_at_ms: 165000 },
];
const out = dedupeTranscriptForPdf(input);
assert.deepEqual(out.map(x => x.captured_at_ms), [100000,108000,136000,140000,148000,158000,165000]);
assert.equal(dedupeTranscriptForPdf([]).length, 0);
assert.equal(dedupeTranscriptForPdf(input).length, dedupeTranscriptForPdf(out).length, 'idempotent');
console.log('PDF duplicate filter: passed');
