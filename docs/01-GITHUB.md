# GitHub repository

Current greenfield repository:

```text
shivanew-hadoop/zapper-prod
```

Do not create another repository for this build.

## Update the current repo

Extract the complete product ZIP, copy its contents into your local `zapper-prod` checkout, then:

```powershell
git status
git add .
git commit -m "Complete Zapper product flow"
git push origin main
```

The repo is a monorepo:

```text
apps/api      -> Railway
apps/web      -> Vercel
apps/desktop  -> Windows desktop / GitHub Releases
```

The desktop release workflow is triggered by tags such as `v3.1.0` after acceptance testing.
