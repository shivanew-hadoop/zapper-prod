# Local Whisper on every participant

Each participant running Zapper now starts the JavaScript Whisper worker by default after joining via Zapper's existing Meet audio capture. Set `ZAPPER_LOCAL_ASR=0` to opt out. The local worker consumes 16 kHz PCM from that participant's own meeting playback, corrects technical terms using the existing vocabulary, and sends its captions directly to that participant's overlay. Local ASR output is **not** transmitted through the host caption relay. The existing native Meet captions, authorized relay, PIN/session, and PDF pipeline are preserved as fallbacks and existing features.

## Important limits

- This is **not** sub-second streaming recognition. The current worker uses 1.2-second audio windows plus inference. CPU latency varies and word boundaries may be missed.
- First launch needs network access to download the model (`Xenova/whisper-base.en`), and the model is cached per machine. `npm run dist` packages JS code, not the model. Test ONNX native packaging on a clean Windows machine.
- Participants must run Zapper and join the meeting using its audio capture integration. Ordinary Google Meet users without Zapper do not receive local transcription.
- This captures the combined remote audio each participant hears. Own-mic capture and reliable speaker diarization are not provided by this worker.
- Technical corrections are heuristic and cannot guarantee every specialized term. Audio and text processing stay local for the new ASR path; existing native caption relay remains unchanged.
- Obtain meeting participants' consent where required.
