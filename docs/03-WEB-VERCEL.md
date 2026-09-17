# 3 — Zapper.in web portal on Vercel

## Create the project

1. Vercel → Add New Project.
2. Import the new GitHub `zapper-platform` repository.
3. Project name: `zapper-web`.
4. Root Directory: `apps/web`.
5. Framework should be detected as Vite.
6. Build command: `npm run build`.
7. Output directory: `dist`.

## Environment variables

Add for Production (and Preview if desired):

```text
VITE_API_BASE_URL=https://api.zapper.in
VITE_DESKTOP_DOWNLOAD_URL=
```

Leave `VITE_DESKTOP_DOWNLOAD_URL` empty until you have a public URL for the Windows EXE. The Launch button still uses `zapper://launch`.

Redeploy after changing a Vite environment variable because it is embedded at build time.

## Domain

1. Vercel project → Settings → Domains.
2. Add `zapper.in`.
3. Optionally add `www.zapper.in` and redirect it to `zapper.in`.
4. Vercel will show the DNS records required for your domain provider. Add exactly those records.

## Verify before desktop

At `https://zapper.in`:

- Sign-up form opens.
- A new user can register.
- Login works after logout.
- Account page loads without a CORS error.
- Inactive subscription is shown clearly.
