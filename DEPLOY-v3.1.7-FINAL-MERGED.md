# Zapper v3.1.7 Final Merged Deployment

This package intentionally combines:
- v3.1.7 professional responsive web portal
- v3.1.6 professional auth/admin/legal pages
- latest private-cursor overlay patch
- v3.1.7 desktop close/rejoin reliability fixes

## Verify the web source before pushing
From repository root:

```powershell
Select-String -Path .\apps\web\index.html -Pattern "Participant? Launch immediately"
Select-String -Path .\apps\web\index.html -Pattern "Two simple journeys. One meeting."
```

Both commands must return matches.

## Push to GitHub

```powershell
git status --short
git add apps/web apps/desktop DEPLOY-v3.1.7-FINAL-MERGED.md CHANGELOG-v3.1.7-desktop-close-rejoin-fix.md
git commit -m "Deploy merged v3.1.7 portal and desktop fixes"
git push origin main
```

## Vercel
Project Root Directory must be `apps/web`.
After Git push, go to Vercel -> Deployments and confirm the latest deployment is from the new commit. If automatic deployment did not run, choose Redeploy on the latest source commit.

Environment:
- `VITE_API_BASE_URL=https://api.zapperapp.in`
- `VITE_DESKTOP_DOWNLOAD_URL=https://github.com/shivanew-hadoop/zapper-prod/releases/latest/download/Zapper-Setup-x64.exe`

## Confirm live portal
Hard-refresh with Ctrl+Shift+R. The homepage must show:
- `Participant? Launch immediately.` near the top
- Launch Zapper and Download Zapper above the fold
- clear Host steps and Participant steps
- responsive mobile menu
- no subtitle under the ZAPPER logo

If the live portal still shows the old design, Vercel is deploying an older commit or a different project/root directory. Check Vercel -> Settings -> Build and Deployment -> Root Directory = `apps/web`, then redeploy the newest GitHub commit.
