# RUST UP Stars: configure an owner-chosen server-side quote PREVIEW only.
# The existing Telegram game and bot remain unchanged. All payment flags OFF.
# Default: tests + dry-run, NO deployment.
# Example (NOT a recommended exchange rate):
#   .\payments\scripts\preview-stars-quote.ps1 -MinRubMinor 100 -MaxRubMinor 100000000 -RubMinorPerStarNumerator 300 -RubMinorPerStarDenominator 1
param(
 [Parameter(Mandatory=$true)]
 [ValidatePattern('^[1-9]\d{0,14}$')][string]$MinRubMinor,
 [Parameter(Mandatory=$true)]
 [ValidatePattern('^[1-9]\d{0,14}$')][string]$MaxRubMinor,
 [Parameter(Mandatory=$true)]
 [ValidatePattern('^[1-9]\d{0,14}$')][string]$RubMinorPerStarNumerator,
 [Parameter(Mandatory=$true)]
 [ValidatePattern('^[1-9]\d{0,14}$')][string]$RubMinorPerStarDenominator,
 [switch]$PublishReadOnlyPreview
)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo
function Run([string]$label,[scriptblock]$step){
 Write-Host ("`n["+$label+"]") -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $step
 if($LASTEXITCODE -ne 0){throw "$label failed ($LASTEXITCODE)"}
}
if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
 throw 'Run from RUST-UP-Local on feature/rustup-payment-admin-controls'
}
Run 'Pull latest pricing guard tests'{
 git pull --ff-only origin feature/rustup-payment-admin-controls
}
Run 'Offline Stars quote and payment safety regression tests'{
 node --test ".\payments\scripts\prepare-stars-quote-preview.test.mjs" ".\payments\scripts\check-stars-activation.test.mjs" ".\payments\scripts\stage-current-variable-stars.test.mjs"
}
if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
 try{
  $auth=& npx --yes wrangler auth token --json 2>$null
  if($LASTEXITCODE -ne 0){throw 'Wrangler authorization missing'}
  $session=($auth|Out-String|ConvertFrom-Json)
  if($session.type -notin @('oauth','api_token') -or [string]::IsNullOrWhiteSpace([string]$session.token)){
   throw 'Wrangler token unavailable'
  }
  $env:CLOUDFLARE_API_TOKEN=[string]$session.token
  Write-Host 'PASS: Existing Wrangler login loaded privately.' -ForegroundColor Green
 }catch{throw 'Run npx wrangler login locally. Never paste credentials into chat.'}
 finally{$auth=$null;$session=$null}
}
Write-Host 'Recovering exact live 18-module bot privately...' -ForegroundColor Cyan
$global:LASTEXITCODE=0
$log=@(node ".\payments\scripts\recover-current-stars-variable.mjs" 2>&1)
if($LASTEXITCODE -ne 0){
 $log|ForEach-Object{Write-Host $_}
 throw 'Live bot recovery failed'
}
$m=$log|Select-String -Pattern '^Location:\s*(.+)$'|Select-Object -Last 1
if(!$m){throw 'Private backup not found'}
$dir=$m.Matches[0].Groups[1].Value.Trim()
if(!(Test-Path -LiteralPath $dir)){throw 'Recovery directory missing'}
Run 'Stage exact current bot (all payment flags OFF)'{
 node ".\payments\scripts\stage-current-variable-stars.mjs" "$dir"
}
$entry=Join-Path $dir 'worker.stars-variable-entry.mjs'
$bundle=Join-Path $dir 'worker.stars-variable.bundle.js'
Run 'Build original bot and variable quote endpoint'{
 npx --yes esbuild "$entry" --bundle --platform=browser --format=esm --target=es2022 --sourcemap=linked "--outfile=$bundle"
}
Run 'Worker syntax check'{node --check "$bundle"}
Run 'Verify no changes in live bot during preparation'{
 node ".\payments\scripts\stage-current-variable-stars.mjs" "$dir" --check-live
}
Run 'Generate private quote config with operator-chosen pricing and payment gates OFF'{
 node ".\payments\scripts\prepare-stars-quote-preview.mjs" "$dir" "$MinRubMinor" "$MaxRubMinor" "$RubMinorPerStarNumerator" "$RubMinorPerStarDenominator"
}
$cfg=Join-Path $dir 'wrangler.stars-quote-preview.toml'
Run 'Cloudflare quote-only config dry-run'{
 npx --yes wrangler deploy --dry-run --config "$cfg"
}
if(!$PublishReadOnlyPreview){
 Write-Host 'PASS: Stars quote preview verified. NOT DEPLOYED. Real payments remain OFF.' -ForegroundColor Green
 exit 0
}
Run 'Deploy quote preview with every real payment and wallet gate OFF'{
 npx --yes wrangler deploy --config "$cfg"
}
$health=Invoke-RestMethod -Uri 'https://rustup-bot.ttzoomrust.workers.dev/api/stars/health' -TimeoutSec 20
if(!$health.ok -or $health.productionEnabled -or $health.gameBalanceCredit){
 throw 'Unsafe live Stars health response; stop and investigate'
}
Write-Host 'PASS: Price preview online. Checkout remains disabled; no real Stars payment or game credit.' -ForegroundColor Green
