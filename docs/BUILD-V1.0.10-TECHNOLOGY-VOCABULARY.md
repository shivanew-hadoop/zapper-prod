# Zapper desktop v1.0.10 — conservative technology vocabulary

Built **on top of the supplied v1.0.9 source ZIP**. This is a **desktop-only** change; Railway API and Vercel web runtime files have not been modified. Deepgram remains OFF and the Google Meet caption observer remains the only recognizer.

## What is new

- `apps/desktop/transcriber/technologyVocabulary.json` — **83 built-in technology entries** covering cloud/AWS/Azure/GCP, DevOps/CI/CD, programming and web, APIs, data engineering and databases, and AI/ML.
- `apps/desktop/transcriber/technologyCorrections.js` — precompiled local match rules. Runs synchronously at the existing v1.0.9 caption correction handoff, before host display and authorized PIN relay. No added timer, audio capture, model, HTTP request or external STT service.
- Reuses `captionCorrections.js` for both the conversational fixes and the new technical normalization. Captions already handled by v1.0.9 continue to work as before.
- `apps/desktop/tests/technology-corrections.js` — checks technical examples, idempotency, false-positive protection, prefix stability, installer packaging, original Meet timing and the Deepgram-OFF invariant.

Examples (not guaranteed for all accents or all Google Meet outputs):

| Google Meet transcript | Zapper caption |
| --- | --- |
| kuberneties on aws | Kubernetes on AWS |
| terrafrom with docker | Terraform with Docker |
| postgressql and mongo-db | PostgreSQL and MongoDB |
| databriks with pyspark | Databricks with PySpark |
| an llm with pytorch | an LLM with PyTorch |
| We use react and nodejs | We use React and Node.js |

**Accuracy safeguards:** Only unambiguous, single-token exact variants are corrected automatically. Ambiguous words such as `react`, `spark`, `helm`, `rag`, `snowflake`, and `sequel` require **preceding technical context**; a later word does not retroactively rewrite an earlier one. This matters because the v1.0.8 no-blink renderer does not erase words after they are shown. Spoken multiword confusions such as `Cooper Netties` are intentionally left unchanged rather than risking a delayed or wrong rewrite. A term missing entirely from Google Meet captions cannot be recovered from text alone. New user-added aliases should avoid natural English words and cross-token substitutions.

**Configuring terms:** Edit `apps/desktop/transcriber/technologyVocabulary.json` (terms, variants, optional `contextBefore` list of plain words), run `npm run check`, then rebuild and reinstall the desktop application. The file is bundled in the Electron ASAR installer; it is not remotely updated during a call. Do not add broad aliases for common English words. Invalid/duplicate variants fail startup/tests so mistakes are caught before a release.

## Validation & deployment

```powershell
cd apps\desktop
node -p "require('./package.json').version"   # 1.0.10
npm install
npm run check
npm run dist
```

Rebuild/install **v1.0.10 on both host and PIN desktops** so local caption fallback uses the same correction vocabulary. API and Vercel deployments are not needed for this change. The built Windows NSIS installer is normally `apps/desktop/dist/Zapper-v1.0.10/Zapper-Setup-x64.exe`.

The desktop, API smoke and web regression suites were run in the Linux source-test environment. The technical correction code averaged roughly 0.01 ms per test phrase in those runs, **not** an end-to-end caption latency measurement. A real Windows/Google Meet call is still required to verify Indian-accent word accuracy, word-error rate, displayed text stability and host/PIN caption lag. Do not claim a guaranteed one-second delivery time.

## Not modified

- Google Meet English (UK) preference, existing caption collector timing, session auth, host/PIN relay and PDF path
- Existing caption no-blink rendering, cursor, chat and Google Meet timeout guards
- Host login, desktop readiness, Create Session lock, inactivity warning/Continue/End
- API, web, or Deepgram configuration (still forcibly disabled)
