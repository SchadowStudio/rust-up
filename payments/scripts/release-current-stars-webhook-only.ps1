# Safe RUST UP Stars webhook-only Worker release.
# DEFAULT: PREFLIGHT ONLY. -PublishWebhookOnly updates only receipt/cron code;
# ALL real-payment, game-credit and refund switches remain OFF.
param([Parameter(Mandatory=$true)][string]$StageFolder,
      [switch]$PublishWebhookOnly)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $repo
$ownToken=$false
function Check([string]$title,[scriptblock]$action){
 Write-Host ('[RUST UP] '+$title) -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $action
 if($LASTEXITCODE -ne 0){throw ($title+' failed, exit '+$LASTEXITCODE)}
}
try{
 if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
  throw 'Wrong branch; deployment refused'
 }
 Check 'Pull reviewed Stars webhook branch'{
  git pull --ff-only origin feature/rustup-payment-admin-controls
 }
 $root=Join-Path $repo '.private\rustup-bot-recovered'
 if(!(Test-Path -LiteralPath $StageFolder -PathType Container)){
  throw 'Missing private stage: run prepare-current-stars-webhook-only.ps1'
 }
 $allowed=(Resolve-Path -LiteralPath $root).Path.TrimEnd('\')+'\'
 $stage=(Resolve-Path -LiteralPath $StageFolder).Path
 if(!$stage.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)){
  throw 'Stage must be inside the existing private Worker recovery directory'
 }
 $bundle=Join-Path $stage 'worker.stars-webhook-only.bundle.js'
 $config=Join-Path $stage 'wrangler.stars-webhook-only.toml'
 if(!(Test-Path -LiteralPath $bundle -PathType Leaf) -or
    !(Test-Path -LiteralPath $config -PathType Leaf)){
  throw 'Reviewed bundle missing. Run the preparation script first.'
 }
 Check 'Run variable Stars webhook and durable delivery regression suite'{
  node --test '.\payments\integration\telegram-stars\stars-variable-webhook-wrapper.test.mjs' '.\payments\integration\telegram-stars\stars-variable-webhook-sqlite-e2e.test.mjs' '.\payments\integration\telegram-stars\stars-delivery-queue.test.mjs' '.\payments\scripts\stage-current-stars-webhook-only.test.mjs' '.\payments\scripts\verify-stars-webhook-only-live.test.mjs'
 }
 Check 'Verify reviewed compiled Worker syntax'{
  node --check "$bundle"
 }
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $a=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Wrangler login required: npx wrangler login'}
  $auth=$a|Out-String|ConvertFrom-Json
  if([string]::IsNullOrWhiteSpace([string]$auth.token)){
   throw 'Cloudflare session did not provide a token'
  }
  $env:CLOUDFLARE_API_TOKEN=[string]$auth.token
  $ownToken=$true
  $auth=$null;$a=$null
 }
 $env:CLOUDFLARE_ACCOUNT_ID='af72e32cb9f1ba99dba07df30fe540fe'
 Check 'Compare exact original live bot source, stored 1.83 rate and all OFF gates'{
  node '.\payments\scripts\stage-current-stars-webhook-only.mjs' --verify "$stage"
 }
 Check 'Cloudflare dry-run only'{
  npx --yes wrangler deploy --dry-run --config "$config"
 }
 if(!$PublishWebhookOnly){
  Write-Host 'PASS: safe Stars webhook-only release passed all preflight checks. NOTHING DEPLOYED.' -ForegroundColor Green
  exit 0
 }
 Check 'Final no-drift check immediately before Cloudflare publication'{
  node '.\payments\scripts\stage-current-stars-webhook-only.mjs' --verify "$stage"
 }
 Check 'Publish webhook/cron only: ALL money switches remain OFF'{
  npx --yes wrangler deploy --config "$config"
 }
 Check 'Inspect deployed SourceMap, original game bot, two D1, secrets, cron and OFF gates'{
  node '.\payments\scripts\verify-stars-webhook-only-live.mjs' "$stage"
 }
 Check 'Anonymous quote/precheckout probes without real user credentials'{
  node '.\payments\scripts\probe-owner-stars-quote.mjs'
 }
 Write-Host 'PASS: Stars webhook-only Worker deployed and verified. Real payments still OFF.' -ForegroundColor Green
}finally{
 if($ownToken){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $auth=$null;$a=$null
}
