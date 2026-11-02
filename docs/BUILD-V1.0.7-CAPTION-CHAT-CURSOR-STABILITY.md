# Zapper Desktop v1.0.7 — Narrow fixes on v1.0.6

This package starts with the complete v1.0.6 project. Changes are limited to caption continuity, unsafe chat scraping, and private cursor rendering. The website, login, readiness gate, Create Session lock, PIN authentication, Meet controls, English (UK) caption preference, 12+2-minute inactivity policy, PDFs and Deepgram-OFF policy are unchanged.

## Fixes

1. **Host caption stalls after minutes:** The host Meet observer now prefers the latest visible caption tray when Google leaves stale nodes mounted. The existing authorized backend caption relay also subscribes the host socket, so another PIN desktop's live captions can reach the host if its local observer stalls. Host-local captions remain primary and suppress this fallback while fresh (2 seconds). The API never echoes a host's own caption back to itself and remains isolated by session token. Backend's pre-existing three-second silent-leader handoff is retained.
2. **Captions wrongly forwarded into chat:** Removed document-wide/timestamp-based chat scraping and per-caption DOM mutation scans. Participant Meet chat is read only when a verified chat input and attributable message elements are present. Host Meet chat accepts only actual message-ID rows inside the chat panel. Zapper's own group-chat Send pathway is unchanged. System messages and spoken captions must not be invented as chat messages.
3. **Pointer flicker:** Native protected pointer windows no longer receive redundant per-frame bounds/protection/topmost updates. Redundant renderer-pointer IPC was removed. The overlay no longer repeatedly raises its window above the protected pointer on the 250ms guard while the pointer is hovering. Protected screen-capture behaviour and always-on-top preference remain enabled.

## Validation completed

- `npm --prefix apps/desktop run check` — passes including host Meet caption DOM, message filtering, overlay stability, cursor test, host authorization, and relay test.
- `npm --prefix apps/api run smoke` — passes including session isolation, host fallback source handoff, PDFs, login, and inactivity handling.
- All `apps/web/tests/*.mjs` — pass. **No web files changed.**
- Deepgram remains hard OFF on desktop and API. No Deepgram provider is used.

These are offline/source regression tests, not a live Google Meet or Windows installer test. Google can change its Meet DOM; test against live Meet before production use.

## Staging deployment

1. Push the updated source to your GitHub `staging` branch. Deploy `apps/api` to your Railway staging backend **first**, because the host caption fallback requires the updated API.
2. Keep `apps/desktop/app-config.json` pointed at the same staging backend. From `apps/desktop`: `npm install`, `npm run check`, `npm run dist`.
3. Confirm `node -p "require('./package.json').version"` returns **1.0.7** and install the freshly built `dist/Zapper-v1.0.7/Zapper-Setup-x64.exe` on host and PIN machines.
4. Test one host with two PIN clients for 5+ minutes, including pauses and resumes; compare host/PIN overlay captions. Speak sentences resembling chat messages without clicking Send: **chat must remain empty**. Then send a real message from each overlay and confirm group delivery. Keep the mouse over the overlay while captions update; the private cursor should remain stable.
5. End the session and confirm the existing PDF and active-session lock behaviour.

The Vercel web app remains unchanged in this revision.
