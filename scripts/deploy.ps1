<# Re-deploy the Worker after code changes (assumes setup.ps1 was run once). #>
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'Node.js is required.' -ForegroundColor Red; exit 1 }
Push-Location (Join-Path (Split-Path -Parent $PSScriptRoot) 'cloud')
try {
  npm install --no-audit --no-fund
  npx tsc --noEmit
  if ($LASTEXITCODE -ne 0) { throw 'Type check failed' }
  npx wrangler d1 migrations apply mcu-bridge --remote
  npx wrangler deploy
} finally { Pop-Location }
