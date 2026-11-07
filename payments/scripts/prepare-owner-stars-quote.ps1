# RUST UP: exact 1.83 RUB/Star quote for Telegram users. Read-only by default.
# -PublishReadOnlyQuote optionally publishes ONLY an authenticated calculation,
# NOT live invoices, case deposits, game wallet credits or withdrawals.
param([switch]$PublishReadOnlyQuote)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $repo
$ownToken=$false
function Check([string]$label,[scriptblock]$command){
 Write-Host ('[RUST UP] '+$label) -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $command
 if($LASTEXITCODE -ne 0){throw ($label+' failed (exit '+$LASTEXITCODE+')')}
}
try{
 if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
  throw 'Wrong RUST UP branch; no changes made'
 }
 Check 'Update latest reviewed Stars code'{
  git pull --ff-only origin feature/rustup-payment-admin-controls
 }
 Check 'Offline: exact 1.83 RUB price and game/payment safety tests'{
  node --test '.\payments\integration\telegram-stars\stars-owner-price-preview.test.mjs' '.\payments\integration\telegram-stars\stars-history-only-wrapper.test.mjs' '.\payments\scripts\stage-current-stars-owner-quote.test.mjs' '.\payments\scripts\prepare-stars-quote-preview.test.mjs' '.\payments\integration\telegram-stars\stars-variable-bridge.test.mjs'
 }
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $sessionOutput=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Wrangler login missing; run npx wrangler login'}
  $session=($sessionOutput|Out-String|ConvertFrom-Json)
  if([string]::IsNullOrWhiteSpace([string]$session.token)){
   throw 'Cloudflare token not available'
  }
  $env:CLOUDFLARE_API_TOKEN=[string]$session.token
  $ownToken=$true
  $session=$null
  $sessionOutput=$null
 }
 $env:CLOUDFLARE_ACCOUNT_ID='af72e32cb9f1ba99dba07df30fe540fe'
 Write-Host '[RUST UP] Recover latest exact deployed game bot from live source map' -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 $stageLog=@(node '.\payments\scripts\stage-current-stars-owner-quote.mjs' --stage 2>&1)
 if($LASTEXITCODE -ne 0){
  $stageLog|ForEach-Object{Write-Host $_}
  throw 'Source recovery was not safe; no deployment'
 }
 $match=$stageLog|Select-String '^NOT DEPLOYED\. Location:\s*(.+)$'|Select-Object -Last 1
 if(!$match){throw 'Private recovery path not reported'}
 $folder=$match.Matches[0].Groups[1].Value.Trim()
 if(!(Test-Path -LiteralPath $folder -PathType Container)){
  throw 'Exact Worker recovery directory missing'
 }
 $entry=Join-Path $folder 'worker.history-only-compiled-entry.mjs'
 $bundle=Join-Path $folder 'worker.stars-owner-quote.bundle.js'
 $cfg=Join-Path $folder 'wrangler.stars-owner-quote.toml'
 Check 'Build read-only quote and preserve original game bot exports'{
  npx --yes esbuild "$entry" --bundle --platform=browser --format=esm --target=es2022 --sourcemap=linked "--outfile=$bundle"
 }
 Check 'Check quote-only bundle syntax'{
  node --check "$bundle"
 }
 Check 'Validate Cloudflare configuration without publishing'{
  npx --yes wrangler deploy --dry-run --config "$cfg"
 }
 Check 'Verify exact live Worker SHA, version, D1 bindings and disabled payment gates'{
  node '.\payments\scripts\stage-current-stars-owner-quote.mjs' --verify "$folder"
 }
 if(!$PublishReadOnlyQuote){
  Write-Host 'PASS: 1.83 RUB Stars quote bundle staged safely. NOTHING DEPLOYED.' -ForegroundColor Green
  Write-Host 'Run with -PublishReadOnlyQuote to expose ONLY the price preview.' -ForegroundColor Yellow
  exit 0
 }
 Check 'Final current Worker version/source consistency before changes'{
  node '.\payments\scripts\stage-current-stars-owner-quote.mjs' --verify "$folder"
 }
 Check 'Publish read-only 1.83 RUB/Star price preview with all payments OFF'{
  npx --yes wrangler deploy --config "$cfg"
 }
 Check 'Post-release verify original bot source, owner quote, secrets, cron, D1 and OFF gates'{
  node '.\payments\scripts\verify-owner-stars-quote-live.mjs' "$folder"
 }
 Check 'Post-release check fake auth, denied origin, no Stars checkout'{
  node '.\payments\scripts\probe-owner-stars-quote.mjs'
 }
 Write-Host 'PASS: live server now calculates 1.83 RUB/Star. Paid checkout stays OFF.' -ForegroundColor Green
}finally{
 if($ownToken){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $session=$null;$sessionOutput=$null
}
