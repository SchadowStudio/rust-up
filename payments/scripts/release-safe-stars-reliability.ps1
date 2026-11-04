# RUST UP Stars integration reliability release. All money gates stay OFF.
# Migrates only isolated PAYMENTS_DB and deploys existing Telegram bot/website.
param(
 [string]$RecoveredFolder="$HOME\RUST-UP-Local\.private\rustup-bot-recovered\2026-11-04T17-51-22-065Z-f7ac5f36e2",
 [string]$Website="$HOME\RUST-UP-Website",
 [switch]$PreflightOnly
)
$ErrorActionPreference="Stop"
function Step([string]$label,[scriptblock]$cmd){
 Write-Host ""
 Write-Host "[$label]" -ForegroundColor Cyan
 & $cmd
 if($LASTEXITCODE -ne 0){throw "$label FAILED with exit $LASTEXITCODE"}
}
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo
Step "Update feature branch" {git pull --ff-only origin feature/rustup-payment-admin-controls}
Step "Test Stars SQLite lifecycle" {node --test ".\payments\integration\telegram-stars\stars-sqlite-e2e.test.mjs"}
Step "Stage exact reviewed Stars bridge" {node ".\payments\scripts\stage-stars-invoice-replay.mjs" $RecoveredFolder}
$config=Join-Path $RecoveredFolder "wrangler.rustup-bot.toml"
if(!(Test-Path $config)){throw "Missing verified private Wrangler config"}
$cfg=Get-Content $config -Raw
foreach($flag in @('PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED','STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED')){
 $line=$flag+' = "false"'
 if(!$cfg.Contains($line)){throw "Unsafe config: $flag not explicitly false"}
}
$entry=Join-Path $RecoveredFolder 'worker.stars-entry.mjs'
$bundle=Join-Path $RecoveredFolder 'worker.payment-admin.bundle.js'
Step "Rebuild existing bot" {npx --yes esbuild $entry --bundle --platform=browser --format=esm --target=es2022 "--outfile=$bundle"}
Step "Check bot syntax" {node --check $bundle}
Step "Check original bot and disabled payment gates" {node ".\payments\scripts\check-telegram-wallet-bundle.mjs" $RecoveredFolder}
Step "Cloudflare Worker dry-run" {npx --yes wrangler deploy --dry-run --config $config}
if($PreflightOnly){
 Write-Host "PASS: Preflight successful. NO migration or deployment." -ForegroundColor Green
 exit 0
}
$migration=Join-Path $repo 'payments\integration\telegram-stars\invoice-links-migration.sql'
# Wrangler --file invokes Cloudflare's D1 /import endpoint, which can return
# OAuth code 10000 even when D1 /query access is valid. This is one small,
# additive idempotent statement: use the /query-backed --command instead.
$migrationSql=Get-Content -LiteralPath $migration -Raw
if($migrationSql -notmatch '(?i)CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+rustup_stars_invoice_links'){
 throw "Unexpected Stars migration contents. Refusing to run."
}
Step "Verify isolated payment D1 query access" {npx --yes wrangler d1 execute rustup-stars-staging --remote --command "SELECT 1 AS auth_ok" --config $config}
Step "Migrate isolated payment database via D1 query endpoint" {npx --yes wrangler d1 execute rustup-stars-staging --remote --command $migrationSql --config $config}
Step "Verify invoice link table exists" {npx --yes wrangler d1 execute rustup-stars-staging --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name='rustup_stars_invoice_links'" --config $config}
Step "Deploy Worker with payments OFF" {npx --yes wrangler deploy --config $config}
$health=Invoke-RestMethod 'https://rustup-bot.ttzoomrust.workers.dev/api/stars/health'
if(!$health.ok -or $health.productionEnabled -or $health.gameBalanceCredit){
 throw "Unsafe or invalid live Stars health state"
}
Write-Host ("PASS: Existing Stars API online, real-money gate OFF: "+($health|ConvertTo-Json -Compress))
Push-Location $Website
try{
 if(!(Test-Path '.git')){throw "Expected existing RUST-UP-Website checkout"}
 $staged=@(git diff --cached --name-only)
 if($staged.Count -gt 0){throw "Website already has staged changes. Refusing a mixed commit."}
 if(!(Select-String -Path '.\js\app.js' -Pattern 'RUSTUP_STARS_KEEP_PAYMENT_CHOICES_V1' -Quiet)){
  Step "Restore visible wallet payment choices" {node "$repo\payments\scripts\fix-wallet-stars-method-navigation.mjs" $Website}
  Step "Check existing Mini App syntax" {node --check ".\js\app.js"}
  Step "Check whitespace" {git -c core.whitespace=cr-at-eol diff --check -- js/app.js}
  Step "Stage only wallet app" {git add -- js/app.js}
  Step "Commit wallet fix" {git commit -m "Keep wallet payment choices visible with Stars"}
  Step "Publish existing Telegram Mini App" {git push origin main}
 }
}finally{Pop-Location}
Write-Host "PASS: Stars backend and wallet navigation updated. Real-money checkouts remain OFF." -ForegroundColor Green
