# Zapper 1.0.4 — automatic Google Meet empty-call protection

Built directly on `Zapper-v1.0.3-Meet-Idle-Safeguard-12min-Alert-Deepgram-Off.zip`. This is a **desktop-only** change. The API and website source, host-session lock, 12-minute caption-inactivity prompt, 2-minute confirmation deadline, session end, PDF generation, English (UK) captions, and hard-off Deepgram setting have not been changed.

## No per-host Google Meet setup is required

When the Zapper desktop host opens/joins its own Google Meet window, the injected host observer:

1. Waits for the meeting to be connected and the caption-language selection to finish/timeout.
2. Attempts to open **More options → Settings → General** in **that Meet window**.
3. Finds a specifically named **Leave empty calls** checkbox/switch. If the state is ON, it clicks OFF. If OFF, it never changes it.
4. **Verifies the new state is OFF** in Meet's interface. It does not treat a click as success. If an attempted click fails or the setting disappears, it retries a limited number of times.
5. If Google's own single-participant **Are you still there?** dialog appears first, selects the precisely labeled **Stay in the call** control in that dialog to preserve the host-initiated call while Zapper's separate host-inactivity decision remains in charge.
6. On a fresh Meet page/rejoin, the observer starts the automatic check again.

**No microphone audio or synthetic captions are used as a keepalive.** PIN participants are unaffected. The 12-minute Zapper warning and optional end/PDF generation are preserved as implemented in 1.0.3.

## Limitations

Google Meet controls its own UI and the `Leave empty calls` preference; it does not provide a supported Zapper-specific API for these settings. This implementation relies on identified UI labels and can break if Google changes them, blocks automated clicks, or disconnects the call before it can run. Only a real Google Meet session can verify current compatibility; tests here use a simulated Meet DOM.

There is **no requirement for ordinary hosts to manually visit Google Meet Settings**. If Google changes its UI, an application update may be needed; in the meantime, the host can use Zapper's Continue action, which already attempts to rejoin Meet when needed. A reconnection is not guaranteed if Google refuses the connection or ended the meeting.

## Build

From `apps/desktop`:

```powershell
node -p "require('./package.json').version"  # 1.0.4
npm install
npm run check
npm run dist
```

Expected installer: `apps/desktop/dist/Zapper-v1.0.4/Zapper-Setup-x64.exe`.

This source ZIP is not a Windows installer. The updated API and website from 1.0.3 remain compatible; neither requires a new deployment for this update.

## Automated checks

- Desktop: all `npm run check` cases, including `meet-empty-calls-guard.js` to test OFF verification, no accidental ON toggle, retry of a failed click, and Google's early reminder.
- API: `npm run check` and `npm run smoke` pass.
- Web: all existing `apps/web/tests/*.mjs` pass.
- Live Windows Meet UI and NSIS build were **not** tested in this environment.
