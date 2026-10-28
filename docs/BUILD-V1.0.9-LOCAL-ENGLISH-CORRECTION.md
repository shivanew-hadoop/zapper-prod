# Zapper desktop v1.0.9 — local, zero-wait English caption corrections

Based directly on **v1.0.8**. This update changes the desktop only; Railway API and Vercel web runtime files are the same as v1.0.8. Deepgram is still forcibly OFF. The application retains Google Meet's best-effort **English (UK)** preference.

## What changed

A small, synchronous, conservative `apps/desktop/transcriber/captionCorrections.js` stage now runs as Google Meet caption messages arrive in Electron `main.js`, **before** local overlay rendering and before forwarding host/PIN captions to the existing authenticated session relay. The same stage handles captions arriving from older peer relays. No AI model, network service, microphone capture, new delay, retranscription or external dictionary is introduced.

Only contextual, low-risk misrecognitions are corrected. Examples:

| Meet text | Zapper corrected text |
| --- | --- |
| I wanted Tu Si | I wanted to see |
| Coming Tu my rolls and responsibilities | Coming to my roles and responsibilities |
| Thank u for joining the call | Thank you for joining the call |
| Can u hear me? | Can you hear me? |
| on a daily bases | on a daily basis |

Not all errors can be fixed from text alone. Names, Indian-language phrases, ambiguous short words, missing words and unfamiliar technical vocabulary are intentionally left as Meet transcribed them. Some errors might still appear if Google's partial output changes **after** a word has already been permanently displayed. Do not add broad word substitutions without testing live prefixes: the v1.0.8 overlay will not erase visible text.

## Latency and accuracy validation

- The correction stage contains no `setTimeout`, network call or word buffering. Host and PIN caption collectors keep their pre-existing stabilization timings (240 ms); Google Meet's timing, socket transport and Windows compositor remain the main end-to-end contributors.
- `node tests/caption-corrections.js` tests phrase correction, non-destructive handling of proper names, idempotency, growing-prefix stability, host + PIN publisher wiring, Deepgram OFF and CPU overhead. CPU benchmarking is NOT proof of one-second end-to-end latency.
- For measurable accuracy, record a consented set of short Indian-English utterances and a manually verified reference transcript, then compare word-error rate and recorded caption timestamps on v1.0.8 vs v1.0.9 across host and at least two PIN desktops. Measure p50/p95 end-to-end lag and count any changed/permanently-disappearing words.

## Build / test

```powershell
cd apps\desktop
node -p "require('./package.json').version"  # 1.0.9
npm install
npm run check
npm run dist
```

When staging, install **v1.0.9 on host and PIN desktops** so local fallbacks use the same correction rules. The host-published caption stream is already corrected before reaching the API. Do not change the API or web deployment for this desktop-only patch.

## Existing functionality not modified

- Google Meet recognition and English (UK) preference; no Deepgram
- V1.0.8 immutable/no-blink caption renderer and private cursor
- Host overlay readiness, single active session, PIN auth and isolation
- Authorized captions/relay, Google Meet empty-call reminder, chat messaging
- Session inactivity warning, PDF generation and browser session flow

A Windows installer and live multi-party Meet call were **not** run in the Linux source-testing environment. Do a staging call before promoting this desktop build to production.
