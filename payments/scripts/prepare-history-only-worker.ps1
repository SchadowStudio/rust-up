# RUST UP: SAFELY BACK UP the exact active compiled Cloudflare Worker,
# add ONLY authenticated read-only Stars deposit history, build and dry-run.
# NO DEPLOYMENT, no invoices, no real payments or balance changes.
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $repo
$ownedToken=$false
function Check([string]$title,[scriptblock]$script){
 Write-Host ('[RUST UP] '+$title) -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $script
 if($LASTEXITCODE -ne 0){throw ($title+' failed (exit '+$LASTEXITCODE+')')}
}
try {
 if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
  throw 'Use the feature/rustup-payment-admin-controls branch'
 }
 Check 'Update reviewed code'{
  git pull --ff-only origin feature/rustup-payment-admin-controls
 }
 Check 'Run local authenticated history and fail-closed tests'{
  node --test '.\payments\integration\telegram-stars\stars-history-only-wrapper.test.mjs' '.\payments\scripts\stage-history-only-compiled-worker.test.mjs'
 }
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $authOut=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Wrangler Cloudflare login missing; run npx wrangler login'}
  $auth=($authOut|Out-String|ConvertFrom-Json)
  if([string]::IsNullOrWhiteSpace([string]$auth.token)){throw 'No Cloudflare token returned'}
  $env:CLOUDFLARE_API_TOKEN=[string]$auth.token
  $ownedToken=$true
  $auth=$null
  $authOut=$null
 }
 $env:CLOUDFLARE_ACCOUNT_ID='af72e32cb9f1ba99dba07df30fe540fe'
 Write-Host '[RUST UP] Capture exact CURRENT compiled bot (private, no writes to Cloudflare)' -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 $log=@(node '.\payments\scripts\stage-history-only-compiled-worker.mjs' --stage 2>&1)
 if($LASTEXITCODE -ne 0){
  $log|ForEach-Object {Write-Host $_}
  throw 'History-only Worker recovery failed; no deployment'
 }
 $matched=$log|Select-String '^NOT DEPLOYED\. Location:\s*(.+)$'|Select-Object -Last 1
 if(!$matched){throw 'Private recovery path missing'}
 $folder=$matched.Matches[0].Groups[1].Value.Trim()
 if(!(Test-Path -LiteralPath $folder)){throw 'Private recovery directory not found'}
 $entry=Join-Path $folder 'worker.history-only-compiled-entry.mjs'
 $bundle=Join-Path $folder 'worker.stars-history-only.bundle.js'
 $config=Join-Path $folder 'wrangler.stars-history-only.toml'
 Check 'Build original game/bot + read-only history (no commerce adapter)'{
  npx --yes esbuild "$entry" --bundle --platform=browser --format=esm --target=es2022 --sourcemap=linked "--outfile=$bundle"
 }
 Check 'Verify compiled syntax'{
  node --check "$bundle"
 }
 Check 'Cloudflare Wrangler dry-run ONLY, with real-money gates OFF'{
  npx --yes wrangler deploy --dry-run --config "$config"
 }
 Check 'Recheck unchanged live source, version, secrets metadata, cron and exact private files'{
  node '.\payments\scripts\stage-history-only-compiled-worker.mjs' --verify "$folder"
 }
 Write-Host 'PASS: original live RUST UP bot safely staged; history-only update ready for review.' -ForegroundColor Green
 Write-Host 'NOT DEPLOYED. No payment activation, D1 writes or player balance changes.' -ForegroundColor Green
} finally {
 if($ownedToken){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $auth=$null;$authOut=$null
}
