'use strict';
// Only complete, immutable sentences reach Electron and the existing PDF relay.
// Cross-endpoint overlap is removed without ever editing an earlier final.
function normalized(text) { return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function createFinalLedger(correct = x => x) {
  let previous = '';
  let previousAt = 0;
  return {
    append(value) {
      const text = correct(String(value || '').replace(/\s+/g, ' ').trim());
      if (!text) return '';
      const now = Date.now(), n = normalized(text);
      if (!n) return '';
      if (now - previousAt < 150 && n === previous) return '';
      previous = n;
      previousAt = now;
      return text;
    },
    reset() { previous = ''; previousAt = 0; }
  };
}
module.exports = { createFinalLedger };
