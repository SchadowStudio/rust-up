# RUST UP Supporter badge: ONE COMMAND, exact current bot staging, NO PAYMENT.
# Tests isolated badge delivery/replay/refund with SQLite, private bot recovery,
# compile and Cloudflare --dry-run. Real-money gates always OFF.
# -DeployReadOnly publishes only the tested, NONCHARGING badge status API.
param([switch]$DeployReadOnly)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $repo
if(!(Test-Path '.git')){throw 'Expected RUST-UP-Local repository not found'}
$branch=(git branch --show-current)
if($LASTEXITCODE -ne 0 -or $branch.Trim() -ne 'feature/rustup-payment-admin-controls'){
 throw 'Run on feature/rustup-payment-admin-controls'
}
function Check([string]$name,[scriptblock]$action){
 Write-Host ("["+$name+"]") -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $action
 if($LASTEXITCODE -ne 0){throw "$name failed (exit $LASTEXITCODE)"}
}
Check 'Pull latest reviewed badge implementation'{
 git pull --ff-only origin feature/rustup-payment-admin-controls
}
Check 'SQLite paid/replayed/refunded badge and signed Mini App tests'{
 node --test '.\payments\integration\telegram-stars\supporter-badge.test.mjs' '.\payments\frontend\telegram-miniapp\stars-supporter-ui.test.mjs'
}
Check 'Telegram test-only invoice and refund regressions'{
 node --test '.\payments\scripts\telegram-stars-test-env.test.mjs'
}
if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
 try{
  $raw=& npx --yes wrangler auth token --json 2>$null
  if($LASTEXITCODE -ne 0){throw 'No Wrangler auth'}
  $auth=($raw|Out-String|ConvertFrom-Json)
  if($auth.type -notin @('oauth','api_token') -or
     [string]::IsNullOrWhiteSpace([string]$auth.token)){
   throw 'Invalid Wrangler auth'
  }
  $env:CLOUDFLARE_API_TOKEN=[string]$auth.token
  Write-Host 'PASS: Existing Wrangler credential available privately.' -ForegroundColor Green
 }catch{throw 'Run npx wrangler login, then try again. Do not share credentials.'}
 finally{$raw=$null;$auth=$null}
}
Write-Host '[Recover exact current 18-module production bot privately]' -ForegroundColor Cyan
$global:LASTEXITCODE=0
$log=@(node '.\payments\scripts\recover-current-stars-variable.mjs' 2>&1)
if($LASTEXITCODE -ne 0){
 $log|ForEach-Object{Write-Host $_}
 throw 'Private source recovery failed'
}
$match=$log|Select-String -Pattern '^Location:\s*(.+)$'|Select-Object -Last 1
if(!$match){throw 'Private worker source folder missing'}
$dir=$match.Matches[0].Groups[1].Value.Trim()
if(!(Test-Path -LiteralPath $dir)){throw 'Worker recovery was not saved'}
Check 'Stage unchanged worker and all payment flags OFF'{
 node '.\payments\scripts\stage-current-variable-stars.mjs' "$dir"
}
Check 'Apply only supporter badge source into PRIVATE stage'{
 node '.\payments\scripts\stage-supporter-badge.mjs' "$dir" --stage
}
$entry=Join-Path $dir 'worker.stars-variable-entry.mjs'
$bundle=Join-Path $dir 'worker.stars-variable.bundle.js'
$config=Join-Path $dir 'wrangler.stars-variable.toml'
Check 'Build complete existing game bot plus supporter fulfillment module'{
 npx --yes esbuild "$entry" --bundle --platform=browser --format=esm --target=es2022 --sourcemap=linked "--outfile=$bundle"
}
Check 'Compiled Worker syntax'{
 node --check "$bundle"
}
Check 'Re-verify exact live bot and supporter stage without changes'{
 node '.\payments\scripts\stage-supporter-badge.mjs' "$dir" --check
}
Check 'Cloudflare dry-run, NO deployment and all payment gates OFF'{
 npx --yes wrangler deploy --dry-run --config "$config"
}
if(!$DeployReadOnly){
 Write-Host 'PASS: Full supporter badge backend staged and checked. NOT DEPLOYED.' -ForegroundColor Green
 Write-Host 'No real-money payments, no game-credit changes.'
 exit 0
}
# This is an explicitly requested dark deploy on the EXISTING bot. Only the
# isolated, read-only badge status route is new. Every Stars checkout remains OFF.
# We do not attempt actual Stars invoices, games, or wallet credits.
Check 'Final Cloudflare Worker integrity recheck immediately before deployment'{
 node '.\payments\scripts\stage-supporter-badge.mjs' "$dir" --check
}
Check 'Deploy existing RUST UP Worker with badge status and ALL payment gates OFF'{
 npx --yes wrangler deploy --config "$config"
}
Check 'Verify live Worker health after NONCHARGING deployment'{
 $health=Invoke-RestMethod -Uri 'https://rustup-bot.ttzoomrust.workers.dev/api/stars/health' -TimeoutSec 20
 if(!$health.ok -or $health.productionEnabled -or $health.gameBalanceCredit){
  throw 'Live badge release health cannot confirm payment gates OFF'
 }
}
Write-Host 'PASS: Existing @rustuper_bot has read-only supporter badge backend.' -ForegroundColor Green
Write-Host 'NO real Stars payments, NO gambling credits, operator rate unchanged.'
