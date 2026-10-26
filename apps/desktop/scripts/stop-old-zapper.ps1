# Run only after saving meeting work: this ends all Zapper desktop calls locally.
$ErrorActionPreference = 'Stop'
$zapperProcesses = Get-CimInstance -ClassName Win32_Process -Filter "Name = 'Zapper.exe'"
if (-not $zapperProcesses) {
  Write-Host 'Zapper is not running.' -ForegroundColor Green
  exit 0
}
foreach ($proc in $zapperProcesses) {
  Write-Host "Stopping Zapper PID $($proc.ProcessId) and child processes..." -ForegroundColor Yellow
  & taskkill.exe /F /T /PID $proc.ProcessId | Out-Host
}
$remaining = Get-CimInstance -ClassName Win32_Process -Filter "Name = 'Zapper.exe'"
if ($remaining) { throw 'Zapper is still running. Close it in Task Manager before reinstalling.' }
Write-Host 'All Zapper processes have stopped. Installation can proceed.' -ForegroundColor Green
