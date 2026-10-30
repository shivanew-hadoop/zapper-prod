# Zapper desktop 1.0.11 — v1.0.7 baseline only

This release is based on the user-supplied `Zapper-v1.0.7-Host-Caption-Continuity-Clean-Chat-Stable-Cursor-Deepgram-Off(1).zip`. It does **not** incorporate the overlay/window-lifecycle changes made in 1.0.8, 1.0.9, or 1.0.10. Only the approved 83 vocabulary entries are referenced from the earlier vocabulary work; they are applied through a new isolated synchronous helper.

## Changes relative to the supplied 1.0.7 baseline

1. `apps/desktop/overlay/overlay.js`: removed the `MAX_LINES = 100` limit, `trimTranscriptHistoryIfFollowing()` and its two call sites. The v1.0.7 renderer, cursor, provisional text, scroll, and session handling were not rewritten. Previously printed final lines remain in the DOM across the 100-line boundary.
2. `apps/desktop/transcriber/technologyVocabulary.json`: 83 single-token technology vocabulary entries. Ambiguous terms require earlier technical context. The vocabulary does not guess missing words or change Google Meet's recognition setting.
3. `apps/desktop/transcriber/technologyCorrections.js`: a compiled synchronous vocabulary normalizer, loaded once during desktop startup. It adds no timer, debounce, audio recognition, network service, buffering, or backend requests.
4. `apps/desktop/main.js`: apply technical corrections to host and PIN-caption handoffs (local and authorized relay), leaving caption timing and transport intact. Chat messages are not touched.
5. Desktop `package.json`: version `1.0.11` and one focused regression test added to `npm run check`. No API or website runtime source was changed.

## Retained behaviour

- Google Meet captions **English (UK)**, as in v1.0.7 (best effort against Google's UI).
- Deepgram fallback **OFF** (as in v1.0.7).
- Existing host session login, overlay readiness, group chat, Meet automation, participant PIN, active-session lock, PDF generation, cursor and inactivity controls unchanged.

## Validation

- `npm --prefix apps/desktop run check` — passed, including 155-line transcript and 83-entry vocabulary tests.
- `npm --prefix apps/api run check` and `npm --prefix apps/api run smoke` — passed, unchanged API code.
- `node apps/web/tests/<test>.mjs` for each existing web test — passed, unchanged website code.
- Local synchronous correction benchmark was ~0.005 ms per test phrase in this environment. **Not** a claim about live Google Meet-to-overlay end-to-end latency.
- A live Windows installer + Google Meet session was not executable here. Validate host and PIN-client caption speed/accuracy in staging before rollout.

## Build and rollout

From `apps/desktop` on a Windows developer machine:

```powershell
node -p "require('./package.json').version"  # 1.0.11
npm install
npm run check
npm run dist
```

Expected output under `apps/desktop/dist/Zapper-v1.0.11/`. The ZIP is **source**, not a prebuilt Windows installer. No Railway or Vercel update is needed for these two desktop-only changes. Update the desktop application on host and PIN machines, and test with a 100+ line live session.

If this revision fails on your environment, reinstall the known-working 1.0.7 desktop installer; this release does not require backend schema or environment changes.
