# GitHub Releases — Zapper Windows download

## Repository split

Keep the application source repository private:

```text
https://github.com/shivanew-hadoop/zapper-prod
```

Use the public binary-only repository for customer downloads:

```text
https://github.com/shivanew-hadoop/zapper-downloads
```

Do not copy application source into `zapper-downloads`. It only needs a small README and GitHub Release assets.

## Stable customer download URL

Every published release in `zapper-downloads` must contain an asset named exactly:

```text
Zapper-Setup-x64.exe
```

The website and desktop overlay use this permanent URL:

```text
https://github.com/shivanew-hadoop/zapper-downloads/releases/latest/download/Zapper-Setup-x64.exe
```

The installed desktop version is displayed inside the Zapper overlay from `apps/desktop/package.json`.

## Build locally on Windows

```powershell
cd apps\desktop
npm install
npm run dist
```

For version 3.1.8 the installer is under:

```text
apps/desktop/dist/Zapper-v3.1.8/Zapper-Setup-x64.exe
```

## Publish manually to the public downloads repository

1. Open `https://github.com/shivanew-hadoop/zapper-downloads`.
2. Open **Releases** → **Draft a new release**.
3. Create a version tag, for example `v3.1.8`.
4. Release title: `Zapper v3.1.8`.
5. Upload the built file **without renaming it**: `Zapper-Setup-x64.exe`.
6. Publish it as a normal release (not draft/prerelease) when it should become the latest customer download.
7. Verify the stable `/releases/latest/download/Zapper-Setup-x64.exe` link downloads the new installer.

For the next version, update `apps/desktop/package.json`, rebuild, publish a new release/tag, and upload the same fixed asset filename. No Vercel URL change is needed.
