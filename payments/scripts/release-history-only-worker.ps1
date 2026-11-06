# RUST UP read-only history deployment. DEFAULT: PREFLIGHT ONLY.
# Use -DeployHistoryOnly explicitly to install ONLY an authenticated,
# read-only deposit history endpoint on the EXACT recovered current bot.
# NEVER enables Telegram invoices, case funding, game credits or withdrawals.
param(
 [Parameter(Mandatory=$true)][string]$StageFolder,
 [switch]$DeployHistoryOnly
)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $repo
$ownedToken=$false
function Check([string]$label,[scriptblock]$action){
 Write-Host ('[RUST UP] '+$label) -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $action
 if($LASTEXITCODE -ne 0){throw ($label+' FAILED, exit '+$LASTEXITCODE)}
}
try {
 if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
  throw 'Wrong repository branch. Stop.'
 }
 Check 'Update verified release code'{
  git pull --ff-only origin feature/rustup-payment-admin-controls
 }
 $privateRoot=Join-Path $repo '.private\rustup-bot-recovered'
 if(!(Test-Path -LiteralPath $StageFolder -PathType Container)){
  throw 'StageFolder not found. Run prepare-history-only-worker.ps1 first.'
 }
 $private=(Resolve-Path -LiteralPath $privateRoot).Path.TrimEnd('\')+'\'
 $stage=(Resolve-Path -LiteralPath $StageFolder).Path
 if(!$stage.StartsWith($private,[StringComparison]::OrdinalIgnoreCase)){
  throw 'StageFolder must be within the local private Worker recovery directory.'
 }
 $config=Join-Path $stage 'wrangler.stars-history-only.toml'
 $bundle=Join-Path $stage 'worker.stars-history-only.bundle.js'
 if(!(Test-Path -LiteralPath $bundle -PathType Leaf) -or
    !(Test-Path -LiteralPath $config -PathType Leaf)){
  throw 'Expected reviewed Worker bundle or config missing.'
 }
 Check 'Run offline history-only and release validation tests'{
  node --test '.\payments\integration\telegram-stars\stars-history-only-wrapper.test.mjs' '.\payments\scripts\stage-history-only-compiled-worker.test.mjs' '.\payments\scripts\verify-history-only-worker-release.test.mjs' '.\payments\scripts\probe-history-only-worker.test.mjs'
 }
 Check 'Check exact compiled Worker syntax'{
  node --check "$bundle"
 }
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $authOutput=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Cloudflare login missing. Run npx wrangler login'}
  $auth=($authOutput|Out-String|ConvertFrom-Json)
  if([string]::IsNullOrWhiteSpace([string]$auth.token)){
   throw 'Wrangler did not return a valid token.'
  }
  $env:CLOUDFLARE_API_TOKEN=[string]$auth.token
  $ownedToken=$true
  $auth=$null
  $authOutput=$null
 }
 $env:CLOUDFLARE_ACCOUNT_ID='af72e32cb9f1ba99dba07df30fe540fe'
 Check 'Verify original live source, deployment ETag, immutable private files and payment gates'{
  node '.\payments\scripts\stage-history-only-compiled-worker.mjs' --verify "$stage"
 }
 Check 'Verify exact active Worker version, named class, secrets, cron, D1 and OFF gates'{
  node '.\payments\scripts\verify-history-only-worker-release.mjs' before "$stage"
 }
 Check 'Wrangler preflight (no deployment)'{
  npx --yes wrangler deploy --dry-run --config "$config"
 }
 if(!$DeployHistoryOnly){
  Write-Host 'PASS: read-only history release has passed preflight. NOTHING DEPLOYED.' -ForegroundColor Green
  Write-Host 'Use -DeployHistoryOnly explicitly after reviewing the results.' -ForegroundColor Yellow
  exit 0
 }
 # Minimize the race window. A concurrent Worker change must stop the release.
 Check 'Final source/version recheck directly before publication'{
  node '.\payments\scripts\stage-history-only-compiled-worker.mjs' --verify "$stage"
 }
 Check 'Final live deployment and safety-gate verification'{
  node '.\payments\scripts\verify-history-only-worker-release.mjs' before "$stage"
 }
 Check 'Deploy ONLY history-only Worker bundle, with all money gates FALSE'{
  npx --yes wrangler deploy --config "$config"
 }
 # Do NOT conceal post-deployment anomalies. The previous Worker version is in
 # the private stage manifest and Cloudflare deployment history.
 Check 'Verify new live version and preserve original exports, secrets, cron and D1 bindings'{
  node '.\payments\scripts\verify-history-only-worker-release.mjs' after "$stage"
 }
 Check 'Anonymous API smoke check: signed history requires auth, quote and checkout are unreachable'{
  node '.\payments\scripts\probe-history-only-worker.mjs'
 }
 Write-Host 'PASS: read-only Stars history endpoint deployed. Real payments still OFF.' -ForegroundColor Green
 Write-Host 'Existing game, Telegram bot and admin paths remain delegated to the original Worker.' -ForegroundColor Green
} finally {
 if($ownedToken){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $auth=$null;$authOutput=$null
}
