# Zapper Platform

Brand-new Zapper project. It is intentionally separate from the previous Zapper repository/backend.

## Applications

- `apps/api` — Railway API, SQLite database, subscriptions, 6-digit session PINs, transcript storage/PDF, Deepgram WebSocket relay.
- `apps/web` — Zapper.in web portal (Vite) for signup/login, session creation, PINs, recent sessions and PDF downloads.
- `apps/desktop` — Electron overlay. Google sign-in + 6-digit PIN only; no license key and no manual Meet URL.
- `docs` — deployment and production runbook.

## Target production URLs

- Portal: `https://zapper.in`
- API: `https://api.zapper.in`
- Desktop custom protocol: `zapper://launch`

## Core flow

1. Host registers/signs in at Zapper.in.
2. Host subscription must be active.
3. Host enters a Google Meet ID/link and creates a session.
4. API saves the canonical Meet URL and returns a unique 6-digit PIN.
5. Participant launches Zapper desktop, signs in to Google if required, and enters only the PIN.
6. Desktop redeems the PIN and receives the Meet URL plus a signed session token.
7. Captions stream through the new Railway API.
8. On Leave, the complete transcript is uploaded to the host account.
9. Portal shows the latest 20 transcripts and downloadable PDFs.

## Start here

Read `docs/00-END-TO-END.md` and follow it in order.

## Local verification

Backend core logic (does not require npm packages):

```bash
cd apps/api
node tests/smoke.js
```

JavaScript syntax:

```bash
node --check apps/api/server.js
node --check apps/api/session-control.js
node --check apps/desktop/main.js
node --check apps/desktop/overlay/overlay.js
node --check apps/desktop/meet-controller/index.js
```
