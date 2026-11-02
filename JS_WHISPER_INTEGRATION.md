# Zapper JavaScript Whisper integration (experimental)

This replaces the Python Whisper child process with a Node.js worker running Transformers.js Whisper. It reuses the existing Meet 16-kHz PCM stream and existing Electron caption relay; Google native captions remain primary. No Python is needed.

## Setup

From `apps/desktop`: `npm install` then set `ZAPPER_LOCAL_ASR=1` before `npm start` or building/running the installed app. The default model is `Xenova/whisper-base.en`. The model is downloaded on first launch and cached; offline use requires a previously cached model. `ZAPPER_ASR_OFFLINE=1` disables downloads. The model is **not bundled in the installer**. You can change model via `ZAPPER_ASR_MODEL` if supported by Transformers.js. Run `npm run check` to check existing desktop behavior.

## Performance and accuracy caveats

This is chunk-based Whisper, not true streaming ASR; default chunks are 1200 ms plus inference. Sub-second stable final captions are not guaranteed, especially on CPU. For the lowest latency, use a dedicated streaming recognizer such as sherpa-onnx with a tested native runtime; for stronger tech-term accuracy use a larger model and the existing deterministic technology vocabulary. Exact-match corrections cannot recover every misheard term. Chunk boundaries can omit or split words. Model cache and native ONNX runtime packaging must be validated on a clean Windows installation. Do not advertise as production-ready without actual Meet, installer, and multi-participant tests.

This does not transmit raw meeting audio to a cloud ASR provider. The existing caption relay may send text to the authorized backend as before. Inform meeting participants as appropriate.
