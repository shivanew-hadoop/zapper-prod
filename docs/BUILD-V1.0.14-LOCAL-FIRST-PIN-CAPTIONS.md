# Zapper v1.0.14 — PIN captions local-first

## Runtime path
Host overlay: Google Meet host DOM → desktop Electron IPC → host overlay (unchanged).
PIN overlay: Google Meet participant DOM → desktop Electron IPC → PIN overlay **immediately**.
Railway: still needed for PIN/session authorization, caption persistence and PDF,
authorized chat delivery, and a fallback if local Meet captions are unavailable.

## What changed
- Removed the 1.8s fresh-host-relay gate that suppressed live local PIN captions.
- A fresh local Meet caption always renders in that PIN overlay without a relay roundtrip.
- Host/peer-relay caption text is a fallback if the PIN collector has not emitted in
  the last 6s; host relay remains preferred over peer relay while using fallback.
- Local freshness is measured at Electron IPC reception, not using stale Meet timestamps.
- All other v1.0.13 codepaths, including English (UK), technology corrections,
  Deepgram OFF, chat, PDFs, session controls, window handling and overlay renderer,
  are unchanged.

## Verification
`cd apps/desktop && npm run check`
Run an end-to-end Windows Meet session with host + 2 PIN participants. Compare
Google Meet CC and each PIN overlay while speaking continuously; temporarily
interrupt Railway network after joining to verify local captions remain visible.
The remote session connection will still be necessary for authentication and
other application functions. Test language and accuracy live; this does not
change Google's speech-to-text delay.
