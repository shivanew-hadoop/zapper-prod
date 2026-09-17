# 2 — New Railway backend

Create a **new Railway project**. Do not reuse the old Zapper service.

## Service

1. Railway → New Project.
2. Add a service from the new GitHub `zapper-platform` repo.
3. Service name: `zapper-api`.
4. Service Settings → Root Directory: `/apps/api`.
5. Railway will use `apps/api/railway.json` and `npm start`.

## Persistent SQLite volume

1. Add a Railway Volume to `zapper-api`.
2. Mount path: `/data`.
3. Do not store the production DB anywhere outside this volume.

The API resolves its database folder in this order: `DATA_DIR`, Railway's volume mount variable, then local `./data`.

## Required variables

Set these on the `zapper-api` service:

```text
NODE_ENV=production
DEEPGRAM_API_KEY=<your real Deepgram key>
JWT_SECRET=<long random secret, keep permanently>
ADMIN_KEY=<different long random admin secret>
DATA_DIR=/data
WEB_ORIGINS=https://zapper.in,https://www.zapper.in
PLAN_PRICE_INR=1000
DEFAULT_TRIAL_DAYS=0
PORTAL_TOKEN_DAYS=7
HOST_SESSION_HOURS=12
PARTICIPANT_TOKEN_MINUTES=180
TRANSCRIPT_RETENTION=20
```

Generate secrets locally, for example:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Run it twice: one result for `JWT_SECRET`, another for `ADMIN_KEY`.

## Domain

1. Railway service → Networking/Custom Domain.
2. Add `api.zapper.in`.
3. Railway will show the DNS record you must create at your domain/DNS provider.
4. Add exactly the record Railway shows.
5. Wait until Railway reports the custom domain as active.

## Verify

Open:

```text
https://api.zapper.in/health
```

Expected shape:

```json
{"ok":true,"service":"zapper-api","databaseReady":true,"deepgramConfigured":true}
```

Do not continue to the desktop build until this works.
