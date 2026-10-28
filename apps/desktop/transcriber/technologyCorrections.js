'use strict';

// Synchronous, exact-match technology corrections on the v1.0.7 caption path.
// Both single words and short multiword phonetic variants are compiled once.
// No timers, buffering, audio capture, network requests or fuzzy matching.
const { terms } = require('./technologyVocabulary.json');

function compileVocabulary(entries) {
  const lookup = new Map();
  for (const entry of entries) {
    if (typeof entry?.term !== 'string' || !entry.term || !Array.isArray(entry.variants)) {
      throw new Error('Invalid technology vocabulary entry');
    }
    const context = entry.contextBefore || [];
    if (!Array.isArray(context) || context.some(word => !/^[a-z0-9-]+$/i.test(word))) {
      throw new Error('Invalid technology vocabulary context');
    }
    for (const value of entry.variants) {
      if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9./-]*(?: [a-z0-9][a-z0-9./-]*){0,3}$/i.test(value)) {
        throw new Error(`Unsafe technology caption variant: ${value}`);
      }
      const key = value.toLowerCase().replace(/\s+/g, ' ');
      if (lookup.has(key)) throw new Error(`Duplicate technology caption variant: ${value}`);
      lookup.set(key, { name: entry.term, context });
    }
  }
  // Compile once during desktop startup. Strict boundaries avoid matching
  // abbreviations inside unrelated words (e.g. API inside capitalized text).
  const escaped = [...lookup.keys()].sort((a, b) => b.length - a.length)
    .map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));
  const expression = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${escaped.join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  return { lookup, expression };
}

const compiled = compileVocabulary(terms);

function correctTechnologyTerms(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(compiled.expression, (source, index, fullText) => {
    const match = compiled.lookup.get(source.toLowerCase().replace(/\s+/g, ' '));
    if (!match) return source;
    if (match.context.length) {
      // Only words already spoken can justify disambiguating terms such as
      // Spark, React, Snowflake or SQL (from "sequel"). Never look ahead.
      const before = fullText.slice(0, index).split(/[.!?\n]/).pop().slice(-96);
      const previous = new Set((before.match(/[\p{L}\p{N}-]+/gu) || []).map(word => word.toLowerCase()));
      if (!match.context.some(word => previous.has(word))) return source;
    }
    return match.name;
  });
}

module.exports = { correctTechnologyTerms, compileVocabulary };
