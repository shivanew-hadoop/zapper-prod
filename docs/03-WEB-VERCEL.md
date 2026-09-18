# 3 — Web portal on Vercel

Keep the existing Vercel project connected to the same repository.

## Project settings

- Root Directory: `apps/web`
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`

## Production variables

```text
VITE_API_BASE_URL=https://api.zapperapp.in
VITE_DESKTOP_DOWNLOAD_URL=https://github.com/shivanew-hadoop/zapper-prod/releases/latest/download/Zapper-Setup-x64.exe
```

`VITE_API_BASE_URL` and the GitHub download URL are public browser configuration, so they should be Vercel **Config** values, not secrets.

Redeploy after changing a `VITE_*` variable because Vite embeds these values during build.

## Acceptance-test URL

Keep using:

```text
https://zapper-prod.vercel.app
```

until the complete host → PIN → desktop → transcript → PDF flow passes.

Only then attach:

- `zapperapp.in`
- `www.zapperapp.in`

Keep `api.zapperapp.in` on Railway.
