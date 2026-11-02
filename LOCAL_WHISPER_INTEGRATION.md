# Optional local Whisper transcription for Zapper

This is an **opt-in fallback** for the existing Google Meet native-caption pipeline. Existing Meet caption collection, host relay, PIN access, PDF persistence, UI and backend remain unchanged. If Google Meet captions are fresh, Whisper results are ignored to avoid duplicates. If captions are absent, Whisper text is sent through the existing authorized caption relay to other Zapper PIN participants. It does not push captions into Google's native Meet caption UI.

## Windows setup (each machine that needs to transcribe locally)

1. Install Python 3.10+ and run `python -m pip install faster-whisper numpy`.
2. Start with environment variable `ZAPPER_LOCAL_ASR=1` before launching Electron (`$env:ZAPPER_LOCAL_ASR='1'; npm start` in PowerShell, from `apps/desktop`).
3. Optional: set `ZAPPER_PYTHON` to a Python executable, `ZAPPER_ASR_MODEL=medium.en` for accuracy, `ZAPPER_ASR_DEVICE=cuda` and `ZAPPER_ASR_COMPUTE=float16` for supported NVIDIA GPUs, `ZAPPER_ASR_WINDOW=1.6` (seconds), `ZAPPER_ASR_TERMS` for domain terminology.
4. First run downloads model weights; subsequent runs can transcribe offline. No model weights or Python interpreter are bundled in the ZIP or Windows installer.

## Scope / limits

- Captures remote WebRTC audio already tapped by the existing embedded Google Meet preload (16 kHz mono PCM16LE). Does not record all other desktop sound.
- The host's own microphone is **not** added to this local audio stream; existing host native captions and relay remain responsible for it.
- Local ASR is not true streaming: ~1.6-second segments **plus inference time**; accuracy, latency, and correct technical terms are not guaranteed. Tune the model and window for the machine. CPU may lag.
- Existing caption authorization and backend are still required to distribute captions across PIN viewers. It is not a standalone all-users broadcast service. Google Meet participants without Zapper do not receive Electron captions.
- The current desktop Electron packaging does not bundle Python dependencies; this integration runs with an external Python installation. To ship as a single executable, package a Python sidecar separately.
- Inform participants and comply with applicable consent requirements before transcribing.
