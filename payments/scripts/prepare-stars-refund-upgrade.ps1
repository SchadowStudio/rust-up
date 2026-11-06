# Prepare a refund-aware RUST UP Worker bundle, strictly LOCAL DRY RUN.
# Do not use this to publish or turn on paid invoices.
param([string]$StageFolder=".\.private\rustup-bot-recovered\webhook-only-d618b572-dc181bc6f2")
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $repo
if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
 throw 'Wrong branch'
}
function Run([string]$name,[scriptblock]$command){
 Write-Host ('[RUST UP] '+$name) -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $command
 if($LASTEXITCODE -ne 0){throw ($name+' exit '+$LASTEXITCODE)}
}
Run 'Run refund, webhook and staging tests' {
 node --test '.\payments\integration\account-credit-ledger\verified-stars-game-refund.test.mjs' '.\payments\integration\account-credit-ledger\freeze-verified-stars-game-quote.test.mjs' '.\payments\integration\account-credit-ledger\stars-checkout-frozen-quote-e2e.test.mjs' '.\payments\integration\telegram-stars\stars-variable-webhook-wrapper.test.mjs' '.\payments\scripts\stage-current-stars-webhook-only.test.mjs'
}
$ownToken=$false
try{
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $output=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Wrangler login required'}
  $auth=($output|Out-String|ConvertFrom-Json)
  if([string]::IsNullOrWhiteSpace([string]$auth.token)){throw 'No authenticated Wrangler token'}
  $env:CLOUDFLARE_API_TOKEN=[string]$auth.token
  $ownToken=$true
  $auth=$null;$output=$null
 }
 Run 'Verify currently published Worker against prior known-safe source map'{
  node '.\payments\scripts\verify-stars-webhook-only-live.mjs' "$StageFolder"
 }
 Run 'Prepare refund-aware modules without modifying deployed Worker'{
  node '.\payments\scripts\prepare-stars-refund-upgrade.mjs' "$StageFolder"
 }
 $base=(Resolve-Path -LiteralPath $StageFolder).Path
 $target=$base+'-refund-preflight'
 $entry=Join-Path $target 'worker.stars-webhook-only-entry.mjs'
 $bundle=Join-Path $target 'worker.stars-webhook-only.bundle.js'
 $config=Join-Path $target 'wrangler.stars-webhook-only.toml'
 Run 'Compile local-only refund-aware Worker'{
  npx --yes esbuild "$entry" --bundle --platform=browser --format=esm --target=es2022 --sourcemap=linked "--outfile=$bundle"
 }
 Run 'Check compiled Worker syntax'{node --check "$bundle"}
 Run 'Inspect Cloudflare dry run with all paid switches OFF'{
  npx --yes wrangler deploy --dry-run --config "$config"
 }
 Write-Host ('PASS: refund-aware DRY RUN only. Private stage: '+$target) -ForegroundColor Green
 Write-Host 'NOT DEPLOYED. No real invoices, payouts or game credits.' -ForegroundColor Green
}finally{
 if($ownToken){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
}
