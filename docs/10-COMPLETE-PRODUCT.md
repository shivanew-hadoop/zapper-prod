# Complete Zapper product rollout

This build is designed to be pushed to the existing **new** GitHub repository `shivanew-hadoop/zapper-prod`. It does not require reconnecting Railway or Vercel: both services can remain attached to the same repository and root directories.

## 1. Push the updated source

Replace the repository contents with this build, then:

```powershell
git add .
git commit -m "Complete Zapper host participant admin product"
git push origin main
```

Railway continues to use root directory `/apps/api`.
Vercel continues to use root directory `apps/web`.

## 2. Railway variables

Keep the existing variables and add/update these:

```text
NODE_ENV=production
DATA_DIR=/data
DEEPGRAM_API_KEY=<existing key>
JWT_SECRET=<existing stable secret>
ADMIN_KEY=<existing stable admin automation key>
ADMIN_EMAIL=<your admin login email>
ADMIN_PASSWORD=<8+ char password, needed to bootstrap a new admin account>
ADMIN_NAME=Zapper Admin
WEB_ORIGINS=https://zapper-prod.vercel.app,https://zapperapp.in,https://www.zapperapp.in
PLAN_PRICE_INR=1000
PORTAL_TOKEN_DAYS=7
HOST_SESSION_HOURS=12
PARTICIPANT_TOKEN_MINUTES=180
SESSION_RETENTION=15
TRANSCRIPT_RETENTION=15
```

Do not delete the `/data` Railway volume. The existing SQLite DB is migrated in place. Existing users become `host` users automatically. If `ADMIN_EMAIL` matches an existing account, that account is promoted to `admin` and keeps its current password.

## 3. Vercel variables

```text
VITE_API_BASE_URL=https://api.zapperapp.in
VITE_DESKTOP_DOWNLOAD_URL=https://github.com/shivanew-hadoop/zapper-downloads/releases/latest/download/Zapper-Setup-x64.exe
```

Redeploy Vercel after changing a `VITE_*` value because Vite embeds it during the build.

## 4. Test on preview before moving the root domain

Use `https://zapper-prod.vercel.app` until the full flow passes:

- Public home loads without requiring login.
- Launch/Download buttons are visible.
- Participant does not need a Zapper web account.
- Host can register/login.
- Inactive host cannot create a PIN.
- Admin login routes to the admin console.
- Admin activates a host by setting start/end dates.
- Host creates a PIN from raw Meet ID, meet.google.com URL or HTTPS URL.
- Desktop Google sign-in + PIN works.
- Transcript saves on Leave.
- PDF appears in host portal.
- 16th+ session deletes the oldest history so only latest 15 remain.

## 5. Publish Windows desktop

See `11-GITHUB-RELEASES.md`. The website download link uses the stable GitHub URL:

```text
https://github.com/shivanew-hadoop/zapper-downloads/releases/latest/download/Zapper-Setup-x64.exe
```

## 6. Final domain

Only after acceptance testing, attach `zapperapp.in` and `www.zapperapp.in` to the Vercel web project. Keep `api.zapperapp.in` pointed to Railway.
