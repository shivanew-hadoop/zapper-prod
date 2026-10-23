// Conservative final-document deduplication. The live caption path is untouched.
// Drop near-simultaneous echoes produced by independent capture connections,
// while preserving natural repetitions from the same stream later in the call.
function normalized(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();
}
function sameCaption(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  // Interim/finalization overlap sometimes trims a clause. Do not compare very
  // short phrases as substrings, since distinct speakers can say "yes" often.
  return Math.min(a.length, b.length) >= 24 && (a.includes(b) || b.includes(a)) &&
    Math.min(a.length, b.length) / Math.max(a.length, b.length) >= 0.8;
}
function dedupeTranscriptForPdf(rows) {
  const kept = [];
  for (const row of rows || []) {
    const text = String(row?.text || '').trim();
    const value = normalized(text);
    if (!value) continue;
    const at = Number(row.captured_at_ms ?? row.at ?? 0);
    const source = String(row.source_id ?? row.sourceId ?? '');
    const duplicate = kept.slice(-32).some(previous => {
      const previousAt = Number(previous.captured_at_ms ?? previous.at ?? 0);
      const delta = Math.abs(at - previousAt);
      const previousSource = String(previous.source_id ?? previous.sourceId ?? '');
      const sameSource = Boolean(source && previousSource && source === previousSource);
      const earlier = normalized(previous.text);
      // Short utterances such as "yes" or "okay" can legitimately be spoken
      // by two participants; use the larger overlap window only for sentences.
      const windowMs = sameSource || Math.min(value.length, earlier.length) < 24 ? 2500 : 20000;
      if (delta > windowMs) return false;
      return sameCaption(value, earlier);
    });
    if (!duplicate) kept.push(row);
  }
  return kept;
}
module.exports = { dedupeTranscriptForPdf };
