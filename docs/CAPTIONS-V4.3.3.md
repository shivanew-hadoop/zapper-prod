# Zapper v4.3.3 — captions and host-overlay update

## What changed

- Google Meet caption collection now uses a **240 ms** word-stability hold and a **1,300 ms** pause-finalization timer (was 900 ms / 2,250 ms). Local overlay text is emitted before backend persistence/relay. These are processing intervals, **not guaranteed end-to-end caption latencies**.
- Minor recognition revisions (`you` / `u`, English contractions) and overlapping tails do not replay previously committed sentences. Captions still preserve legitimate new utterances.
- If caption parsing fails during **4 seconds of audible Meet speech**, the existing Deepgram fallback may activate. The normal Meet caption path remains preferred; normal captions send text, not PCM.
- The Deepgram fallback and optional web host microphone use generic `language=en`, instead of `en-US`. This is English-only, not automatic Hindi translation. Global accents are supported by Deepgram, although speech recognition will never be perfectly accurate.
- On both host and PIN-participant Meet windows, **native captions are enabled** automatically. If the current Meet UI clearly presents `English (India)` as its selected caption language with a language menu, Zapper attempts to switch it to plain `English`. This is deliberately best-effort: Google can change its UI, and the user can still choose **English** manually in the Meet caption-language dropdown. Unrecognized settings are not modified.
- **Automatic host Meet** windows now collect captions themselves using a small caption-only preload, **without disabling the host microphone**. On successful host session creation, the signed-in portal requests an authorized host capture token; the desktop receives it via the existing `zapper://host-join` flow, streams caption text to the existing `/stt` API and displays speech in the **host overlay without separate Google overlay login or second participant seat**.
- PIN-authorized participant desktops receive host captions through the original session relay and PDF persistence pipeline. While native Meet captions are healthy, the backend prevents the optional browser host-microphone STT path from also broadcasting the host's voice to PIN viewers.
- A valid Zapper PIN still authorizes a participant. Google Sign-In is optional for joining as a Meet guest; Google Meet can still require admission or sign-in for particular rooms. The existing Google login button remains available.
- `zapper://host-leave` closes the independent host-caption socket; all existing End Session, billing, Meet, PIN, chat, overlay readiness, and single-active-session handling are preserved.

## Deployment (important)

1. Deploy the **API** changes first (`apps/api`) so native desktop host-caption sockets without a browser `Origin` are accepted using the existing short-lived *host-authenticated* token, while unauthorized browser origins stay blocked.
2. Build and publish the **v4.3.3 Windows desktop installer** (`apps/desktop`, `npm install && npm run dist` on Windows or release workflow). An older desktop build will still open Meet, but will not have the host-caption observer/relay. Install/upgrade it before enabling the web handoff.
3. Deploy the **web** portal (`apps/web`). The existing download link, overlay-readiness check, Create Session lock, and browser-session ownership remain untouched.

## Verification

- `npm --prefix apps/desktop run check`
- `npm --prefix apps/api run check && npm --prefix apps/api run smoke`
- `node apps/web/tests/create-session-availability.mjs` and the other web test scripts

These are automated/offline regression tests. **A real Windows installation + Google Meet call with multiple browsers/accents is still necessary** to assess true recognition accuracy, first-caption arrival time, and the current Meet language UI. Google Meet's ASR accuracy and actual network delay cannot be guaranteed by Zapper code.
