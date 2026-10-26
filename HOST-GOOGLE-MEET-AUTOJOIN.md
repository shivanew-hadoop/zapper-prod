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

## First Create Session: extension download and one-time installation

**The existing Create Session button now checks whether the companion extension responds.** If it is missing, Zapper requests the bundled extension ZIP download from `/downloads/Zapper-Host-Meet-Chrome-Edge-Extension.zip` (served by the updated `apps/web/public/downloads/` directory). No separate download hosting or backend setting is required. If the browser prevents an automatic download, the setup dialog has a **Download extension ZIP** button. Subsequent Create Session clicks do not repeatedly download it within that browser tab.

1. Deploy the updated `apps/web` bundle. Use desktop Chrome or Edge on the host computer and sign into Zapper.
2. Click **Create Session**. If the companion is absent, a one-time setup dialog appears and the ZIP download is requested.
3. Extract the ZIP. In Chrome open `chrome://extensions` (Edge: `edge://extensions`), turn on **Developer mode**, choose **Load unpacked**, and select the extracted `zapper-host-meet-extension` folder containing `manifest.json`.
4. Back in Zapper, choose **I've installed it — Continue**. The page reloads so the newly installed content script can run. If the extension responds, Zapper continues the original Create Session request. If Google login must open a browser popup, click Create Session once more: browsers require a fresh user gesture to open that sign-in popup.
5. Sign in to Google in that **same Chrome/Edge profile** and grant the needed `meet.google.com` and operating-system microphone permissions. The host extension attempts to join Meet with microphone ON and camera OFF, reporting its status on the existing page.
6. Future sessions detect the already installed extension and go through the original Create Session flow without the download or setup dialog.

**Security constraints:** A website cannot silently install or enable a browser extension, sign into Google, or bypass Google Meet admission controls. If the user cancels setup, no PIN/session is created by that click. Mobile Chrome/Safari cannot install this extension. The Web UI appearance and the existing backend PIN, desktop overlay and participant flows are unchanged.

Deploy `apps/api` (Railway or existing backend) and the desktop participant Electron app as normally required by the full original project. This new first-click onboarding change itself only modifies `apps/web`. Existing Google Meet API OAuth variables, if configured, remain unchanged.

## Important limits and transparent failures

- **No silent login bypass.** Google may require sign-in, approval, or a one-time microphone permission. The extension reports the blocking condition in the existing status area; it cannot bypass Google authentication or organization policies.
- **Not actually headless.** The extension briefly opens the actual Meet tab to join with a permitted physical microphone, then returns focus to Zapper. Browsers do not expose safe cross-origin, truly headless live microphone injection to ordinary sites. Keep Chrome/Edge open and the host computer online.
- **Google Meet UI changes.** Meet can change accessible control labels or behavior. The automation attempts to detect/validate the joined state, but live Google Meet verification is required; automated mocked-DOM checks do not prove success on all Google UI versions or account policies.
- **Open rooms.** The existing Google Meet API flow explicitly requests `OPEN` and checks the response. Rooms created by the `meet.google.com/new` fallback inherit the host account's actual Meet access settings; a guest might still need admission. Google account or Workspace policies take priority.
- **No duplicate or fake success:** The extension owns only the tabs it created, enforces one tab per session, and reports joined only when the accessible page controls confirm both joined status and microphone/camera states. If the extension is missing, the Web UI stops before creating a new PIN and offers the ZIP download plus one-time installation steps.
- **No Deepgram audio upload for this host/PIN flow.** The previous Deepgram source files and backend routes remain for future fallback work but aren't selected by the active host or participant flow.

## Verification performed

- JavaScript syntax checks for web, API, Electron and all three extension scripts.
- Extension tests: trusted-domain origin, browser microphone permission settings, one Meet tab per PIN session, reusing Meet/new-created room, Chrome tab cleanup, mute command, camera-OFF/mic-ON, automatic Join now and status confirmation.
- Existing API Google Meet tests (OAuth, encrypted refresh token storage, OPEN room enforcement, pin, participant seats), session/PIN smoke tests, transcript relay, PDF dedupe, trial/payment tests.
- Existing Web session-selection/ownership tests, Desktop Meet caption DOM guard and chat-noise tests.
- **Not tested:** actual Google Meet live audio/caption behavior, Chrome extension installation in a real browser, OS microphone permission, deploy environment or true account sign-in. Do not claim field verification before that is tested on host and participant computers.

## First-run onboarding delta relative to the previous ZIP

- **Modified for this request:** `apps/web/src/main.js` (checks before either creation path, resumes only for the originating host account and handles Google popup rules).
- **Added:** `apps/web/src/host-extension-setup.js` (ZIP download request, modal instructions, no duplicate download, page reload/continuation), `apps/web/public/downloads/Zapper-Host-Meet-Chrome-Edge-Extension.zip` (bundled static file), and `apps/web/tests/host-extension-setup.mjs`.
- **Unchanged for this request:** extension host automation, API session/PIN logic, Electron desktop app, UI HTML/CSS and Deepgram behavior of the prior Real-GMeet-Host-AutoJoin ZIP.
- **Testing:** All web .mjs tests, extension-flow checks, API Meet/host microphone/caption relay tests, desktop caption DOM guard, plus a Chromium dialog-interaction test passed. Deployment, downloaded browser extension installation on an actual host, Google sign-in, live host mic audio and PIN overlay captions have **not** been validated in a real meeting.
- **Unchanged:** `apps/web/index.html`, `apps/web/src/app.css`, Electron overlay markup/styles, participant PIN redeem shape and existing Google Meet URL/PIN storage. Existing Deepgram sources are preserved but not invoked by this host flow.
