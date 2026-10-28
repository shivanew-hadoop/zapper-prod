'use strict';

/**
 * Local, synchronous technology vocabulary normalization. Only exact
 * single-token alternatives are allowed, so a later word cannot retroactively
 * change a word that the no-blink overlay has already printed.
 *
 * No audio recognition, network service, timeout, or external model.
 * The vocabulary is bundled at build time and can be edited in
 * technologyVocabulary.json before rebuilding a desktop installer.
 */
const { terms } = require('./technologyVocabulary.json');

function escapeRegexp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileVocabulary(items) {
  const variants = new Map();
  for (const entry of items) {
    if (!entry || typeof entry.term !== 'string' || !entry.term.trim() || !Array.isArray(entry.variants)) {
      throw new Error('Invalid caption technology vocabulary entry');
    }
    const context = Array.isArray(entry.contextBefore) ? entry.contextBefore : [];
    if (context.some(word => !/^[a-z0-9-]+$/i.test(word))) {
      throw new Error('Technology caption context must consist of plain single words');
    }
    for (const raw of entry.variants) {
      // A multi-word ASR guess can be captured word by word by the overlay;
      // rewriting it later would violate the permanent-word guarantee.
      if (typeof raw !== 'string' || !/^[a-z0-9][a-z0-9./-]*$/i.test(raw)) {
        throw new Error(`Unsafe technology caption variant: ${String(raw)}`);
      }
      const key = raw.toLocaleLowerCase('en');
      if (variants.has(key)) throw new Error(`Duplicate technology caption variant: ${key}`);
      variants.set(key, { term: entry.term, context });
    }
  }
  const alternatives = [...variants.keys()].sort((a, b) => b.length - a.length).map(escapeRegexp).join('|');
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives})(?![\\p{L}\\p{N}_])`, 'giu');
  return { variants, re };
}

const compiled = compileVocabulary(terms);

function correctTechnologyTerms(input) {
  if (typeof input !== 'string' || !input) return input;
  return input.replace(compiled.re, (original, offset, fullText) => {
    const entry = compiled.variants.get(original.toLocaleLowerCase('en'));
    if (!entry) return original;
    if (entry.context.length) {
      // Left-context only: never use a later word to correct already-visible ink.
      // Do not carry context over a sentence boundary.
      const prefix = fullText.slice(0, offset).split(/[.!?\n]/).pop().slice(-96);
      const previousWords = new Set((prefix.match(/[\p{L}\p{N}-]+/gu) || []).map(w => w.toLocaleLowerCase('en')));
      if (!entry.context.some(word => previousWords.has(word))) return original;
    }
    return entry.term;
  });
}

module.exports = { correctTechnologyTerms, compileVocabulary };
