<#
 MCU Bridge — first-time setup for Windows (PowerShell 5.1+ / 7).
 Installs project dependencies, logs you in to Cloudflare through Wrangler's
 browser OAuth, creates the D1 database, deploys the Worker and prints your
 invite code + Claude Code MCP command. Safe to re-run.
 Usage:  .\scripts\setup.ps1 [-DeployOnly] [-RotateSecrets] [-DryRun] [-Domain mcub.example.com]
#>
param([switch]$DeployOnly, [switch]$RotateSecrets, [switch]$DryRun, [string]$Domain = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "Missing: $cmd. $hint" -ForegroundColor Red
    exit 1
  }
}
Need node 'Install Node.js LTS:  winget install OpenJS.NodeJS.LTS   (then reopen PowerShell)'
Need npm  'npm ships with Node.js.'

$flags = @()
if ($DeployOnly)    { $flags += '--deploy-only' }
if ($RotateSecrets) { $flags += '--rotate-secrets' }
if ($DryRun)        { $flags += '--dry-run' }
if ($Domain)        { $flags += @('--domain', $Domain) }
& node (Join-Path $PSScriptRoot 'setup.mjs') @flags
exit $LASTEXITCODE
