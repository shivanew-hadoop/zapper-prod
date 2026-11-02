# Participant-local ASR priority patch

Each PIN participant continues to run their own Meet window and local JavaScript Whisper worker. The existing audio WebSocket at localhost:9999 feeds PCM only to the same desktop process. Local Whisper captions now take priority over the host relay, which is only used when both local ASR and native Meet captions are silent. Native Meet captions remain a warm-up/failure fallback and the original backend text relay/PDF pathway is unchanged.

## Important limits
- This does not make Whisper truly streaming. Its window is still 1.2 seconds plus CPU inference time.
- The existing Meet audio tap hooks WebRTC receiver tracks. If Google changes its renderer or the participant has no audible remote audio, the worker receives no PCM.
- The host window uses a different preload and is still on its original native-caption path. This patch does not claim host-side Whisper integration.
- Each participant must run Zapper, join the meeting locally, and allow model download or prebundle the model.
- Offline model weights are not in this source archive.
- No Windows clean-machine build or live multi-participant Google Meet test has been performed here.
- Check meeting participant consent before capturing audio.
