# Version-locked dark release of the existing RUST UP Worker.
# No real Stars invoice, checkout activation, refunds, or game ledger writes.
param([switch]$PublishWithPaymentsOff)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $root
function Check([string]$label,[scriptblock]$action) {
 Write-Host ('[RUST UP] '+$label) -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $action
 if($LASTEXITCODE -ne 0){throw ($label+' failed (exit '+$LASTEXITCODE+')')}
}
if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
 throw 'Use feature/rustup-payment-admin-controls. No deployment.'
}
Check 'Fast-forward current branch' {
 git pull --ff-only origin feature/rustup-payment-admin-controls
}
Check 'Run Stars and refund offline tests' {
 node --test '.\payments\integration\account-credit-ledger\verified-stars-game-refund.test.mjs' '.\payments\integration\account-credit-ledger\freeze-verified-stars-game-quote.test.mjs' '.\payments\integration\telegram-stars\stars-variable-webhook-wrapper.test.mjs' '.\payments\scripts\stage-current-rustup-dark-release.test.mjs'
}
$ownsToken=$false
try {
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $authOutput=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Cloudflare authorization unavailable; run npx wrangler login'}
  $auth=$authOutput|Out-String|ConvertFrom-Json
  if([string]::IsNullOrWhiteSpace([string]$auth.token)){
   throw 'Wrangler session has no Cloudflare token'
  }
  $env:CLOUDFLARE_API_TOKEN=[string]$auth.token
  $ownsToken=$true
  $auth=$null;$authOutput=$null
 }
 $stageOutput=@(node '.\payments\scripts\stage-current-rustup-dark-release.mjs' --stage 2>&1)
 if($LASTEXITCODE -ne 0){
  $stageOutput|ForEach-Object{Write-Host $_}
  throw 'Current live Worker changed or staging failed; no deployment'
 }
 $marker=$stageOutput|Select-String '^RUSTUP_DARK_STAGE=(.*)$'|Select-Object -Last 1
 if(!$marker){throw 'Stage result missing'}
 $stage=($marker.Matches[0].Groups[1].Value|ConvertFrom-Json).stage
 if(!(Test-Path -LiteralPath $stage -PathType Container)){throw 'Stage folder missing'}
 $entry=Join-Path $stage 'worker.current-stars-dark-entry.mjs'
 $bundle=Join-Path $stage 'worker.current-stars-dark.bundle.js'
 $config=Join-Path $stage 'wrangler.current-stars-dark.toml'
 Check 'Build preserved original bot with new verified Stars wrapper' {
  npx --yes esbuild "$entry" --bundle --platform=browser --format=esm --target=es2022 --sourcemap=linked "--outfile=$bundle"
 }
 Check 'Check JavaScript syntax' {node --check "$bundle"}
 Check 'Cloudflare Wrangler dry-run (no real payments)' {
  npx --yes wrangler deploy --dry-run --config "$config"
 }
 Check 'Re-read live Worker and verify exact original version/bindings' {
  node '.\payments\scripts\stage-current-rustup-dark-release.mjs' --verify "$stage"
 }
 if(!$PublishWithPaymentsOff){
  Write-Host 'PASS: current Worker dark-release bundle staged and checked. NOT DEPLOYED.' -ForegroundColor Green
  Write-Host ('Stage directory: '+$stage)
  exit 0
 }
 Check 'Final no-drift check immediately before Worker publication' {
  node '.\payments\scripts\stage-current-rustup-dark-release.mjs' --verify "$stage"
 }
 Check 'Publish code update with Stars charging OFF' {
  npx --yes wrangler deploy --config "$config"
 }
 Write-Host 'PUBLISHED: Worker code updated. Stars checkout remains OFF.' -ForegroundColor Green
 Write-Host 'No real Stars payment initiated or enabled.'
} finally {
 if($ownsToken){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
}
