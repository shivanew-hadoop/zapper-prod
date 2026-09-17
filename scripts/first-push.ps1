param(
  [Parameter(Mandatory=$true)][string]$RemoteUrl
)
git init
git add .
git commit -m "Initial Zapper platform"
git branch -M main
git remote add origin $RemoteUrl
git push -u origin main
