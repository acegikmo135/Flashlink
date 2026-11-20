<#
 Build MCUBridge.exe (PyInstaller, one-folder, no Electron / no Node on the PC).
 Requires Python 3.12 (python.org or `winget install Python.Python.3.12`).
 Output: desktop\dist\MCUBridge\  and  desktop\dist\MCUBridge-win64.zip
#>
param([string]$Server)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $root 'desktop'
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { Write-Host 'Python 3.12 is required.' -ForegroundColor Red; exit 1 }

# bake the Worker URL from setup (or -Server) into the build
$cfgPath = Join-Path $root '.mcu-bridge\config.json'
if ($Server) { Set-Content -Path (Join-Path $desktop 'server_url.txt') -Value $Server }
elseif (Test-Path $cfgPath) {
  $url = (Get-Content $cfgPath -Raw | ConvertFrom-Json).worker_url
  if ($url) { Set-Content -Path (Join-Path $desktop 'server_url.txt') -Value $url }
}

$venv = Join-Path $desktop '.venv'
if (-not (Test-Path $venv)) { python -m venv $venv }
$py = Join-Path $venv 'Scripts\python.exe'
& $py -m pip install --upgrade pip | Out-Null
& $py -m pip install -r (Join-Path $desktop 'requirements.txt')
Push-Location $desktop
try {
  & $py -m pytest tests/test_manifest.py tests/test_hardware.py -q
  if ($LASTEXITCODE -ne 0) { throw 'Unit tests failed' }
  & $py build.py
} finally { Pop-Location }
Write-Host "`nBuilt: $desktop\dist\MCUBridge\MCUBridge.exe" -ForegroundColor Green

# installer (optional: needs Inno Setup 6 -> winget install JRSoftware.InnoSetup)
$iscc = (Get-Command iscc -ErrorAction SilentlyContinue).Source
if (-not $iscc) { $c = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"; if (Test-Path $c) { $iscc = $c } }
if ($iscc) {
  & $iscc /Qp "/DAppVersion=0.1.0" (Join-Path $desktop 'installer\mcubridge.iss')
  if ($LASTEXITCODE -eq 0) { Write-Host "Installer: $desktop\dist\MCUBridge-Setup.exe" -ForegroundColor Green }
} else { Write-Host 'Inno Setup not found - skipped the installer (winget install JRSoftware.InnoSetup).' -ForegroundColor Yellow }
