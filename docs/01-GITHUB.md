# 1 — Create the new GitHub repository

Recommended repo name: `zapper-platform`.

## Option A — GitHub web + command line

1. GitHub → New repository.
2. Name: `zapper-platform`.
3. Choose Private while testing.
4. Create it as an **empty repository**. Do not add a README, `.gitignore`, or license because this package already contains them.
5. Extract this ZIP into a folder named `zapper-platform`.
6. From that folder run:

```bash
git init
git add .
git commit -m "Initial Zapper platform"
git branch -M main
git remote add origin https://github.com/YOUR-ACCOUNT/zapper-platform.git
git push -u origin main
```

## Option B — GitHub CLI

If `gh` is already authenticated:

```bash
git init
git add .
git commit -m "Initial Zapper platform"
git branch -M main
gh repo create zapper-platform --private --source=. --remote=origin --push
```

After pushing, verify GitHub contains `apps/api`, `apps/web`, `apps/desktop`, and `docs`.
