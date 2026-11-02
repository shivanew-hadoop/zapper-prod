# Zapper Desktop 1.0.12 — Technology phrase recognition

## Baseline and scope

This package is based on the user-provided v1.0.7 application, with the v1.0.11 100-line display-retention fix. It does NOT import the overlay, caption staging or window-management rewrites from v1.0.8–v1.0.10.

Only the existing `apps/desktop/transcriber/technologyCorrections.js`, its local vocabulary JSON, desktop package version and regression tests changed. There is no API or web runtime change.

## Examples of corrections BEFORE captions reach the overlay/relay

| Google Meet caption (example) | Zapper output |
| --- | --- |
| land chain | LangChain |
| land graph | LangGraph |
| lang chain | LangChain |
| lang graph | LangGraph |
| kubernet | Kubernetes |
| kuber netes | Kubernetes |
| kubernetties | Kubernetes |
| LangChain | LangChain (unchanged) |

Dictionary has 84 term entries: previous 83 terms plus LangGraph; existing LangChain/Kubernetes gain additional exact phonetic variants. Matches have word boundaries; there is NO general fuzzy autocorrect. Non-technical speech containing these exact phrases could be miscorrected, so validate with actual use cases before production.

## Latency characteristics

- Compiled once at Electron startup.
- Correction runs synchronously on existing caption events, before IPC to the overlay and existing authenticated relay. No added network call, timer, buffering, second speech recognizer, or Deepgram.
- Test benchmark measures LOCAL correction execution only; it is NOT a measurement of Google Meet recognition or end-to-end caption latency.
- If Google Meet omits an utterance or prints a long-delayed correction, a text-only dictionary cannot reconstruct the missing audio. In the existing renderer, words that have already been frozen are intentionally not rewritten, so late Google recognition changes may remain uncorrected on screen.

## Validation

```
cd apps/desktop
npm run check
npm run dist
```

`npm run check` includes the phrase regressions, incremental overlay text checks and the existing 155-line retention gate. Google Meet caption language remains English (UK); Deepgram remains OFF.

On staging: speak and observe **land chain**, **land graph**, **kubernet**, **LangChain**, **Kubernetes** with host + two PIN participants. Compare arrival times to native Google Meet captions in the same call. Do not assume correction eliminates Google Meet-side delays.
