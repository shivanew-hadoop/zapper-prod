# Zapper — end-to-end production setup

This project is a new deployment. Do **not** point it at the old Zapper Railway service or old GitHub repo.

## Final architecture

| Layer | New deployment | Production address |
|---|---|---|
| Source control | New GitHub repository | e.g. `your-org/zapper-platform` |
| Web portal | New Vercel project | `https://zapper.in` |
| API/STT backend | New Railway project/service | `https://api.zapper.in` |
| Database | SQLite on new Railway persistent volume | `/data/zapper.db` |
| Desktop | Electron build from `apps/desktop` | Windows portable EXE |

## Do this in order

1. Create the new GitHub repository — `docs/01-GITHUB.md`.
2. Create the new Railway backend and `/data` volume — `docs/02-RAILWAY.md`.
3. Point `api.zapper.in` to Railway and verify `/health`.
4. Deploy the web portal to Vercel — `docs/03-WEB-VERCEL.md`.
5. Point `zapper.in` (and optionally `www.zapper.in`) to Vercel.
6. Register your first test account on `https://zapper.in`.
7. Activate its subscription using `docs/04-SUBSCRIPTION-ADMIN.md`.
8. Build the desktop app — `docs/05-DESKTOP.md`.
9. Execute every test in `docs/06-PRODUCTION-TEST.md`.

Do not build the final desktop EXE until `https://api.zapper.in/health` is working, because the desktop production config already targets that API hostname.
