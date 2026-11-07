# RUST UP: review the EXACT current compiled Cloudflare Worker with Stars
# fixed digital goods. No source map required and NO live deployment allowed.
# Keeps original bot, webhook, cron, named exports, secrets and both D1 DBs.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $root
$ownsToken=$false
function Check([string]$name,[scriptblock]$step){
 Write-Host ('[RUST UP] '+$name) -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $step
 if($LASTEXITCODE -ne 0){throw ($name+' failed, exit '+$LASTEXITCODE)}
}
try {
 if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
  throw 'Switch to feature/rustup-payment-admin-controls first'
 }
 Check 'Update reviewed project'{
  git pull --ff-only origin feature/rustup-payment-admin-controls
 }
 Check 'Offline compiled Worker safety regressions'{
  node --test '.\payments\scripts\stage-current-compiled-worker.test.mjs'
 }
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $response=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Wrangler authentication unavailable'}
  $data=($response|Out-String|ConvertFrom-Json)
  if([string]::IsNullOrWhiteSpace([string]$data.token)){
   throw 'Wrangler did not return an authenticated token'
  }
  $env:CLOUDFLARE_API_TOKEN=[string]$data.token
  $ownsToken=$true
  $response=$null;$data=$null
 }
 $env:CLOUDFLARE_ACCOUNT_ID='af72e32cb9f1ba99dba07df30fe540fe'
 Write-Host '[RUST UP] Privately recover currently deployed compiled bot...' -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 $log=@(node '.\payments\scripts\stage-current-compiled-worker.mjs' --stage 2>&1)
 if($LASTEXITCODE -ne 0){
  $log|ForEach-Object{Write-Host $_}
  throw 'Current Worker recovery blocked; no changes made.'
 }
 $match=$log|Select-String '^NOT DEPLOYED\. Location:\s*(.+)$'|Select-Object -Last 1
 if(!$match){throw 'Private compiled recovery path missing'}
 $dir=$match.Matches[0].Groups[1].Value.Trim()
 if(!(Test-Path -LiteralPath $dir)){throw 'Private recovery folder missing'}
 $entry=Join-Path $dir 'worker.stars-compiled-entry.mjs'
 $bundle=Join-Path $dir 'worker.stars-commerce.bundle.js'
 $config=Join-Path $dir 'wrangler.stars-verified.toml'
 Check 'Bundle exact live compiled game and reviewed Stars fixed-goods wrapper'{
  npx --yes esbuild "$entry" --bundle --platform=browser --format=esm --target=es2022 --sourcemap=linked "--outfile=$bundle"
 }
 Check 'Review compiled module syntax'{
  node --check "$bundle"
 }
 Check 'Cloudflare dry-run only with all payment gates OFF'{
  npx --yes wrangler deploy --dry-run --config "$config"
 }
 Check 'Compare current live version, code bytes, bindings and secrets'{
  node '.\payments\scripts\stage-current-compiled-worker.mjs' --verify "$dir"
 }
 Write-Host 'PASS: current compiled Worker safely staged for further code review.' -ForegroundColor Green
 Write-Host 'NOT DEPLOYED. Payments OFF. No player balances touched.' -ForegroundColor Green
}finally{
 if($ownsToken){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $response=$null;$data=$null
}
