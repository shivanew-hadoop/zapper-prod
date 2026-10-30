# Zapper v1.0.14 — Local Streaming Zipformer per machine

## Scope

This is an edited SOURCE ZIP based on the supplied v1.0.13 project. It is not a
compiled Windows installer. The ONNX model and native addon are not included in
this small source ZIP: the Windows build downloads the official model once and
then bundles both dependencies for OFFLINE runtime recognition.

Authentication, six-digit PIN validation, Google Meet URL retrieval and joining,
Google cookies, participant limits, group chat, Railway session lifecycle,
PDF/session records, payment logic and original Electron overlay remain.
No API/web source files were edited. Main visible change: each installed Zapper
host and each PIN participant recognizes its own local Meet audio.

## Local data flow (each machine independently)

Host desktop:
  Zapper host Google Meet window
    -> tap original host getUserMedia microphone + received WebRTC audio tracks
    -> PCM16 mono 16kHz -> ws://127.0.0.1:9999/host-audio
    -> Electron main -> isolated worker_threads worker
    -> sherpa-onnx-node OnlineRecognizer Streaming Zipformer (int8 CPU)
    -> speech endpoint -> technology dictionary (115 technology terms)
    -> FINAL ONLY append to host Electron overlay
    -> EXISTING authorized JSON text relay for PDF / session sync

PIN participant desktop:
  six-digit PIN verified against EXISTING backend -> joins own Meet window
    -> pre-existing WebRTC remote-audio tap -> PCM16 mono 16kHz
    -> ws://127.0.0.1:9999/participant-audio
    -> Electron main -> independent isolated Zipformer worker
    -> speech endpoint -> technology dictionary
    -> FINAL ONLY append to this desktop's Electron overlay
    -> EXISTING authorized JSON text relay for PDF / session sync

Railway backend DOES NOT receive PCM in v1.0.14: all model inference is local.
The relay's old sendAudioChunk() implementation remains as unused backward
compatible code; there are no calls from Electron main to send it PCM.
No cloud STT fallback is allowed. If the model is missing/unavailable, the
Electron overlay shows an error, rather than silently using Google captions.

## Why streaming Zipformer

Online 16 kHz recognition can decode small input chunks, detects speech
endpoints, and runs in a worker so the UI and Meet WebRTC thread do not block.
We show only final utterances. There is intentionally no mutable interim
text sent to the overlay, so already printed final sentences are not revised.
Endpointing delays each line until a pause; the rule2 threshold is 0.7 s,
rule1 1.15 s, and long continuous utterances are bounded at approximately
18 seconds. Actual delay and transcription quality depend on audio, CPU,
accent, model and network conditions in Meet.

## Windows x64 build (model included in resulting installer)

1. On Windows 10/11 x64, install Node.js 22 and git.
2. `cd apps/desktop`
3. `npm install` (installs `sherpa-onnx-node` native addon)
4. `npm run check` (runs original regression tests + new local STT tests)
5. `npm run dist` (runs `scripts/install-local-stt-model.ps1` at BUILD time,
   downloads the OFFICIAL model into `models/`, and packs it into extraResources)
6. Install the resulting `dist/Zapper-v1.0.14/Zapper-Setup-x64.exe` on EVERY
   host and participant PC. No additional runtime model download is needed.

If the Windows build machine is offline, provision the required four files
manually under `apps/desktop/models/sherpa-onnx-streaming-zipformer-en-2023-06-21/`
as described in `apps/desktop/models/README.md`. Then run `npm run dist`.
Do not distribute an installer until model/Native Windows compatibility has
been tested on a real Windows PC using actual Google Meet audio.

## Model provenance

Streaming Zipformer English (LibriSpeech + GigaSpeech, 2023-06-21), int8 encoder:
https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-2023-06-21.tar.bz2

Native package: https://www.npmjs.com/package/sherpa-onnx-node
Check third-party licenses before redistributing any model and native runtime.

## Privacy, audio capture and compatibility notes

- WebRTC/Google Meet itself remains an online meeting service. Only the
  Google Meet -> transcript conversion is offline. The old authenticated
  backend still receives final text for PDF and original session behavior.
- Host microphone is tapped from Meet's own getUserMedia stream, not a
  separately opened microphone. Meet's original media stream is returned
  unchanged. This host-only requirement changes host BrowserWindow sandbox /
  contextIsolation settings, while nodeIntegration remains disabled.
- Both local WebSockets are bound ONLY to 127.0.0.1. The audio relay verifies
  the Meet page origin, and raw audio is not forwarded to Railway or Deepgram.
- A one-second host vs participant offset can happen because each device uses
  its own captured audio and its own local endpoint decisions; screens are
  deliberately not synchronized by a central caption feed.
- On abnormal worker/CPU overload the app warns about missing audio rather
  than hiding the problem. The final lines already rendered are immutable.
- The language model may still miss technical names, uncommon accents or
  proprietary terminology. Add exact variants to technologyVocabulary.json
  and rerun npm run check for safe local correction. No automatic rewriting of
  previous finalized text is performed.

## Verification done in the source environment

- `npm run check` passes (original JavaScript tests plus localZipformer tests).
- Host + PIN audio paths, absence of backend PCM forwarding, final-only
  emission, technology correction, and stale-worker suppression checked.
- Real ONNX model inference, accuracy, microphone capture in live Meet, and
  building the Windows installer could NOT be executed here because the model
  binary/native Windows build environment was not available.
