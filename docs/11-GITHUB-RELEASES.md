# GitHub Releases — Zapper Windows download

The repository now includes `.github/workflows/release-desktop.yml`.

## Recommended: automatic release from a Git tag

1. Commit/push the complete source to `main`.
2. Tag the tested version:

```powershell
git tag v3.1.7
git push origin v3.1.7
```

3. GitHub Actions runs on Windows, builds `apps/desktop`, creates a GitHub Release and uploads:

```text
Zapper-Setup-x64.exe
```

4. The website Download Zapper button uses:

```text
https://github.com/shivanew-hadoop/zapper-prod/releases/latest/download/Zapper-Setup-x64.exe
```

That URL remains stable across future releases as long as the asset keeps the same filename.

## Manual alternative

Build locally on Windows:

```powershell
cd apps\desktop
npm install
npm run dist
```

The EXE is under:

```text
apps/desktop/dist/Zapper-v3.1.7/Zapper-Setup-x64.exe
```

In GitHub: **Repository → Releases → Draft a new release → choose/create tag → upload `Zapper-Setup-x64.exe` → Publish release**.
