# Zapper v1.0.15 — v1.0.12 baseline, PIN overlay display only

## Baseline

This package was rebuilt directly from the user-supplied `Zapper-v1.0.12-v1.0.7-Baseline-Fast-LangChain-LangGraph-Kubernetes(1).zip`.
It does **not** incorporate the v1.0.13 or v1.0.14 rendering/window changes.

## Runtime changes (apps/desktop/main.js only)

1. A PIN participant's validated local Google Meet caption is sent directly to their own Electron overlay, even if the host's Railway caption relay was recently active.
2. Once a local Google Meet caption observer is ready, messages from Railway's other caption sources are **not merged** into this overlay. This avoids conflicting streams and text replay after normal pauses.
3. Before the local Meet caption observer is ready, session-authorized host relay captions can still appear, as in v1.0.12. The API connection remains active for authentication, chat, caption persistence, PDF creation and session-ended events.

This is a **sticky local-first display choice**. It avoids toggling back to Railway merely because the speaker is quiet for several seconds. If the local Meet caption observer later stops working without signaling it, display will depend on restoring local Meet captions or restarting the participant session. This release does not introduce an unverified automatic source-switching timer.

Unchanged: Google Meet caption extraction, English (UK) preference, 240 ms interim stabilization, 84 technology vocabulary terms, 100-line retention fix, existing renderer, cursor/window handling, host flow, API and website code, PIN/session controls, chat transport, transcript PDFs and Deepgram OFF.

## Verification

`cd apps/desktop && npm run check` — includes tests/v115-pin-local-first.js.

`cd apps/api && npm run check && npm run smoke`

`cd apps/web && npm run check:inactivity`

The new test asserts local IPC delivery, host relay before local readiness, no relayed-text mixing after a quiet two-minute period, continued backend caption persistence, chat/session-end control and PIN state reset.

## Build and stage

From `apps/desktop`:

```powershell
npm install
npm run check
npm run dist
```

Check `node -p "require('./package.json').version"` returns `1.0.15`.

Only the desktop runtime differs from v1.0.12. Deploy a staging desktop build first; no Railway or Vercel runtime rollout is necessary. Validate one host and two PIN desktops for at least 15 minutes, including pauses/repeated phrases, chat, session end and PDF saving. Automated tests cannot measure Google Meet's live caption latency.
