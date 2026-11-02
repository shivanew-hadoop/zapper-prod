# Zapper 1.0.3 — Host Meet empty-call safeguard and caption-inactivity confirmation

Built directly on `Zapper-v1.0.2-English-UK-Accurate-Captions-Deepgram-Off.zip`. The desktop version is `1.0.3`. API and website package version fields retain their previous values by design.

## Why this is needed

Google Meet's **"The call ended because everyone left"** screen is not a general microphone silence detector. Google Meet may automatically end a *one-person* call if **Leave empty calls** is enabled. Google documents a stay/leave prompt after approximately 10 minutes and an automatic exit after 2 more minutes. Merely speaking or sending synthetic audio does not reliably cancel a single-participant timeout.

Source: https://support.google.com/meet/answer/7290456

## Behavior

- On an authorized host Meet window, Zapper makes a **best-effort** attempt to open Meet **More options → Settings → General** and switch **Leave empty calls** **OFF**. Only clearly labeled controls are touched; no false sound or synthetic captions are sent. Google can change its UI: **manually confirm Leave empty calls is OFF in the host Meet window**. Use Ctrl+Shift+H to reveal the hidden host Meet window where available.
- The backend tracks actual native Google Meet caption updates from the host and PIN viewers. This is separate from `last_speech_at_ms`, which older PIN redemption logic can also update. **Deepgram is still forcibly disabled**.
- After **12 minutes without any caption updates**, the host portal shows a compact **Yes, continue / No, end & save PDF** warning with a 2-minute countdown. Captions from **any** connected Meet observer reset the countdown.
- **Yes:** server records the host's real confirmation; the existing PIN and session continue. Desktop checks the *existing* host Meet window, clicking the Meet stay prompt only after this explicit confirmation. If Google has left the room, it attempts to rejoin that same Meet link. No microphone activity is fabricated.
- **No:** runs the existing End Session endpoint, invalidates the PIN and generates the same PDF as a manual End Session.
- **No response:** after **12 + 2 minutes**, the server ends the session and finalizes the PDF. A 15-second server sweep handles browser sleep/closure; authorized desktop clients are informed and disconnect. This is distinct from Google's own one-person timer.
- Existing sessions that were active **before API upgrade** are excluded from the new inactivity timer, so a deployment never silently terminates a previously running meeting.
- The host-caption relay token now lasts at most the remaining session lifetime (up to **3 h 30 m**), avoiding the old 1-hour expiry that could interrupt caption activity.
- Unchanged: English (UK) best-effort selection in **both host and PIN Meet collectors**, visible Google Meet caption extraction, overlay readiness gate, one-active-session browser lock, existing microphone/mute controls, PIN eligibility and seat limits, transcript deduplication, automatic maximum duration, and PDF format.

## Important limitations

Speech activity is inferred from **Google Meet caption text**, not independently from audio. If Google Meet captions are turned off, unavailable, or fail to render because Google changes its website, Zapper cannot reliably determine whether people are speaking. Under these circumstances the warning may appear even while there is speech, and an unanswered warning can end the Zapper session. Ensure captions are enabled in the Meet window for accurate activity detection; do not treat this as an acoustic voice-activity detector. **This requires a live Google Meet test**.

Turning off **Leave empty calls** in Meet is best-effort because Google controls the UI. If the switch remains on, Meet may still end a one-participant call before the Zapper warning. In this case select **Yes, continue** and verify the host has rejoined; the software cannot guarantee reconnection if Google's service refuses admission or ends the actual meeting.

## Deploy

1. **Deploy `apps/api` first**. It performs forward-compatible schema changes and preserves existing active sessions.
2. Publish the updated `apps/web` host portal next (warning and Continue flow).
3. Install the rebuilt desktop app, version 1.0.3 (adds `host-resume` and best-effort Meet empty-call setting). Keep host overlay open.
4. Confirm English (UK), Google captions ON, and **Leave empty calls OFF** in a real Meet test. Test both PIN participants and host captions for a 15-minute call (or use isolated test timing in development only).

Windows PowerShell, from `apps\desktop`:

```powershell
node -p "require('./package.json').version"   # 1.0.3
npm install
npm run check
npm run dist
```

Installer location: `apps\desktop\dist\Zapper-v1.0.3\Zapper-Setup-x64.exe`.

If the D: drive is full:

```powershell
Remove-Item .\dist -Recurse -Force -ErrorAction SilentlyContinue
npm run dist -- --config.directories.output=E:\ZapperBuild
```

## Automated verification

- API: syntax + all regression tests, including new 12+2 timings, Continue ownership, PDF finalization and data migration.
- Desktop: syntax + Meet host/PIN caption, overlay, relay and host-control regression tests.
- Web: inactivity alert countdown, create-session lock, browser ownership, authenticated host capture, desktop readiness and wake-lock tests.

Not tested here: live Windows Meet UI, microphone audio, actual idle call for 12–14 minutes, Electron NSIS installer, full Vite production build.
