# Windows installer

From `apps/desktop` on Windows:

```powershell
.\build-installer.ps1
```

The installer is created under `dist/Zapper-v3.1.3/Zapper-Setup-x64.exe`.

The installer creates Desktop and Start Menu shortcuts, registers `zapper://`, and keeps the persistent Google profile on uninstall so a normal reinstall does not erase the saved Google sign-in.

For a portable build instead:

```powershell
npm run dist:portable
```
