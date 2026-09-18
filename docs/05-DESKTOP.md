# 5 — Desktop app

Production API config:

```json
{"backendUrl":"https://api.zapperapp.in"}
```

## Participant flow

1. Click public website **Launch Zapper** or open the EXE.
2. Desktop checks the persistent Google profile.
3. If Google is not signed in, Sign-In opens automatically.
4. After Google is signed in, participant enters only the 6-digit host PIN.
5. API validates the host subscription and resolves the Meet URL.
6. Existing transcription/overlay starts.
7. On Leave, the full transcript and a generated PDF are stored against the host account.

The participant never needs a Zapper website username/password.

## Local test

```powershell
cd apps\desktop
npm install
npm start
```

## Windows distribution

```powershell
npm run dist
```

Output:

```text
apps/desktop/dist/Zapper-v3.1.1/Zapper-Setup-x64.exe
```

For production download, publish the EXE through GitHub Releases; see `11-GITHUB-RELEASES.md`.
