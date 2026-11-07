# ONE-COMMAND RUST UP safety verification for the entire existing project.
# Local comprehensive checks: crypto multi-project, Stars, bot, Mini App, wallet.
# Live Cloudflare checks are strictly READ-ONLY; nothing is deployed or charged.
param(
 [switch]$Quick,
 [switch]$OfflineOnly
)
$ErrorActionPreference='Stop'
$branch='feature/rustup-payment-admin-controls'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if(!(Test-Path -LiteralPath (Join-Path $root '.git'))){
 throw "RUST-UP-Local git repository not found at $root"
}
Set-Location -LiteralPath $root
$currentBranch=git branch --show-current
if($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($currentBranch)){
 throw 'Git branch lookup failed. Verify RUST-UP-Local checkout.'
}
if($currentBranch.Trim() -ne $branch){
 throw "Wrong Git branch. Expected $branch"
}
Write-Host '[1/4] Synchronizing already reviewed code...' -ForegroundColor Cyan
git pull --ff-only origin $branch
if($LASTEXITCODE -ne 0){throw 'Git pull failed. No tests or live changes performed.'}
if(!(Test-Path '.\payments\scripts\full-system-selftest.mjs')){
 throw 'Full RUST UP system selftest missing after git pull'
}
Write-Host '[2/4] Testing complete system OFFLINE (no real funds)...' -ForegroundColor Cyan
$testArgs=@('.\payments\scripts\full-system-selftest.mjs')
if($Quick){$testArgs+='--quick'}
& node @testArgs
if($LASTEXITCODE -ne 0){
 throw 'Some system tests FAILED. Inspect payments/.local-test-results/system-last-run.json'
}
if($OfflineOnly){
 Write-Host 'PASS: Full offline suite done. Live API not queried. Payments unchanged.' -ForegroundColor Green
 exit 0
}
Write-Host '[3/4] Checking live Stars Worker and price setup, READ ONLY...' -ForegroundColor Cyan
& powershell -NoProfile -ExecutionPolicy Bypass -File '.\payments\scripts\check-stars-activation.ps1'
if($LASTEXITCODE -ne 0){throw 'Cloudflare Stars readiness diagnostic failed; no money enabled'}
Write-Host '[4/4] Reconcile variable Stars order statuses, READ ONLY...' -ForegroundColor Cyan
& powershell -NoProfile -ExecutionPolicy Bypass -File '.\payments\scripts\audit-variable-stars.ps1'
if($LASTEXITCODE -ne 0){throw 'Live Stars payment audit found a problem; manual review required'}
Write-Host 'PASS: Full system offline checks and live READ-ONLY audit finished.' -ForegroundColor Green
Write-Host 'WARNING: No real-money readiness certified. Production payment flags remain OFF.'
