# Zapper Deepgram stream reduction (opt-in)

## What this changes

When `PARTICIPANT_STT_MODE=relay-only`, PIN-authorized desktop connections still receive the existing host caption relay, but their audio is NOT sent to Deepgram. The host microphone STT path remains unchanged. No desktop rebuild is needed.

**Warning:** Host browser microphone captions do not necessarily contain remote Google Meet participants' audio. This mode can lose speech that was previously captured on PIN desktops. It is NOT equivalent to mixing all participants' audio into one stream. Do not enable unless a live test proves the host source contains all speech you need.

## Railway deployment

1. Back up the current backend deployment. Push the updated `apps/api/server.js` to the Git branch used by your Railway API service. Do not replace the desktop, payment, or session code.
2. Railway > Project > API service > Variables: leave `DEEPGRAM_API_KEY` unchanged.
3. Deploy with `PARTICIPANT_STT_MODE=independent` (or omit it). This preserves the original behavior.
4. Confirm `GET /health` reports `participantSttMode: independent`. Test host and PIN desktop captions.
5. On a staging service only, set `PARTICIPANT_STT_MODE=relay-only`, apply variables, and wait for redeploy. Confirm `GET /health` reports `participantSttMode: relay-only`.
6. Run a meeting with host and 3 PIN desktops. Test host speech, remote participant speech, overlapping speech, silence, disconnect/reconnect, session end, and transcript export. Compare against original mode.
7. If all required speakers are captured and caption latency remains acceptable, enable on production. Otherwise retain `independent`.

## Rollback

Set `PARTICIPANT_STT_MODE=independent` in Railway Variables, apply/redeploy. This restores separate Deepgram connections without a code revert.

## Cost / latency

Relay-only removes participant STT streams, but it does not combine their audio. Host STT remains directly connected to Deepgram and the existing caption relay path is unchanged. Participant captions may be delayed by the existing relay path and can be incomplete if the host mic cannot hear remote speakers. Deepgram bills by streamed audio time; verify usage in your Deepgram console.
