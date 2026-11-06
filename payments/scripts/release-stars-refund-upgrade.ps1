# RUST UP Stars Worker: preflight by default, optional WEBHOOK-ONLY deploy.
# Never enables real money invoices or changes any D1 records.
param(
 [string]$StageFolder=".\.private\rustup-bot-recovered\webhook-only-d618b572-dc181bc6f2-refund-preflight",
 [switch]$PublishWebhookOnly
)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $repo
function Run([string]$name,[scriptblock]$job){
 Write-Host ('[RUST UP] '+$name) -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $job
 if($LASTEXITCODE -ne 0){throw ($name+' exit '+$LASTEXITCODE)}
}
$ownToken=$false
try{
 if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
  throw 'Wrong branch: no deploy'
 }
 Run 'Update reviewed branch without merging local changes'{
  git pull --ff-only origin feature/rustup-payment-admin-controls
 }
 Run 'Reject uncommitted payment/Worker changes'{
  git diff --exit-code -- payments
 }
 Run 'Check Stars checkout, credit, refund and webhook tests'{
  node --test '.\payments\integration\account-credit-ledger\freeze-verified-stars-game-quote.test.mjs' '.\payments\integration\account-credit-ledger\stars-checkout-frozen-quote-e2e.test.mjs' '.\payments\integration\account-credit-ledger\verified-stars-game-credit.test.mjs' '.\payments\integration\account-credit-ledger\verified-stars-game-refund.test.mjs' '.\payments\integration\telegram-stars\stars-delivery-queue.test.mjs' '.\payments\integration\telegram-stars\stars-variable-webhook-wrapper.test.mjs' '.\payments\integration\telegram-stars\stars-payment-support.test.mjs' '.\payments\scripts\stage-current-stars-webhook-only.test.mjs'
 }
 $root=(Resolve-Path -LiteralPath '.\.private\rustup-bot-recovered').Path.TrimEnd('\')+'\'
 $stage=(Resolve-Path -LiteralPath $StageFolder).Path
 if(!$stage.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){
  throw 'Untrusted stage folder'
 }
 $bundle=Join-Path $stage 'worker.stars-webhook-only.bundle.js'
 $config=Join-Path $stage 'wrangler.stars-webhook-only.toml'
 Run 'Verify compiled Worker syntax' {node --check "$bundle"}
 Run 'Verify exact staged source map, original bot and OFF flags'{
  node '.\payments\scripts\verify-stars-refund-upgrade-stage.mjs' "$stage"
 }
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $result=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Wrangler authentication required'}
  $data=$result|Out-String|ConvertFrom-Json
  if([string]::IsNullOrWhiteSpace([string]$data.token)){
   throw 'No Cloudflare token available'
  }
  $env:CLOUDFLARE_API_TOKEN=[string]$data.token
  $ownToken=$true
  $result=$null;$data=$null
 }
 $env:CLOUDFLARE_ACCOUNT_ID='af72e32cb9f1ba99dba07df30fe540fe'
 $baseline=Join-Path $repo '.private\rustup-bot-recovered\webhook-only-d618b572-dc181bc6f2-deployed-f6b6c0d4'
 Run 'Verify unchanged deployed Worker source against pinned baseline'{
  node '.\payments\scripts\verify-stars-refund-upgrade-live.mjs' deployed "$baseline"
 }
 Run 'Check current LIVE version before any release'{
  node '.\payments\scripts\verify-stars-refund-upgrade-live.mjs' before "$stage"
 }
 Run 'Dry-run reviewed Worker configuration'{
  npx --yes wrangler deploy --dry-run --config "$config"
 }
 if(!$PublishWebhookOnly){
  Write-Host 'PASS: release preflight. NOTHING DEPLOYED. All payment gates OFF.' -ForegroundColor Green
  exit 0
 }
 Run 'Immediately recheck published source and OFF gates'{
  node '.\payments\scripts\verify-stars-refund-upgrade-live.mjs' deployed "$baseline"
 }
 Run 'Publish webhook/refund/quote code ONLY; all money gates remain OFF'{
  npx --yes wrangler deploy --config "$config"
 }
 Run 'Verify newly deployed compiled sources, D1, cron, secrets and OFF gates'{
  node '.\payments\scripts\verify-stars-refund-upgrade-live.mjs' after "$stage"
 }
 Write-Host 'PASS: NEW WORKER PUBLISHED; NO REAL DEPOSITS ENABLED.' -ForegroundColor Green
}finally{
 if($ownToken){
  Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
 }
 $result=$null;$data=$null
}
