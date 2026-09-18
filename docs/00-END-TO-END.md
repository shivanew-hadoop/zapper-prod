# End-to-end deployment map

You already have the new greenfield deployment connected. This build upgrades that same **new** project; it does not touch the historical/old Zapper project.

| Layer | Current target |
|---|---|
| GitHub | `shivanew-hadoop/zapper-prod` |
| Railway API | repo root `/apps/api` |
| API domain | `https://api.zapperapp.in` |
| Railway database | `/data/zapper.db` on persistent volume |
| Vercel web | repo root `apps/web` |
| Acceptance web URL | `https://zapper-prod.vercel.app` |
| Final web domain | `https://zapperapp.in` |
| Desktop | `apps/desktop` |
| Windows releases | GitHub Releases |

## Rollout order

1. Push this updated source to `shivanew-hadoop/zapper-prod`.
2. Railway redeploys `/apps/api`; keep the `/data` volume.
3. Add `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `SESSION_RETENTION=15`, `TRANSCRIPT_RETENTION=15` in Railway.
4. Vercel redeploys `apps/web` with `VITE_API_BASE_URL=https://api.zapperapp.in`.
5. Test admin login, host subscription activation and session creation on `zapper-prod.vercel.app`.
6. Run desktop locally with `npm start`, test Google Sign-In + six-digit PIN + transcription + Leave.
7. Confirm the host portal receives the stored PDF.
8. Build/release the Windows EXE to GitHub Releases.
9. Confirm Download Zapper works from the preview site.
10. Only then connect `zapperapp.in` to Vercel.

Read `10-COMPLETE-PRODUCT.md` for the exact variables and `11-GITHUB-RELEASES.md` for the desktop release.
