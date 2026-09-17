# 5 — Build the new desktop app

The desktop project is completely separate under `apps/desktop`.

Production API config is in:

```text
apps/desktop/app-config.json
```

It currently contains:

```json
{"backendUrl":"https://api.zapper.in"}
```

## Build on Windows

Open PowerShell in `apps/desktop`:

```powershell
npm install
npm start
```

First test the unpackaged app. When the complete flow works:

```powershell
npm run dist
```

The Windows portable build is written under `apps/desktop/dist/`.

## Desktop flow

1. Open Zapper from the EXE or use the portal's `Launch Zapper` button.
2. If no saved Google session exists, Zapper opens Google Sign-In.
3. User signs in once.
4. Overlay asks only for the 6-digit session PIN.
5. PIN is sent to `api.zapper.in`.
6. API resolves the hidden Meet URL and returns a temporary signed session token.
7. Zapper opens the Meet and begins STT when Meet audio arrives.
8. On Leave, the complete transcript uploads to the host account.

The desktop makes a best-effort attempt to read the signed-in Google account email from the persistent Google profile and stores it with the transcript when available.

## Web Launch button note

The Windows machine should run the packaged Zapper EXE once so the `zapper://` protocol is registered. After that, `Launch Zapper` from the web portal can open/focus the desktop overlay. The Electron build also declares the `zapper` protocol in its builder configuration.
