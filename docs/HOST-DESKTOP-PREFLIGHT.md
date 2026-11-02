# Host desktop preflight (web + Windows desktop)

## Purpose and scope

Only an authenticated, active **host** is asked to open Zapper; registration,
admin sign-in, public participant launch, and the existing Google Meet / PIN /
caption / transcript / session-end flows are unchanged. The website waits for
an explicit acknowledgement that the **visible Electron overlay** is running,
not for a browser focus change or a successful `zapper://` navigation.

## Workflow

1. Register, then sign in as host. The host portal probes the local app at
   `ws://127.0.0.1:9999/host-ready` (the existing Zapper audio-relay port).
2. If the overlay is already visible, the preflight finishes automatically.
   Otherwise the portal shows a **small, non-blocking setup alert** with
   **Download Zapper** (the existing official release URL) and **Open Zapper**.
   The create-session panel also keeps both actions available if the alert is
   dismissed. The host can finish installation and open Zapper without losing
   the logged-in portal page.
3. The Electron app responds with `{"type":"zapper-overlay-ready","ready":true}`
   only while its overlay window is visible. The website checks every 2 seconds
   (with a 1.2-second timeout), closes the alert on success, and unlocks both
   existing session-creation controls *only if this browser has no active room*.
4. If Zapper closes, the next probe disables new session creation. Any
   existing session and its other controls are left alone.
5. If this browser has already created an active room, the Create Session
   controls stay disabled, including during login/page-refresh restoration and
   across tabs sharing this browser profile. The existing session, PIN, Meet
   flow and End Session behavior stay as before. After End Session, creation is
   available again only while Zapper's overlay is ready.
6. Log out cancels the preflight and hides the alert.

The browser cannot reliably distinguish an uninstalled custom-protocol handler
from a blocked browser permission dialog. The download URL is therefore visible
in the prompt instead of silently redirecting/starting an installer.

## Release order

1. Package and publish the updated desktop build to the existing
   `Zapper-Setup-x64.exe` release URL. Verify `audio-ws/readiness.js` is bundled.
2. Deploy the website only **after** the installer is available, because older
   desktop builds cannot answer the new readiness acknowledgement.
3. No backend API/session schema change is required.

## Acceptance checks on Windows

- Host signs in with app already open: Create Session becomes available.
- Host signs in with app closed: setup prompt appears; creation stays disabled.
- Click **Open Zapper**: app opens/focuses, alert disappears after
  overlay readiness, and the *unchanged* Google Meet or manual session flow works.
- Not installed: click Download Zapper, install, run setup, and open the app;
  the same logged-in page unlocks automatically after readiness.
- Exit app: new session creation becomes disabled; reopening the app unlocks it
  only when there is no active session in this browser.
- Click Close on the compact alert: the Create button stays disabled and the
  inline Download Zapper / Open Zapper controls remain visible.
- Create session A; refresh or open a second tab in the same browser: Create
  Session remains disabled until A is ended. Another computer can still run
  its own session as before.
- Register without logging in; sign in as admin; public participant launch:
  no host-only prompt.
- Existing session: verify PIN, host join, captions, participant audio relay,
  end session and PDFs still work on Windows.
- In Chrome/Edge, approve any local-network permission for localhost if shown;
  a browser that blocks localhost WebSockets cannot confirm overlay readiness.

Unit checks: `node apps/web/tests/desktop-readiness.mjs`,
`node apps/web/tests/create-session-availability.mjs`,
`node apps/web/tests/device-session-ownership.mjs`, and
`node apps/desktop/tests/overlay-readiness.js`.
