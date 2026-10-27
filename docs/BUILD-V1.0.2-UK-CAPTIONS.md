# Zapper desktop 1.0.2 — Google Meet English (UK) / visible-caption fidelity

This source builds on the **4.3.4 Meet-captions-only** project. The desktop package version is **1.0.2** (requested installer/display version). The API and web packages retain their existing internal versions and behavior.

## Changes

- **Rendered captions:** Host and PIN participant Meet collectors read the caption leaf's visibly rendered `innerText` first, falling back to `textContent` when no rendered text is available. This addresses cases where the Meet screen shows `I wanted to see` but raw DOM text includes `I wanted Tu Si`. No automatic rewrites/translations are performed on spoken words.
- **Fewer premature final words:** Live interim captions still use a **240 ms** word-stabilization interval. Final captions now settle after about **2.4 seconds** with no new caption changes (was 1.3 seconds). That gives Meet more time to revise recognition before a final line is stored. These are local processing intervals, **not guaranteed end-to-end latency**.
- **English (UK):** The host Meet window and PIN participant Meet window each attempt to set their own caption language to **English (UK)** / **English (United Kingdom)**, through a verified language dropdown and option. If Google changes the labels/DOM or a compatible dropdown is not exposed, no unrelated button is clicked and the language may need to be selected manually. Google's caption-language choice can be per browser profile or per user.
- **Deepgram remains disabled:** Desktop audio-to-STT fallback and browser-host STT remain OFF. The API now also hard-disables Deepgram, even if an older `ZAPPER_ENABLE_DEEPGRAM_STT=true` flag or API key remains in a deployment. Existing text-only caption relay, PIN authorization and transcript persistence remain functional.
- **Preserved:** Host login overlay readiness, the Create Session gate and active-session browser lock, Google Meet host join/mic controls, PIN participants, chat, transcription PDF, and end-session behavior.

## Deployment / build

1. Deploy the updated `apps/api` so the hard-OFF provider policy is enforced on the server.
2. On Windows, unzip the updated project over a BACKUP of the existing project (or replace with the full updated project source). Build/install the new desktop app.
3. Web source was not changed in this release; it is included to keep the full project intact.

In PowerShell, from `apps\desktop`:

```powershell
node -p "require('./package.json').version"  # expect 1.0.2
npm install
npm run check
npm run dist
```

Windows installer output: `apps\desktop\dist\Zapper-v1.0.2\Zapper-Setup-x64.exe`.

If `D:` runs out of space, delete the incomplete `dist` directory or choose an output folder on a drive with sufficient space:

```powershell
Remove-Item .\dist -Recurse -Force -ErrorAction SilentlyContinue
npm run dist -- --config.directories.output=E:\ZapperBuild
```

## Verification performed in the source workspace

- Desktop: `npm run check` PASS, including simulated visible-caption-vs-raw-DOM and English (UK) selector tests.
- API: `npm run check` and `npm run smoke` PASS, including relay/session isolation and hard-OFF Deepgram mode.
- Web: all six `apps/web/tests/*.mjs` PASS, including host readiness, active-session locking and authorization.

**Not performed:** Windows NSIS installer generation, actual Google Meet caption-language UI interaction, or live acoustic accuracy/latency measurements. Since Google can change its Meet UI, confirm both host and PIN participant windows display English (UK) and the same spoken sentence in a real call before production rollout.
