# 2 — Railway backend

The current new Zapper backend remains deployed from the same `zapper-prod` GitHub repository.

## Service settings

- Root Directory: `/apps/api`
- Start command: `npm start`
- Health check: `/health`
- Custom domain: `api.zapperapp.in`
- Persistent Volume mount: `/data`

Do not delete the `/data` volume; it contains the SQLite database and survives redeployments.

## Production variables

```text
NODE_ENV=production
DEEPGRAM_API_KEY=<your real Deepgram key>
JWT_SECRET=<stable long random secret>
ADMIN_KEY=<different stable long random secret for CLI automation only>
ADMIN_EMAIL=<your admin login email>
ADMIN_PASSWORD=<8+ character bootstrap password if admin account does not already exist>
ADMIN_NAME=Zapper Admin
DATA_DIR=/data
WEB_ORIGINS=https://zapper-prod.vercel.app,https://zapperapp.in,https://www.zapperapp.in
PLAN_PRICE_INR=1000
PORTAL_TOKEN_DAYS=7
HOST_SESSION_HOURS=12
PARTICIPANT_TOKEN_MINUTES=180
SESSION_RETENTION=15
TRANSCRIPT_RETENTION=15
```

Important: in Railway the value of `WEB_ORIGINS` must be only the comma-separated URLs. Do not put `WEB_ORIGINS=` inside the value box.

## Admin bootstrap

On startup:

- If `ADMIN_EMAIL` already exists, that account is promoted to role `admin` and keeps its current password.
- If it does not exist, `ADMIN_PASSWORD` is used to create the admin account.
- The same normal website Login form routes an admin to the admin console.

## Verify

```text
https://api.zapperapp.in/health
```

Expected:

```json
{"ok":true,"service":"zapper-api","databaseReady":true,"deepgramConfigured":true}
```
