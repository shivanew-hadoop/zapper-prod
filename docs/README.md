# Zapper v4.1.7 — Current release guide

This is the **only** project documentation file. The application is based on v4.1.6; existing API, Google OAuth, PIN redemption, desktop capture, subscriptions and PDF behavior are retained.

## Host workflow

1. Sign in at `https://www.zapperapp.in` using an active Zapper host account.
2. Optionally expand **Check microphone before starting a session**. Select a microphone, record a 2.5-second local test and play it back. Test audio is not uploaded to Zapper.
3. Click **Create Session**. Sign in with your individual Google account only if Google asks. Share the generated six-digit PIN with participants.
4. This browser profile retains its active room; the Create Session button stays disabled until this room ends. Other active calls from the same host account appear as **read-only** status and duration on the right. No one can switch to or end another computer's call from that summary.
5. The controls for **this** browser's room are microphone choice, level meter, timer, Mute/Unmute, Copy PIN and **End Session**. Canceling End Session leaves the room active.
6. Completed calls remain under **Saved transcripts** for PDF download.

**Scope of device lock:** The UI tracks sessions per **browser profile** through account-scoped local storage. Tabs sharing that profile use the same local room; separate computers or browser profiles can make separate rooms. This is a UX lock, not a hardware fingerprint or a backend per-device concurrency limit. Other-session status refreshes when opening the dashboard or using **Refresh**, without extra API polling.

**Audio:** The host's microphone requires browser permission and a browser tab left open; remote meeting participants are still captured through the existing desktop app. Transcription uses the existing Railway + Deepgram streaming path. Microphone tests are local-only.

## Deployment

- Push the contents of `zapper-prod/` to the existing GitHub `main` branch.
- Deploy `apps/web` to Vercel. This update's behavioral changes are **frontend only**.
- `apps/api` and `apps/desktop` have package version `4.1.7` for release consistency, but their runtime implementations are unchanged from v4.1.6. No database migration or new environment variables are required.
- If deploying API metadata too, verify the Railway service still points to `/apps/api`, retains its volume and production variables, and reports the intended version at `/health`.
- Keep the same production Google OAuth client settings; do not change working credentials.

## Regression checklist

- On computers A and B with the same host login, create different PINs. Each computer should retain its own PIN on refresh and disable its own Create Session button.
- A third computer should see A and B as read-only active-call summaries and still be able to create Session C.
- In two tabs of the same browser profile, confirm one shared local session is selected.
- Confirm the pre-session microphone test works without a session, captures the chosen device and plays audio locally.
- Confirm the current room's Mute/Unmute, timer, PIN copying and End Session Cancel/OK actions.
- End A and verify B and C continue. Reopen A and verify Create Session becomes available.
- Verify participants can redeem the correct PIN and the original transcript-to-PDF path still works.

**Testing note:** The automated browser tests used a simulated API and microphone capture. Real device audio, multi-computer latency, live Google Meet creation and PDF output still require production checks.
