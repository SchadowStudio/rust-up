# RUST UP: deploy ONLY the reviewed compiled-live support webhook redirect repair.
# The stage script patches the exact live bundle. Never re-bundle from missing sources.
# All monetary gates remain OFF; no D1 mutations.
param([switch]$Publish)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $repo
$ownedToken=$false
function Run([string]$title,[scriptblock]$action){
 Write-Host ('[RUST UP] '+$title) -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $action
 if($LASTEXITCODE -ne 0){throw ($title+' failed: '+$LASTEXITCODE)}
}
try {
 if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
  throw 'Wrong branch; targeted release refused'
 }
 Run 'Fast-forward reviewed payment patch branch' {
  git pull --ff-only origin feature/rustup-payment-admin-controls
 }
 Run 'Verify sanitized auth reasons and settlement safety' {
  node --test '.\payments\integration\telegram-stars\stars-payment-support.test.mjs' '.\payments\integration\telegram-stars\stars-history-only-wrapper.test.mjs' '.\payments\integration\telegram-stars\telegram-initdata-official.test.mjs' '.\payments\integration\telegram-stars\stars-variable-webhook-wrapper.test.mjs' '.\payments\integration\telegram-stars\stars-delivery-queue.test.mjs' '.\payments\integration\account-credit-ledger\verified-stars-game-credit.test.mjs' '.\payments\integration\account-credit-ledger\verified-stars-game-refund.test.mjs'
 }
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $authOutput=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Wrangler authorization unavailable; run npx wrangler login'}
  $auth=$authOutput|Out-String|ConvertFrom-Json
  if([string]::IsNullOrWhiteSpace([string]$auth.token)){
   throw 'Wrangler did not provide a token'
  }
  $env:CLOUDFLARE_API_TOKEN=[string]$auth.token
  $ownedToken=$true
  $auth=$null;$authOutput=$null
 }
 $env:CLOUDFLARE_ACCOUNT_ID='af72e32cb9f1ba99dba07df30fe540fe'
 Write-Host '[RUST UP] Capture exact current LIVE compiled Worker; patch only support redirect' -ForegroundColor Cyan
 $stageOutput=@(node '.\payments\scripts\stage-current-live-support-hotfix.mjs' --stage 2>&1)
 if($LASTEXITCODE -ne 0){
  $stageOutput|ForEach-Object{Write-Host $_}
  throw 'Private live Worker capture refused; no deployment'
 }
 $stageOutput|ForEach-Object{Write-Host $_}
 $match=$stageOutput|Select-String '^NOT DEPLOYED\. Private stage:\s*(.+)$'|Select-Object -Last 1
 if(!$match){throw 'Private Worker stage location missing'}
 $stage=$match.Matches[0].Groups[1].Value.Trim()
 if(!(Test-Path -LiteralPath $stage -PathType Container)){
  throw 'Private stage folder missing'
 }
 $bundle=Join-Path $stage 'worker.support-live-hotfix.mjs'
 $config=Join-Path $stage 'wrangler.support-live-hotfix.toml'
 if(!(Test-Path -LiteralPath $bundle -PathType Leaf)){
  throw 'Exact staged live Worker bundle missing; no deployment'
 }
 Run 'Check generated Worker JavaScript syntax' {
  node --check "$bundle"
 }
 Run 'Cloudflare compile dry-run (no deploy)' {
  npx --yes wrangler deploy --dry-run --config "$config"
 }
 Run 'Verify original live source, pricing, settings and unchanged bot' {
  node '.\payments\scripts\stage-current-live-support-hotfix.mjs' --verify "$stage"
 }
 if(!$Publish){
  Write-Host 'PASS: sanitized support redirect repair built and preflight verified. NOT DEPLOYED.' -ForegroundColor Green
  Write-Host ('Private stage: '+$stage)
  Write-Host 'When ready, rerun this script with -Publish.' -ForegroundColor Yellow
  exit 0
 }
 Run 'Final no-drift check immediately before release' {
  node '.\payments\scripts\stage-current-live-support-hotfix.mjs' --verify "$stage"
 }
 Run 'Deploy targeted updated Worker keeping all payment gates OFF' {
  npx --yes wrangler deploy --config "$config"
 }
 Run 'Verify EVERY deployed source and bindings after release' {
  node '.\payments\scripts\stage-current-live-support-hotfix.mjs' --postverify "$stage"
 }
 Write-Host 'PASS: support webhook redirect fix deployed, current Worker byte-verified.' -ForegroundColor Green
 Write-Host 'REAL PAYMENT ACTIVATION WAS NOT PERFORMED.' -ForegroundColor Yellow
} finally {
 if($ownedToken){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $auth=$null;$authOutput=$null
}
