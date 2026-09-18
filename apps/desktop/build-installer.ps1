$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Write-Host "Installing Zapper desktop dependencies..." -ForegroundColor Cyan
npm install
Write-Host "Running syntax checks..." -ForegroundColor Cyan
npm run check
Write-Host "Building Windows installer..." -ForegroundColor Cyan
npm run dist
$installer = Get-ChildItem -Path "$PSScriptRoot\dist" -Filter "Zapper-Setup-x64.exe" -Recurse | Select-Object -First 1
if (-not $installer) { throw "Installer was not produced." }
Write-Host "Installer created:" -ForegroundColor Green
Write-Host $installer.FullName -ForegroundColor Green
