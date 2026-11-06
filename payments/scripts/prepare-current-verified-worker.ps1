# RUST UP: current supported 10/12/19/21-module bot safe update, with payments OFF.
# Default = private backup + tests + Cloudflare dry-run only.
# -DeployWithPaymentsOff explicitly uploads the reviewed fixed-goods Worker,
# NEVER activates Stars, variable top-ups, game credit, or crypto deposits.
param([switch]$DeployWithPaymentsOff)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $root
$ownsToken=$false
function Check([string]$name,[scriptblock]$action){
 Write-Host ('[RUST UP] '+$name) -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $action
 if($LASTEXITCODE -ne 0){throw ($name+' failed (exit '+$LASTEXITCODE+')')}
}
try {
 if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
  throw 'Switch to feature/rustup-payment-admin-controls first'
 }
 Check 'Fast-forward reviewed RUST UP repository'{
  git pull --ff-only origin feature/rustup-payment-admin-controls
 }
 Check 'Review original bot, supported-module source and receipt-safety tests'{
  node --test '.\payments\scripts\stage-current-verified-worker.test.mjs' '.\payments\scripts\stage-current-bot10-stars.test.mjs' '.\payments\integration\telegram-stars\stars-sqlite-e2e.test.mjs' '.\payments\integration\telegram-stars\stars-terms.test.mjs' '.\payments\integration\telegram-stars\supporter-badge.test.mjs' '.\payments\scripts\audit-stars-settlement-readonly.test.mjs'
 }
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $data=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Cloudflare login missing: npx wrangler login'}
  $auth=($data|Out-String|ConvertFrom-Json)
  if([string]::IsNullOrWhiteSpace([string]$auth.token)){
   throw 'Wrangler session has no token'
  }
  $env:CLOUDFLARE_API_TOKEN=[string]$auth.token
  $ownsToken=$true
  $data=$null;$auth=$null
 }
 Write-Host '[RUST UP] Checking for competing Wrangler publishers...' -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 node '.\payments\scripts\audit-worker-publishers.mjs'
 $auditExit=$LASTEXITCODE
 if($auditExit -eq 2){
  Write-Warning 'Another Wrangler publisher or a missing Stars D1 binding was detected.'
  if($DeployWithPaymentsOff){
   throw 'Competing Cloudflare deployments or missing finance configuration: no Worker upload until publishers are coordinated.'
  }
 }elseif($auditExit -ne 0){
  Write-Warning 'Cloudflare actor audit unavailable. Source-map and settings drift checks remain mandatory.'
  if($DeployWithPaymentsOff){
   throw 'Cannot verify deployment ownership: live Worker upload blocked.'
  }
 }
 Write-Host '[RUST UP] Privately recover exact live supported-module Worker...' -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 $log=@(node '.\payments\scripts\stage-current-verified-worker.mjs' --stage 2>&1)
 if($LASTEXITCODE -ne 0){
  $log|ForEach-Object{Write-Host $_}
  throw 'Live supported-module Worker recovery failed. No upload.'
 }
 $match=$log|Select-String '^Location:\s*(.+)$'|Select-Object -Last 1
 if(!$match){throw 'Private recovered directory not reported'}
 $dir=$match.Matches[0].Groups[1].Value.Trim()
 if(!(Test-Path -LiteralPath $dir)){throw 'Private Worker snapshot missing'}
 $entry=Join-Path $dir 'worker.stars-commerce-entry.mjs'
 $bundle=Join-Path $dir 'worker.stars-commerce.bundle.js'
 $config=Join-Path $dir 'wrangler.stars-verified.toml'
 Check 'Bundle original 10 game/bot modules + reviewed Stars adapter'{
  npx --yes esbuild "$entry" --bundle --platform=browser --format=esm --target=es2022 --sourcemap=linked "--outfile=$bundle"
 }
 Check 'Syntax check'{
  node --check "$bundle"
 }
 Check 'Cloudflare deployment dry-run, payment switches OFF'{
  npx --yes wrangler deploy --dry-run --config "$config"
 }
 Check 'Verify exact live version, bot source, cron, bindings and staged files'{
  node '.\payments\scripts\stage-current-verified-worker.mjs' --verify "$dir"
 }
 if(!$DeployWithPaymentsOff){
  Write-Host 'PASS: reviewed current supported-module bot is ready for an optional dark deploy.' -ForegroundColor Green
  Write-Host 'NOT DEPLOYED. No payment, balance, or Worker was modified.'
  exit 0
 }
 Check 'Explicit dark deploy with ALL real-money charging disabled'{
  npx --yes wrangler deploy --config "$config"
 }
 $health=Invoke-RestMethod -Uri 'https://rustup-bot.ttzoomrust.workers.dev/api/stars/health' -TimeoutSec 20
 if(!$health.ok -or $health.service -ne 'rustup-fixed-stars' -or
    $health.productionEnabled -or $health.gameBalanceCredit){
  throw 'Worker health check failed. Keep all payment controls OFF.'
 }
 Write-Host 'PASS: current RUST UP Worker redeployed. NO PAYMENTS ACTIVATED.' -ForegroundColor Green
} finally {
 if($ownsToken){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $data=$null;$auth=$null
}
