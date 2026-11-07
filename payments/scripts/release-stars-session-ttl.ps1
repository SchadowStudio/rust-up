# RUST UP Telegram Mini App: fix stale initData for READ-ONLY Stars catalogue/history.
# Rebuilds the exact current 12-module Cloudflare Worker, all payments stay OFF.
# No changes to game wallet, cases, admin, Telegram webhook or cron.
# Safety preflight (default):
# powershell -ExecutionPolicy Bypass -File .\payments\scripts\release-stars-session-ttl.ps1
# Deploy tested backend + website:
# powershell -ExecutionPolicy Bypass -File .\payments\scripts\release-stars-session-ttl.ps1 -DeployReadOnly
param([switch]$DeployReadOnly)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo
function Run([string]$title,[scriptblock]$cmd){
 Write-Host ("`n["+$title+"]") -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $cmd
 if($LASTEXITCODE -ne 0){throw "$title failed (exit $LASTEXITCODE)"}
}
if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
 throw 'RUST-UP-Local must be on feature/rustup-payment-admin-controls'
}
if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
 try{
  $raw=& npx --yes wrangler auth token --json 2>$null
  if($LASTEXITCODE -ne 0){throw 'no Wrangler credentials'}
  $credential=($raw|Out-String|ConvertFrom-Json)
  if($credential.type -notin @('oauth','api_token') -or
    [string]::IsNullOrWhiteSpace([string]$credential.token)){
    throw 'unsupported Wrangler credentials'
  }
  $env:CLOUDFLARE_API_TOKEN=[string]$credential.token
  Write-Host 'PASS: Existing Wrangler authorization loaded privately.' -ForegroundColor Green
 }catch{
  throw 'Wrangler authentication unavailable; run npx wrangler login and retry. Never share access tokens.'
 }finally{$raw=$null;$credential=$null}
}
Run 'Update feature branch' {git pull --ff-only origin feature/rustup-payment-admin-controls}
Run 'Stars API and session-age security tests'{
 node --test ".\payments\integration\telegram-stars\stars-readonly-live.test.mjs"
}
Run 'Exact-source hotfix and Cloudflare configuration tests'{
 node --test ".\payments\scripts\prepare-stars-readonly-ttl.test.mjs"
}
Run 'Mini App browser session and cache-key tests'{
 node --test ".\payments\scripts\publish-stars-session-refresh.test.mjs"
}
Run 'Backend/frontend source syntax checks'{
 node --check ".\payments\scripts\recover-current-stars-readonly.mjs"
 if($LASTEXITCODE -ne 0){throw 'recovery syntax failure'}
 node --check ".\payments\scripts\prepare-stars-readonly-ttl.mjs"
 if($LASTEXITCODE -ne 0){throw 'preparer syntax failure'}
 node --check ".\payments\frontend\telegram-miniapp\stars-readonly-v2.js"
}
Write-Host "`n[Recover EXACT currently deployed Stars bot]" -ForegroundColor Cyan
$global:LASTEXITCODE=0
$log=@(node ".\payments\scripts\recover-current-stars-readonly.mjs" 2>&1)
if($LASTEXITCODE -ne 0){
 $log|ForEach-Object{Write-Host $_}
 throw 'Current bot source recovery failed'
}
$match=$log|Select-String -Pattern '^Location:\s*(.+)$'|Select-Object -Last 1
if(!$match){throw 'Recovery path missing'}
$dir=$match.Matches[0].Groups[1].Value.Trim()
if(!(Test-Path -LiteralPath $dir)){throw 'Private source directory not found'}
Write-Host 'PASS: Latest 12-module Stars bot privately backed up.' -ForegroundColor Green
Run 'Apply exact-source Stars read-only TTL fix (private staging only)'{
 node ".\payments\scripts\prepare-stars-readonly-ttl.mjs" "$dir"
}
$entry=Join-Path $dir 'worker.stars-readonly-entry.mjs'
$bundle=Join-Path $dir 'worker.stars-readonly.bundle.js'
$config=Join-Path $dir 'wrangler.stars-readonly-ttl.toml'
Run 'Compile current games and bot plus read-only 24h fix'{
 npx --yes esbuild "$entry" --bundle --platform=browser --format=esm --target=es2022 --sourcemap=linked "--outfile=$bundle"
}
Run 'Worker bundle syntax' {node --check "$bundle"}
Run 'Worker dry-run, money gates must remain false'{
 npx --yes wrangler deploy --dry-run --config "$config"
}
Run 'Verify live Cloudflare source did NOT change during preparation'{
 node ".\payments\scripts\prepare-stars-readonly-ttl.mjs" "$dir" --check-live
}
if(!$DeployReadOnly){
 Write-Host "`nPASS: Read-only session TTL preflight finished. Nothing deployed." -ForegroundColor Green
 exit 0
}
Run 'Deploy exact current bot with read-only TTL fix'{
 npx --yes wrangler deploy --config "$config"
}
Write-Host "`n[Verify live readonly API and money gates]" -ForegroundColor Cyan
$api='https://rustup-bot.ttzoomrust.workers.dev'
$health=Invoke-RestMethod -Uri "$api/api/stars/health" -TimeoutSec 20
if(!$health.ok -or $health.service -ne 'rustup-stars-readonly' -or
   $health.checkoutEnabled -or $health.productionEnabled -or $health.gameBalanceCredit){
 throw 'Unsafe or invalid deployed Stars health check'
}
Write-Host 'PASS: Read-only Stars API online and all payment gates OFF.' -ForegroundColor Green
Run 'Clone the latest Telegram Mini App to a separate publish directory'{
 $global:publish=Join-Path $env:TEMP ('rustup-stars-session-'+[guid]::NewGuid().ToString('N'))
 git clone --depth 1 --branch main https://github.com/ttzoomrust-hub/rust-up.git "$global:publish"
}
Run 'Verify only Stars session JS and cache key need changes'{
 node ".\payments\scripts\publish-stars-session-refresh.mjs" "$global:publish" --check
}
Run 'Publish Telegram Mini App Stars session fix'{
 node ".\payments\scripts\publish-stars-session-refresh.mjs" "$global:publish" --publish
}
Write-Host "`nPASS: Stars read-only session fix deployed to Cloudflare and GitHub Pages." -ForegroundColor Green
Write-Host 'Close and reopen RUST UP through @rustuper_bot. Real payments remain disabled.'
