# RUST UP: custom user-entered RUB amount in Telegram Mini App.
# Safe default: tests and dry-run, no deployment. -DeployWithPaymentsOff = noncharging release.
param([switch]$DeployWithPaymentsOff)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
function Run([string]$label,[scriptblock]$step){
 Write-Host ("`n["+$label+"]") -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $step
 if($LASTEXITCODE -ne 0){throw "$label failed ($LASTEXITCODE)"}
}
if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
 throw 'Run in RUST-UP-Local feature/rustup-payment-admin-controls'
}
if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
 try{
  $raw=& npx --yes wrangler auth token --json 2>$null
  if($LASTEXITCODE -ne 0){throw 'Wrangler is not logged in'}
  $credential=($raw|Out-String|ConvertFrom-Json)
  if($credential.type -notin @('oauth','api_token') -or [string]::IsNullOrWhiteSpace([string]$credential.token)){
   throw 'Wrangler credential unavailable'
  }
  $env:CLOUDFLARE_API_TOKEN=[string]$credential.token
  Write-Host 'PASS: Existing Wrangler login loaded privately.'
 }catch{throw 'Run npx wrangler login first. Never share credentials.'}
 finally{$raw=$null;$credential=$null}
}
Run 'Update feature branch'{
 git pull --ff-only origin feature/rustup-payment-admin-controls
}
Run 'Test variable user amounts, quotes and payment callbacks'{
 node --test ".\payments\integration\telegram-stars\variable-payments.test.mjs" ".\payments\integration\telegram-stars\stars-variable-bridge.test.mjs"
}
Run 'Test current Worker config and payment gates'{
 node --test ".\payments\scripts\stage-current-variable-stars.test.mjs"
}
Run 'Test Mini App amount input and publisher'{
 node --test ".\payments\scripts\publish-variable-stars-wallet.test.mjs"
}
Run 'Test game-account integrity'{
 node --test ".\payments\integration\existing-game-state-sandbox\strict-first-login-guard.test.mjs"
}
Run 'Check bridge JavaScript syntax'{
 node --check ".\payments\integration\telegram-stars\stars-variable-bridge.mjs"
}
Run 'Check recovery script syntax'{
 node --check ".\payments\scripts\recover-current-stars-variable.mjs"
}
Write-Host '`n[Recover EXACT current 18-module live Worker]' -ForegroundColor Cyan
$global:LASTEXITCODE=0
$log=@(node ".\payments\scripts\recover-current-stars-variable.mjs" 2>&1)
if($LASTEXITCODE -ne 0){
 $log|ForEach-Object{Write-Host $_}
 throw 'Live source recovery failed'
}
$match=$log|Select-String -Pattern '^Location:\s*(.+)$'|Select-Object -Last 1
if(!$match){throw 'Recovered private directory missing'}
$dir=$match.Matches[0].Groups[1].Value.Trim()
if(!(Test-Path -LiteralPath $dir)){throw 'Recovered source not found'}
Run 'Stage current bot with user amount routes and webhook protection'{
 node ".\payments\scripts\stage-current-variable-stars.mjs" "$dir"
}
$entry=Join-Path $dir 'worker.stars-variable-entry.mjs'
$bundle=Join-Path $dir 'worker.stars-variable.bundle.js'
$config=Join-Path $dir 'wrangler.stars-variable.toml'
Run 'Build current bot with variable Stars API'{
 npx --yes esbuild "$entry" --bundle --platform=browser --format=esm --target=es2022 --sourcemap=linked "--outfile=$bundle"
}
Run 'Check compiled bot syntax'{node --check "$bundle"}
Run 'Cloudflare dry-run: both D1 databases, all payments OFF'{
 npx --yes wrangler deploy --dry-run --config "$config"
}
Run 'Verify live Worker unchanged during staging'{
 node ".\payments\scripts\stage-current-variable-stars.mjs" "$dir" --check-live
}
if(!$DeployWithPaymentsOff){
 Write-Host '`nPASS: Safe variable Stars preflight done. Nothing deployed.' -ForegroundColor Green
 exit 0
}
Run 'Deploy user amount API with payment acceptance OFF'{
 npx --yes wrangler deploy --config "$config"
}
$health=Invoke-RestMethod -Uri 'https://rustup-bot.ttzoomrust.workers.dev/api/stars/health' -TimeoutSec 20
if(!$health.ok -or $health.service -ne 'rustup-fixed-stars' -or $health.productionEnabled -or $health.gameBalanceCredit){
 throw 'Unsafe live payment config. Do not enable paid deposits.'
}
$publish=Join-Path $env:TEMP ('rustup-variable-'+[guid]::NewGuid().ToString('N'))
Run 'Clone current Telegram Mini App into clean temporary directory'{
 git clone --depth 1 --branch main https://github.com/ttzoomrust-hub/rust-up.git "$publish"
}
Run 'Validate variable amount UI against newest Mini App'{
 node ".\payments\scripts\publish-variable-stars-wallet.mjs" "$publish" --check
}
Run 'Publish existing Telegram wallet with freely entered RUB amount'{
 node ".\payments\scripts\publish-variable-stars-wallet.mjs" "$publish" --publish
}
Write-Host '`nPASS: Variable-amount Telegram wallet UI and API staged online.' -ForegroundColor Green
Write-Host 'Real payment and wallet-credit switches remain OFF. Owner rate is not invented.'
