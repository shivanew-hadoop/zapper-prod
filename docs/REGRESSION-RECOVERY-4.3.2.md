# Zapper 4.3.2 — regression recovery candidate

This is a **source release candidate**, NOT a production-validated Windows installer.
It was prepared from the supplied `Zapper-v4.3.2-Targeted-Fixes.zip` and preserves those baseline changes.

## Stabilization changes added after the reported regression

- Host overlay reports *joined* only when the Meet page actually exposes the in-call state. Opening a browser window no longer signals successful admission.
- Newly created Google Meet rooms get a short startup grace period and up to three initial room-ready retries before a Google sign-in flow is initiated.
- Failed host Meet page loads clear stale Electron window state, allowing subsequent Create Session to open a fresh window.
- Host Meet automation no longer re-enables the microphone after joining, preserving manual mute choices.
- An unavailable microphone label no longer rejects the entire `getUserMedia` request; normal system-device capture remains available.
- Protocol messages for mute, device selection, and leaving no longer reopen an overlay the host has intentionally hidden.
- Existing host caption socket and PIN-client transcript/chat relay changes remain included, with reconnect/acknowledgement tests.

## Deployment — all three components must match

1. Back up the working 4.3.1 installer/source and current Zapper installation configuration.
2. Deploy `apps/api` first (required for the desktop host caption-token and session chat relay endpoints).
3. Deploy/build `apps/web` second (requests authenticated host-desktop tokens and selects the microphone).
4. Build/install `apps/desktop` last. Fully exit every previous Zapper process before starting the new build; otherwise the old process may continue handling `zapper://` links.
5. Do not modify `apps/desktop/app-config.json` unless your actual API endpoint differs from the supplied baseline.

## Manual Windows + Google Meet validation required

- Cold launch: exit Zapper completely; create first Google Meet session; accept the external-protocol prompt; verify a real in-call screen, not merely “opening Meet”.
- Repeat the same operation with the overlay already open, and after hiding the overlay.
- Host voice: verify first and subsequent live captions reach the host overlay and two PIN-authorized participant overlays, with interim and final text.
- Mic: select physical devices, unmute, confirm audio reaches other Meet attendees. Also unplug the selected device and confirm Meet still opens using the system default.
- Message relay: host -> both participants and each participant -> host + other participant. Disconnect and reconnect a participant and verify unacknowledged messages are resent once, not duplicated.
- Hide/reopen the overlay: ensure the call remains active and `zapper://launch` makes the overlay visible again.
- End the host session: verify the meeting closes, PIN tokens expire, and new sessions can begin.

## Offline checks run

- `npm --prefix apps/desktop run check` — pass, including chat/Meet-caption guards, host join parsing, authenticated socket reconnect/ack, microphone switch, and missing-device fallback.
- `npm --prefix apps/api run check` — pass.
- `npm --prefix apps/api run smoke` — pass before the stabilization-only host changes (no API source changed in the final stabilization pass).
- `node --check apps/web/src/main.js` and related new modules — pass.

**Not verified:** Actual Google Meet join, Google auth/permissions, Windows capture-device APIs, live caption timing, installer execution, multi-machine latency, or website build with npm dependencies (not present in this environment). Google Meet may change its DOM or account policies. The only reliable release gate for those behaviors is a real Windows Google Meet trial.

## Safe rollback

If a live test regresses, restore your backed-up 4.3.1 desktop build, API and web deployment as a matched set; do not mix an old backend with this new desktop or vice versa.
