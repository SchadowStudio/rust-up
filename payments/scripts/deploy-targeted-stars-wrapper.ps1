# RUST UP: deploy ONLY reviewed stars-variable-webhook-wrapper.mjs changes.
# Rebuilds the existing Worker from its exact live sources (Cloudflare has no
# single-file hot-swap). All monetary gates remain OFF; no D1 mutations.
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
 Run 'Verify targeted wrapper and settlement safety' {
  node --test '.\payments\integration\telegram-stars\stars-variable-webhook-wrapper.test.mjs' '.\payments\integration\telegram-stars\stars-delivery-queue.test.mjs' '.\payments\integration\account-credit-ledger\verified-stars-game-credit.test.mjs' '.\payments\integration\account-credit-ledger\verified-stars-game-refund.test.mjs'
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
 Write-Host '[RUST UP] Capture LIVE Worker and patch only Stars wrapper' -ForegroundColor Cyan
 $stageOutput=@(node '.\payments\scripts\stage-targeted-stars-wrapper.mjs' --stage 2>&1)
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
 $entry=Join-Path $stage 'worker.stars-webhook-only-entry.mjs'
 $bundle=Join-Path $stage 'worker.stars-webhook-only.bundle.js'
 $config=Join-Path $stage 'wrangler.stars-webhook-only.toml'
 Run 'Bundle exact preserved Worker plus targeted patch' {
  npx --yes esbuild "$entry" --bundle --platform=browser --format=esm --target=es2022 --sourcemap=linked "--outfile=$bundle"
 }
 Run 'Check generated Worker JavaScript syntax' {
  node --check "$bundle"
 }
 Run 'Cloudflare compile dry-run (no deploy)' {
  npx --yes wrangler deploy --dry-run --config "$config"
 }
 Run 'Verify original live source, pricing, settings and unchanged bot' {
  node '.\payments\scripts\stage-targeted-stars-wrapper.mjs' --verify "$stage"
 }
 if(!$Publish){
  Write-Host 'PASS: targeted patch built and preflight verified. NOT DEPLOYED.' -ForegroundColor Green
  Write-Host ('Private stage: '+$stage)
  Write-Host 'When ready, rerun this script with -Publish.' -ForegroundColor Yellow
  exit 0
 }
 Run 'Final no-drift check immediately before release' {
  node '.\payments\scripts\stage-targeted-stars-wrapper.mjs' --verify "$stage"
 }
 Run 'Deploy targeted updated Worker keeping all payment gates OFF' {
  npx --yes wrangler deploy --config "$config"
 }
 Run 'Verify EVERY deployed source and bindings after release' {
  node '.\payments\scripts\stage-targeted-stars-wrapper.mjs' --postverify "$stage"
 }
 Write-Host 'PASS: targeted Stars wrapper deployed, 15 original modules intact.' -ForegroundColor Green
 Write-Host 'REAL PAYMENT ACTIVATION WAS NOT PERFORMED.' -ForegroundColor Yellow
} finally {
 if($ownedToken){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $auth=$null;$authOutput=$null
}
