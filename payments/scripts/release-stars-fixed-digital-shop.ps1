# One-command controlled Stars fixed-goods integration in the EXISTING RUST UP Telegram Mini App.
# Reuses current Worker and GitHub Pages. Hard money gates remain FALSE.
# Default: tests only; -DeployWithPaymentsOff deploys safe infrastructure + UI.
param([switch]$DeployWithPaymentsOff)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo

function Ensure([string]$label,[scriptblock]$cmd){
 Write-Host $label -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $cmd
 if($LASTEXITCODE -ne 0){throw "$label failed: $LASTEXITCODE"}
}

Ensure 'Update RUST UP feature branch' {
 git pull --ff-only origin feature/rustup-payment-admin-controls
}
Ensure 'Test native Telegram Stars product purchase UI' {
 node --test ".\payments\scripts\publish-stars-fixed-market-v3.test.mjs"
}
if(!$DeployWithPaymentsOff){
 Ensure 'Test backend preparation and Cloudflare dry-run (without deployment)' {
  powershell -NoProfile -ExecutionPolicy Bypass -File ".\payments\scripts\release-current-stars-commerce.ps1"
 }
 Write-Host 'PASS: Safe Stars fixed-goods integration preflight done. Nothing deployed.' -ForegroundColor Green
 exit 0
}
Ensure 'Deploy current RUST UP Worker with fixed-goods routes, all payment flags FALSE' {
 powershell -NoProfile -ExecutionPolicy Bypass -File ".\payments\scripts\release-current-stars-commerce.ps1" -DeployWithPaymentsOff
}
$publish=Join-Path $env:TEMP ('rustup-stars-market-'+[guid]::NewGuid().ToString('N'))
Ensure 'Clone published Telegram Mini App into clean temporary folder' {
 git clone --depth 1 --branch main https://github.com/ttzoomrust-hub/rust-up.git "$publish"
}
Ensure 'Validate native Stars buy UI against latest live website source' {
 node ".\payments\scripts\publish-stars-fixed-market-v3.mjs" "$publish" --check
}
Ensure 'Publish native Stars digital goods UI within existing Telegram Mini App' {
 node ".\payments\scripts\publish-stars-fixed-market-v3.mjs" "$publish" --publish
}
$h=Invoke-RestMethod -Uri 'https://rustup-bot.ttzoomrust.workers.dev/api/stars/health' -TimeoutSec 20
if(!$h.ok -or $h.service -ne 'rustup-fixed-stars' -or $h.productionEnabled -or $h.gameBalanceCredit){
 throw 'Unsafe payment-mode response: stop and inspect; do not activate any payment flags'
}
Write-Host 'PASS: Full fixed-goods Stars infrastructure and native Mini App UI published.' -ForegroundColor Green
Write-Host 'Real-money payment flags OFF. No products seeded or game credits added.'
