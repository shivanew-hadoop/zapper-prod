# Local per-participant ASR — safer build candidate

- Uses Transformers.js quantized whisper-base.en on each participant computer. No Python or sherpa-onnx-node.
- Keeps Meet native captions and host relay higher priority; local Whisper is fallback when they are silent.
- Existing Zapper profile, PIN, overlay, session and PDF code retained.
- Optional offline model: place full Hugging Face `Xenova/whisper-base.en` repository (including ONNX files) under `apps/desktop/asr-models/Xenova/whisper-base.en/` BEFORE `npm run dist`. Electron Builder copies it to `resources/asr-models`. If omitted, model is downloaded on first run and cached.
- Audio chunking remains 1.2 s + inference. Sub-second captions and universal technical accuracy are NOT guaranteed.
- Build validation on Windows, first-run model load, and real multi-participant meeting tests are required.
- `ZAPPER_LOCAL_ASR=0` disables local ASR. `ZAPPER_ASR_OFFLINE=1` disables model downloads.
- Model files are NOT included in this source ZIP. Do not market the resulting installer as fully offline unless model is bundled and verified.
