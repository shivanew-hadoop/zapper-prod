# Zapper v3.1.2

- Google Sign-In window is never auto-closed after authentication; the user closes it manually.
- PIN overlay remains available while Google Sign-In is open.
- Added host End Session controls beside Copy PIN and in Recent Sessions.
- Ended PINs immediately fail redemption; connected STT sessions are revalidated and stopped.
- Added `/health/stt` to validate Deepgram credentials without exposing the key.
- Deepgram credential parsing strips an accidental `DEEPGRAM_API_KEY=` prefix and quotes.
- Invalid Deepgram credentials now return a clear Railway configuration message.
- Invalid/ended/expired PIN errors are explicit for participants.
- Existing PDF, admin, subscription, session retention, overlay privacy and installer behavior retained.
