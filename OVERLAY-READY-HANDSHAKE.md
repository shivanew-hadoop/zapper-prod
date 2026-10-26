# Zapper 4.3.2 — Overlay-ready gate (targeted change)

Based on the user's original `Zapper-v4.3.2-Auto-Launch-Stable-Captions (1)(1).zip`.

## What changed

Create Session now:
1. Invokes the original Windows `zapper://launch` protocol with a new random launch ID.
2. Shows the original browser confirmation prompt, if applicable.
3. Waits without a fixed three-second cutoff. The local Electron instance must receive THAT launch ID and report an actually visible, fully loaded overlay.
4. Only after a matching `ready: true` reply can the existing Google session/PIN API request run.
5. Clicking **Cancel Zapper launch** aborts the wait; no session API call runs.

Manual Create Session from a Meet URL has the same safety gate.

## Deployment — both pieces are required

1. Build and install the **desktop EXE from this 4.3.2 source** using `apps/desktop/build-installer.ps1`. Close the previous Zapper process before replacing it. An older 4.3.2 EXE cannot answer the readiness request.
2. Deploy the `apps/web` portal from this package at `https://zapperapp.in` or `https://www.zapperapp.in`.
3. Chrome/Edge must allow `zapper://` external-app launching and website access to `http://127.0.0.1:43791` on the same Windows PC. A security prompt may be shown by the browser. If local-network access is blocked, session creation safely stays pending; allow the request or click Cancel.
4. If the overlay does not open, leave the session uncreated; inspect Windows app protocol registration and whether Zapper is running. Do not force creation on a timeout.

## Scope

Changed existing files: `apps/desktop/main.js`, `apps/web/index.html`, `apps/web/src/main.js`.
Added small local-only handshake modules and focused tests. Nothing in the API, meeting automation, captions, microphone, dependencies, Electron version, or installer configuration was changed.

The handshake uses an HTTP endpoint listening **only** on `127.0.0.1:43791`, accepts only the Zapper production origins (and local Vite dev origins), and reports a boolean for an exact one-time launch ID. No Google tokens, PINs or transcript data are sent to this endpoint.

## Offline validation

- `node apps/desktop/tests/overlay-launch-readiness.js`
- `node apps/web/tests/overlay-launch.mjs`
- `cd apps/desktop && npm run check`

The desktop and website must be deployed together and validated on Windows. Offline tests cannot prove native Windows protocol confirmation or Google Meet admission on your machine.

## 2026-10-26 packaging crash correction

The first readiness build had `main.js` requiring `./overlay-launch-readiness` but
omitted `overlay-launch-readiness.js` from electron-builder's explicit `build.files` list.
The installer therefore booted with `Cannot find module './overlay-launch-readiness'`.
This revision **includes that runtime file** in the app.asar and runs
`tests/packaged-runtime.js` as part of `npm run check` before building the EXE.

**Rebuild the EXE and reinstall it.** Re-deploying the site or running a previous
installer does not fix an already-packaged `app.asar`.
