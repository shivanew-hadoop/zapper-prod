'use strict';

const { correctTechnologyTerms } = require('./technologyCorrections');

/**
 * Conservative, synchronous English caption cleanup.
 *
 * Meet is still the ONLY recognizer. These contextual substitutions apply to
 * its already-stabilized caption text at the Electron handoff, before both
 * the overlay and session relay. No extra timer, audio capture, network call,
 * or machine-learning model is involved. Ambiguous words remain untouched.
 *
 * Important: the overlay paints permanent words. Every rule must be safe to
 * apply on a growing caption prefix (not just on a completed sentence).
 */

function correctMeetCaptionText(input) {
  if (typeof input !== 'string' || !input) return input;
  // Allow arbitrary Meet punctuation, but never manufacture a missing word.
  let text = input;

  // Frequent short, phonetic token errors in English conversation. The
  // preceding phrase supplies enough context to avoid turning names like
  // "Tu" into "to" everywhere. These are all prefix-stable replacements.
  text = text.replace(/\b((?:I|we|you)\s+(?:want|wanted|need|needed|have|had|used)|(?:coming|going|trying|try|able|plan|planning|like|go|come))\s+tu\b/giu,
    (_match, preceding) => `${preceding} to`);

  // "I wanted Tu Si" => "I wanted to see". "Si" by itself could be a
  // name/foreign word; only change it within these infinitive expressions.
  text = text.replace(/\b((?:(?:I|we|you)\s+)?(?:want|wanted|need|needed|try|trying|like|able)\s+to)\s+si\b/giu,
    (_match, preceding) => `${preceding} see`);

  // Specific job-related confusion; do NOT globally change food "rolls".
  // Prefer left-context (already present in the streamed prefix) over a later
  // word such as "responsibilities" that would revise permanently drawn ink.
  text = text.replace(/\b(coming\s+to\s+my\s+)rolls\b/giu, (_match, preceding) => `${preceding}roles`);

  // Short-form "u" is unambiguous in these conventional spoken phrases.
  text = text.replace(/\b(thank|can|could|would|will|do|did|are)\s+u\b/giu,
    (_match, preceding) => `${preceding} you`);

  // Avoid broad grammar rewrites that can alter a speaker's intent.
  text = text.replace(/\bon\s+a\s+daily\s+bases\b/giu, 'on a daily basis');
  return correctTechnologyTerms(text);
}

module.exports = { correctMeetCaptionText };
