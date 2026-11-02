# Participant local ASR targeted patch

Based on the exact uploaded Zapper-v1.0.13-Participant-Local-ASR-Priority-Fix(1).zip.

Changes:
- Whisper JS default inference window: 1200ms -> 960ms (override ZAPPER_ASR_WINDOW_MS).
- Audio worker pending PCM bounded to two inference windows; drops oldest PCM under CPU overload instead of building stale transcription delay. Speech may be skipped on slow CPUs.
- Overlay rejects exact duplicate consecutive final captions within 3.5 seconds, including same-source repeats.
- Adds conservative LangChain / LangGraph phonetic spelling variants.

Not changed: PIN and host relay, Meet capture, audio routing, PDF, backend, chat, native captions, session control, or installer configuration.

Validation: npm run check passed (all existing desktop tests and syntax checks).
Not validated: live Windows multi-machine Meet, latency/accuracy benchmark, npm run dist, complete offline model availability. A 960ms window can reduce accuracy; test with actual speech and set ZAPPER_ASR_WINDOW_MS=1200 if accuracy worsens.

Known limitation: This is chunked Whisper, not true streaming. Model CPU inference may still be slow; no guarantee of near-real-time captions. Local ASR needs the model downloaded or bundled.
