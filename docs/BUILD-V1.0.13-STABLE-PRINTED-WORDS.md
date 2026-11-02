# Zapper Desktop 1.0.13 — printed words stay printed

Built on 1.0.12 (v1.0.7 baseline + 100-line retention + tech vocabulary). Overlay layout, windowing, login, PIN, chat, relay, API and web are untouched.

## Fixes

1. **Words disappearing and coming back.** The overlay only shows words that stayed unchanged for 240 ms. When Meet revised a word, that list got shorter and the overlay erased the whole live sentence, then re-typed it. `overlay/overlay.js` now keeps what is already printed: a shorter interim is ignored, a revised settled word keeps its printed form, and only the last two (mutable) words may change — which is where technology corrections land.
2. **Final line rewriting printed words.** A final now keeps the words already printed from its interim and only appends what is new. The PDF/transcript archive still stores Meet's exact final text.
3. **An interim with no final is no longer erased** when Meet moves on to an unrelated sentence; it stays as its own line. A duplicate final from the other source (host relay vs local) no longer wipes the sentence currently being spoken.
4. **Whole row reprinted after 5–6 sentences.** Meet keeps one growing caption row. If it revised or inserted ONE word anywhere inside the already-committed part, the "same first N words" test failed and the whole row (all earlier sentences) was emitted again. `host-caption-preload.js` and `meet-preload.js` now align committed words with the row (tolerant of revised/inserted/trimmed words) and emit only genuinely new words.

## Technology terms

Unchanged (`technologyCorrections.js`, 84 entries). Costs ~0.006 ms per caption, runs in-process on the existing path, no extra latency. It only rewrites exact listed phonetic variants; of 205 variants, 79 only fix capitalisation (aws → AWS). It cannot fix a mis-hearing that is not in the list.

## Tests

`npm run check` — all earlier tests plus `tests/v113-stable-captions.js` (fails on 1.0.12, passes now). Offline simulation only; confirm in a live Meet before rollout.
