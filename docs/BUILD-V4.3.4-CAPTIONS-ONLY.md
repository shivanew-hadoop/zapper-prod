# Zapper 4.3.4 — native Meet captions only; Deepgram disabled

## Behaviour
- Desktop `DEEPGRAM_FALLBACK_ENABLED = false` blocks audio-forwarding and ignores any stray Deepgram transcriptions. The normal `/stt` caption-only relay is still used for live captions, PIN participants and PDF persistence.
- API `ZAPPER_ENABLE_DEEPGRAM_STT` defaults to **false** even if an old `DEEPGRAM_API_KEY` is configured. In this mode, `/stt` discards all binary PCM and accepts authenticated `local_caption` JSON messages as before. `/health/stt` reports STT disabled.
- Web host browser microphone-to-STT was already disabled (`HOST_MIC_TO_STT = false`). Meet host microphone control remains functional.
- When Google Meet itself provides no captions, the overlay cannot recover missing words via Deepgram; check that CC is enabled in Meet.
- No changes to create-session gating, overlay readiness, Google Meet host joining, PIN validation, PDF relay, or active-session ownership.

## Fix the Windows out-of-disk build error
The error `write ...\win-unpacked\electron.exe: There is not enough space on the disk` indicates the build OUTPUT drive is full. The subsequent `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE` is secondary, not the root cause.

From `apps\desktop` in PowerShell:
```powershell
Get-PSDrive D
# Delete incomplete build artifacts only, NOT node_modules or application data
Remove-Item -Path .\dist -Recurse -Force -ErrorAction SilentlyContinue
npm install
npm run check
npm run dist
```
If D: is still low on free space, build on a drive with room (example E:):
```powershell
New-Item -ItemType Directory -Force -Path 'E:\ZapperBuild','E:\ZapperTemp','E:\ZapperCache' | Out-Null
$env:TEMP='E:\ZapperTemp'
$env:TMP='E:\ZapperTemp'
$env:ELECTRON_CACHE='E:\ZapperCache'
$env:ELECTRON_BUILDER_CACHE='E:\ZapperCache'
npm run dist -- --config.directories.output='E:\ZapperBuild'
```
Use an existing drive letter with ample space; do not try E: if you have no E: drive.

**Important:** If the build banner says `@zapper/desktop@1.0.1`, you are building an old project. After replacing the source, `node -p "require('./package.json').version"` should say `4.3.4`.

## Deployment
1. Deploy updated API first (defaults Deepgram STT OFF).
2. Publish and install rebuilt Windows Zapper 4.3.4 app.
3. Existing web portal requires no change for this patch.

Offline automated tests cover syntax, native caption routing, provider-off default, and regression paths. A live Windows + Google Meet session is still necessary for end-to-end CC validation.
