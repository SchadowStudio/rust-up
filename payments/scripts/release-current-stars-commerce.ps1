# Stages complete Telegram Stars fixed-goods checkout, native receipts and refunds.
# Exact current game and bot preserved. Every real-payment gate remains FALSE.
# Default: tests and dry-run only. Add -DeployWithPaymentsOff for safe dark launch.
param([switch]$DeployWithPaymentsOff)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo
function Step([string]$name,[scriptblock]$action){
 Write-Host ("`n["+$name+"]") -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $action
 if($LASTEXITCODE -ne 0){throw "$name failed ($LASTEXITCODE)"}
}
if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
 throw 'Must use RUST-UP-Local feature/rustup-payment-admin-controls'
}
if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
 try{
  $raw=& npx --yes wrangler auth token --json 2>$null
  if($LASTEXITCODE -ne 0){throw 'Wrangler session unavailable'}
  $auth=($raw|Out-String|ConvertFrom-Json)
  if($auth.type -notin @('oauth','api_token') -or [string]::IsNullOrWhiteSpace([string]$auth.token)){throw 'Invalid session'}
  $env:CLOUDFLARE_API_TOKEN=[string]$auth.token
  Write-Host 'PASS: Existing Wrangler session loaded privately.'
 }catch{throw 'Please run npx wrangler login, never paste token here.'}
 finally{$raw=$null;$auth=$null}
}
Step 'Update repository' {git pull --ff-only origin feature/rustup-payment-admin-controls}
Step 'Stars invoice, receipt, refund and replay tests' {
 node --test ".\payments\integration\telegram-stars\stars-sqlite-e2e.test.mjs" ".\payments\integration\telegram-stars\stars.test.mjs" ".\payments\integration\telegram-stars\refunds.test.mjs" ".\payments\integration\telegram-stars\payment-controls.test.mjs"
}
Step 'Current bot wrapper tests' {
 node --test ".\payments\scripts\stage-current-stars-commerce.test.mjs"
}
Step 'Game import integrity tests' {
 node --test ".\payments\integration\existing-game-state-sandbox\strict-first-login-guard.test.mjs"
}
Step 'Source syntax' {
 node --check ".\payments\integration\telegram-stars\worker.stars-commerce-entry.mjs"
 if($LASTEXITCODE -ne 0){throw 'Commerce entry invalid'}
 node --check ".\payments\scripts\stage-current-stars-commerce.mjs"
}
Write-Host 'Recover exact latest current bot privately...' -ForegroundColor Cyan
$global:LASTEXITCODE=0
$log=@(node ".\payments\scripts\recover-current-stars-readonly.mjs" 2>&1)
if($LASTEXITCODE -ne 0){$log|ForEach-Object{Write-Host $_};throw 'Current live source recovery failed'}
$found=$log|Select-String -Pattern '^Location:\s*(.+)$'|Select-Object -Last 1
if(!$found){throw 'Recovered source path missing'}
$dir=$found.Matches[0].Groups[1].Value.Trim()
if(!(Test-Path -LiteralPath $dir)){throw 'Recovery directory missing'}
Step 'Stage exact latest bot with Stars fixed-goods adapter, all money flags OFF' {
 node ".\payments\scripts\stage-current-stars-commerce.mjs" "$dir"
}
$entry=Join-Path $dir 'worker.stars-commerce-entry.mjs'
$bundle=Join-Path $dir 'worker.stars-commerce.bundle.js'
$config=Join-Path $dir 'wrangler.stars-commerce.toml'
Step 'Build current bot and native Telegram Stars invoice+receipt adapter' {
 npx --yes esbuild "$entry" --bundle --platform=browser --format=esm --target=es2022 --sourcemap=linked "--outfile=$bundle"
}
Step 'Check Worker bundle syntax' {node --check "$bundle"}
Step 'Cloudflare dry-run both D1 databases + disabled payment gates' {
 npx --yes wrangler deploy --dry-run --config "$config"
}
Step 'Verify current live Worker has not changed' {
 node ".\payments\scripts\stage-current-stars-commerce.mjs" "$dir" --check-live
}
if(!$DeployWithPaymentsOff){
 Write-Host 'PASS: Stars full fixed-goods adapter preflight completed. NO DEPLOYMENT.' -ForegroundColor Green
 exit 0
}
Step 'Deploy current bot with all real-payment flags FALSE' {
 npx --yes wrangler deploy --config "$config"
}
$check=Invoke-RestMethod -Uri "https://rustup-bot.ttzoomrust.workers.dev/api/stars/health" -TimeoutSec 20
if(!$check.ok -or $check.service -ne 'rustup-fixed-stars' -or $check.productionEnabled -or $check.gameBalanceCredit){
 throw 'Live Stars health was not safe; do not enable any payment switches'
}
Write-Host 'PASS: Full Stars fixed-goods routes online but payments remain OFF.' -ForegroundColor Green
