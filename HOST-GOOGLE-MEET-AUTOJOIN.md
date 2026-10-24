# Zapper v4.2.7 — Actual Google Meet Host Join (Chrome/Edge extension)

## What was broken

A successful Meet API request created a Google Meet **room URL**, not a joined conference. The previous host Web UI microphone flow streamed the host's own mic to Zapper `/stt` and Deepgram/browser speech recognition; it did **not** send microphone audio into Google Meet. A participant who joined the room from Electron therefore heard no host speech and Meet caption DOM had nothing to display. Browser JavaScript on `zapperapp.in` also cannot programmatically click or unmute controls on `meet.google.com` because the Google Meet page is a different origin.

## What this build does

1. Host clicks the **existing Create Session** button. No UI markup, styles or extra Join Google Meet button were added.
2. With configured Google OAuth, the backend creates a `spaces` resource, requests `OPEN` access, stores the link and generates the existing six-digit PIN. If server-side Meet OAuth is unavailable, the new host extension can open `meet.google.com/new` in the signed-in *local host browser*, read the resulting Meet room URL, and register it using the same authenticated Zapper `/api/sessions` PIN endpoint.
3. The new **Zapper Google Meet Host** extension (Chrome or Edge) reuses that Meet tab (no duplicates), configures the Meet site's microphone permission where supported, turns the camera OFF and the actual Google Meet microphone ON, and clicks **Join now** when the Google Meet prejoin controls allow it.
4. Once Meet shows joined controls plus microphone ON and camera OFF, focus returns to the existing Zapper Web UI. **The Meet tab remains open in the background** and Google Meet handles capture/transmission of the real laptop microphone. Closing that tab stops the audio. A browser tab is NOT genuinely headless, nor can the cloud server capture the host's local microphone.
5. The existing Electron participant enters the PIN, redeems it with the backend, gets the matching stored Meet URL and session token, then uses the existing background Meet controller and Meet caption DOM observer. Participant microphone/camera handling remains unchanged.
6. The Electron capture side runs in **Google Meet captions-only** mode, with Deepgram audio upload disabled; the separate host Zapper `/stt` recording path is no longer invoked. Existing transcript storage, PDF, relay and overlay remain in place.
7. The existing End Session flow closes the browser-extension-owned host Meet tab. Reloading Zapper reuses its Meet tab; it does not create a second host in the room.

## One-time installation (mandatory on the host computer)

**Pure Web UI code cannot auto-join or unmute a different website. This host-side browser extension is REQUIRED.** It is bundled in `apps/host-meet-extension/` inside the project ZIP.

1. Extract the complete project ZIP on the host computer.
2. In **Chrome**, open `chrome://extensions` (or `edge://extensions` in Microsoft Edge).
3. Enable **Developer mode** and choose **Load unpacked**.
4. Select the extracted `zapper-prod/apps/host-meet-extension` folder (it contains `manifest.json`). Approve the Chrome/Edge extension permissions. The extension's site-microphone permission has a browser warning because it changes permission settings for Google Meet.
5. Sign in to your Google account in **the same Chrome/Edge profile** used for Zapper. Allow microphone use for `https://meet.google.com`; leave the camera off. Some Google/organization/OS policies block automatic permission configuration; in that case allow it in browser/site/OS settings.
6. Deploy updated `apps/web` (Vercel or the existing web platform) and `apps/api` (Railway or your existing backend) together; update the participant Electron app from `apps/desktop` if needed. There are no new backend environment variables. For an API-created **open** room, keep the existing `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` and `WEB_ORIGINS` configured.
7. Reload Zapper Web UI. Use the original **Create Session** action. Check the existing microphone status line: it should change to **Host joined Google Meet; microphone ON, camera OFF** before asking anyone to enter the PIN.
8. On another computer, open Zapper Electron, enter the PIN, and verify its Google Meet connection/captions. Speak into the host microphone. Test actual audibility in Meet before evaluating the overlay transcript.

## Important limits and transparent failures

- **No silent login bypass.** Google may require sign-in, approval, or a one-time microphone permission. The extension reports the blocking condition in the existing status area; it cannot bypass Google authentication or organization policies.
- **Not actually headless.** The extension briefly opens the actual Meet tab to join with a permitted physical microphone, then returns focus to Zapper. Browsers do not expose safe cross-origin, truly headless live microphone injection to ordinary sites. Keep Chrome/Edge open and the host computer online.
- **Google Meet UI changes.** Meet can change accessible control labels or behavior. The automation attempts to detect/validate the joined state, but live Google Meet verification is required; automated mocked-DOM checks do not prove success on all Google UI versions or account policies.
- **Open rooms.** The existing Google Meet API flow explicitly requests `OPEN` and checks the response. Rooms created by the `meet.google.com/new` fallback inherit the host account's actual Meet access settings; a guest might still need admission. Google account or Workspace policies take priority.
- **No duplicate or fake success:** The extension owns only the tabs it created, enforces one tab per session, and reports joined only when the accessible page controls confirm both joined status and microphone/camera states. If no extension is installed, session creation in the API-configured flow can create the PIN, but the Web UI reports that it cannot autojoin; in the browser fallback flow it stops and reports what to install rather than claiming a working microphone.
- **No Deepgram audio upload for this host/PIN flow.** The previous Deepgram source files and backend routes remain for future fallback work but aren't selected by the active host or participant flow.

## Verification performed

- JavaScript syntax checks for web, API, Electron and all three extension scripts.
- Extension tests: trusted-domain origin, browser microphone permission settings, one Meet tab per PIN session, reusing Meet/new-created room, Chrome tab cleanup, mute command, camera-OFF/mic-ON, automatic Join now and status confirmation.
- Existing API Google Meet tests (OAuth, encrypted refresh token storage, OPEN room enforcement, pin, participant seats), session/PIN smoke tests, transcript relay, PDF dedupe, trial/payment tests.
- Existing Web session-selection/ownership tests, Desktop Meet caption DOM guard and chat-noise tests.
- **Not tested:** actual Google Meet live audio/caption behavior, Chrome extension installation in a real browser, OS microphone permission, deploy environment or true account sign-in. Do not claim field verification before that is tested on host and participant computers.

## Deployment contents

- **Changed:** `apps/web/src/main.js`, `apps/api/session-control.js`, `apps/desktop/main.js`.
- **Added:** `apps/host-meet-extension/{manifest.json,background.js,web-bridge.js,meet-host.js}` and tests.
- **Unchanged:** `apps/web/index.html`, `apps/web/src/app.css`, Electron overlay markup/styles, participant PIN redeem shape and existing Google Meet URL/PIN storage. Existing Deepgram sources are preserved but not invoked by this host flow.
