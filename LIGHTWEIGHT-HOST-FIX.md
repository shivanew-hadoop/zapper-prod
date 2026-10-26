# Zapper 4.3.2 — lightweight host launch correction

## Purpose and baseline

Based on the original user-supplied `Zapper-v4.3.2-Auto-Launch-Stable-Captions (1).zip`, NOT the subsequent 4.3.3 package.

- Keeps Electron **^30.5.1** and the current Zapper overlay, PIN, API, web portal, participant caption pipeline, and `ws` dependency. No Electron upgrade and no new dependency.
- Moves **only the host Meet window** to the Chrome or Edge executable already installed on the computer. This bypasses the obsolete *embedded* Chrome 124 host experience.
- Uses a **separate persistent browser profile** under `%APPDATA%\ZapperPlatformProfile\host-system-browser`. On first use, Google may require the host to sign in there. Login is not shared automatically with the user's ordinary Chrome profile.
- Attempts to click the pre-join button, waits for a confirmed joined state, and stops after a bounded retry instead of reloading endlessly.
- The overlay's existing X action fully exits Zapper; Ctrl+Shift+T hides/shows it. Closing the overlay with X ends the Zapper-managed host browser. Minimize the host browser window if you want it out of the way while keeping the session active.
- During installation, the installer stops an old `Zapper.exe` process (not Chrome/Edge). When a new host session starts, Zapper checks for orphan Chrome/Edge processes using **only this dedicated Zapper profile** and stops those before relaunching; it never kills the user's ordinary Chrome/Edge profiles.

## Windows build

1. Install Node.js (version 22 or newer) and have the latest Google Chrome or Microsoft Edge installed.
2. In `apps/desktop`, run `powershell -ExecutionPolicy Bypass -File .\build-installer.ps1`.
3. Install the generated `Zapper-Setup-x64.exe`, replacing the old Zapper. The shipped ZIP is SOURCE, not the installer.
4. Start Zapper, create a session in the existing Zapper web portal, and accept the `Open Zapper` link if prompted. The managed Chrome/Edge host window opens. **Sign in once** if needed, and allow microphone access.
5. If it does not join automatically, use the visible Chrome/Edge window to join manually; do not assume the meeting is active until Google's meeting controls appear.
6. End the meeting from the portal to leave the host session. Use overlay X to exit Zapper completely. Ctrl+Shift+T only hides the overlay; it does not exit.

## What remains unverified / unchanged

- No real Windows Chrome/Edge Google Meet login or admission test was possible in this environment. Chrome and Google's identity checks can change, so this is a *test candidate*, not a verified release.
- Participant-side Meet remains on the original Electron 30 caption implementation. If Google refuses **participant** embedded browsers too, that is not solved by this host-only patch.
- This patch does not implement missing 4.3.3 caption or chat enhancements; it retains the original 4.3.2 components as requested.
- Installer size cannot be measured without producing a Windows EXE. Keeping Electron 30 avoids the previous Chromium major upgrade, but all Electron installers contain a sizable browser runtime. A truly tiny installer would require an architectural rewrite, not just ZIP compression.
- Do not use the ZIP itself as a Windows EXE. Do not replace a working installation before completing a real Windows host/participant regression test.
