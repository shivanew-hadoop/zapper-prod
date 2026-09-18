# Zapper v3.1.1

- Fixed participant flow after Google Sign-In: the Zapper overlay no longer switches away from the 6-digit PIN screen.
- Google authentication window closes after successful sign-in; the protected overlay is restored/focused and stays visible.
- The participant enters the host-provided 6-digit PIN and explicitly clicks **Start Session**.
- Added a compatibility guard so stale countdown events cannot hide the PIN panel.
- `npm run dist` now creates an installable NSIS Windows setup: `Zapper-Setup-x64.exe`.
- Portable build remains available through `npm run dist:portable`.
- Host/admin/API/session/transcript logic from the complete-product baseline is otherwise unchanged.
