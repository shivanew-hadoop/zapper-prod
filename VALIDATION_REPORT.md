# Zapper v1.0.13 — local ASR validation report

## Verified in this environment (Linux, Node 22)
- Source ZIP extracted and integrity checked.
- `apps/desktop/npm run check` passed (syntax and all desktop scripted checks).
- Source remains configured for native Meet captions and host relay priority; local ASR is fallback.
- Local ASR can be disabled with `ZAPPER_LOCAL_ASR=0`.

## Not verified / release blockers
- `npm run dist` targets Windows NSIS and has **not** been run on Windows.
- The archive does **not** include Whisper model weights, Electron runtime or node_modules.
- A first-run model download is required unless a complete model is bundled.
- Live Meet capture, multi-participant behavior, caption latency and terminology accuracy have not been tested on real Windows devices.
- JS Whisper uses 1200ms audio windows plus inference, so sub-second captions are not assured.
- There is no lockfile in apps/desktop, so fresh dependency resolution may vary.

## Safe smoke-test sequence on Windows
1. Back up the installed Zapper and user data.
2. `cd apps/desktop && npm install && npm run check`.
3. Run `npm run dist` and record any build errors.
4. Install on a separate Windows test device; confirm the app opens without local ASR using `ZAPPER_LOCAL_ASR=0`.
5. Join a test Google Meet with consent; verify existing native captions, host/PIN relay, overlays and session exports.
6. Enable local ASR; confirm model download, local caption fallback and memory/CPU consumption.
7. Repeat on 8GB CPU-only and 16GB laptops; compare latency and terminology recognition.

This report does not certify the package as production-ready.
