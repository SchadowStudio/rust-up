# RUST UP: stage CURRENT Cloudflare bot (10 modules) without touching games.
# Default tests, private backup, Worker build and dry run ONLY.
# -DeployWithPaymentsOff explicitly publishes the same bot + fixed Stars API,
# while every payment and game-wallet charging gate remains FALSE.
param([switch]$DeployWithPaymentsOff)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $repo
if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
 throw 'Required branch: feature/rustup-payment-admin-controls'
}
function Check([string]$name,[scriptblock]$step){
 Write-Host ("[RUST UP] "+$name) -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $step
 if($LASTEXITCODE -ne 0){throw ($name+' failed ('+$LASTEXITCODE+')')}
}
Check 'Fast-forward existing repo' {
 git pull --ff-only origin feature/rustup-payment-admin-controls
}
Check 'Stars buyer terms, receipts, refund and release checks' {
 node --test ".\payments\integration\telegram-stars\stars-sqlite-e2e.test.mjs" ".\payments\integration\telegram-stars\stars-terms.test.mjs" ".\payments\integration\telegram-stars\supporter-badge.test.mjs" ".\payments\scripts\stage-current-bot10-stars.test.mjs" ".\payments\scripts\supporter-payment-preflight.test.mjs"
}
if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
 try{
  $secret=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Wrangler login missing'}
  $cred=($secret|Out-String|ConvertFrom-Json)
  if($cred.type -notin @('oauth','api_token') -or
     [string]::IsNullOrWhiteSpace([string]$cred.token)){
    throw 'Wrangler token unavailable'
  }
  $env:CLOUDFLARE_API_TOKEN=[string]$cred.token
 }catch{throw 'Run npx wrangler login locally. Never send tokens in chat.'}
 finally{$secret=$null;$cred=$null}
}
Write-Host '[RUST UP] Recovering exact current live bot privately...' -ForegroundColor Cyan
$global:LASTEXITCODE=0
$log=@(node ".\payments\scripts\stage-current-bot10-stars.mjs" --prepare 2>&1)
if($LASTEXITCODE -ne 0){
 $log|ForEach-Object{Write-Host $_}
 throw 'Live source is no longer the reviewed ten-module version. No deployment.'
}
$match=$log|Select-String -Pattern '^Location:\s*(.+)$'|Select-Object -Last 1
if(!$match){throw 'Private recovery path missing'}
$dir=$match.Matches[0].Groups[1].Value.Trim()
if(!(Test-Path -LiteralPath $dir)){throw 'Private stage not found'}
$entry=Join-Path $dir 'worker.stars-commerce-entry.mjs'
$bundle=Join-Path $dir 'worker.stars-commerce.bundle.js'
$cfg=Join-Path $dir 'wrangler.stars-current10.toml'
Check 'Bundle original bot and authenticated fixed-goods Stars API' {
 npx --yes esbuild "$entry" --bundle --platform=browser --format=esm --target=es2022 --sourcemap=linked "--outfile=$bundle"
}
Check 'Syntax check, no payment sent' {
 node --check "$bundle"
}
Check 'Cloudflare dry run with all payment switches OFF' {
 npx --yes wrangler deploy --dry-run --config "$cfg"
}
Check 'Verify live Worker, crons, game source and bindings unchanged' {
 node ".\payments\scripts\stage-current-bot10-stars.mjs" --verify "$dir"
}
if(!$DeployWithPaymentsOff){
 Write-Host 'PASS: Current RUST UP Worker safely staged and validated.' -ForegroundColor Green
 Write-Host 'NOT DEPLOYED. All payment gates OFF. No game balance modified.'
 exit 0
}
Check 'Dark deploy current bot with Stars routes, real payments OFF' {
 npx --yes wrangler deploy --config "$cfg"
}
$health=Invoke-RestMethod -Uri 'https://rustup-bot.ttzoomrust.workers.dev/api/stars/health' -TimeoutSec 20
if(!$health.ok -or $health.service -ne 'rustup-fixed-stars' -or
   $health.productionEnabled -or $health.gameBalanceCredit){
 throw 'Dark deployment health failed. Do not turn payment gates on.'
}
Write-Host 'PASS: Existing Worker updated, with Stars digital-goods API. No money activated.' -ForegroundColor Green
