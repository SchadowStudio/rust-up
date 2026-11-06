# RUST UP: build the EXACT current d618b572 Worker with variable Stars
# receipt/precheckout capture, NO new paid invoices or game credits.
# NO DEPLOYMENT. Default safe mode only.
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $repo
$ownedToken=$false
function Run([string]$title,[scriptblock]$step){
 Write-Host ('[RUST UP] '+$title) -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $step
 if($LASTEXITCODE -ne 0){throw ($title+' failed: '+$LASTEXITCODE)}
}
try {
 if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
  throw 'Wrong branch; use the reviewed RUST UP feature branch'
 }
 Run 'Update reviewed Stars webhook branch'{
  git pull --ff-only origin feature/rustup-payment-admin-controls
 }
 Run 'Verify original bot + receipt handling with in-memory SQLite, no charges'{
  node --test '.\payments\integration\telegram-stars\stars-variable-webhook-routing.test.mjs' '.\payments\integration\telegram-stars\stars-variable-webhook-sqlite-e2e.test.mjs' '.\payments\integration\telegram-stars\stars-variable-webhook-wrapper.test.mjs' '.\payments\scripts\stage-current-stars-webhook-only.test.mjs'
 }
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $authOutput=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Login required: npx wrangler login'}
  $auth=($authOutput|Out-String|ConvertFrom-Json)
  if([string]::IsNullOrWhiteSpace([string]$auth.token)){throw 'No Wrangler token available'}
  $env:CLOUDFLARE_API_TOKEN=[string]$auth.token
  $ownedToken=$true
  $auth=$null;$authOutput=$null
 }
 $env:CLOUDFLARE_ACCOUNT_ID='af72e32cb9f1ba99dba07df30fe540fe'
 Write-Host '[RUST UP] Capture exact current source-map verified game/bot into local private folder' -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 $result=@(node '.\payments\scripts\stage-current-stars-webhook-only.mjs' --stage 2>&1)
 if($LASTEXITCODE -ne 0){
  $result|ForEach-Object{Write-Host $_}
  throw 'Live Worker recovery refused; no deployment'
 }
 $match=$result|Select-String '^NOT DEPLOYED\. Private stage:\s*(.+)$'|Select-Object -Last 1
 if(!$match){throw 'Private stage location missing'}
 $folder=$match.Matches[0].Groups[1].Value.Trim()
 if(!(Test-Path -LiteralPath $folder)){throw 'Private stage does not exist'}
 $entry=Join-Path $folder 'worker.stars-webhook-only-entry.mjs'
 $bundle=Join-Path $folder 'worker.stars-webhook-only.bundle.js'
 $config=Join-Path $folder 'wrangler.stars-webhook-only.toml'
 Run 'Build exact current RUST UP bot + variable Stars receipt handler'{
  npx --yes esbuild "$entry" --bundle --platform=browser --format=esm --target=es2022 --sourcemap=linked "--outfile=$bundle"
 }
 Run 'Verify bundle syntax'{
  node --check "$bundle"
 }
 Run 'Cloudflare Worker DRY RUN ONLY with paid checkout disabled'{
  npx --yes wrangler deploy --dry-run --config "$config"
 }
 Run 'Recheck active Worker unchanged since capture'{
  node '.\payments\scripts\stage-current-stars-webhook-only.mjs' --verify "$folder"
 }
 Write-Host 'PASS: current bot + Stars webhook reader fully staged and tested.' -ForegroundColor Green
 Write-Host 'NOT DEPLOYED. Real payments and game wallet credits remain OFF.' -ForegroundColor Green
 Write-Host ('Private staged directory: '+$folder)
} finally {
 if($ownedToken){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $auth=$null;$authOutput=$null
}
