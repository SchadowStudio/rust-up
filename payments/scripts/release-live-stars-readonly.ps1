# Read-only Telegram Stars catalogue/history for exact CURRENT RUST UP bot.
# No payment invoice, checkout, game balance changes, real payment flags.
# Usage: powershell -ExecutionPolicy Bypass -File .\payments\scripts\release-live-stars-readonly.ps1
# To deploy: powershell -ExecutionPolicy Bypass -File .\payments\scripts\release-live-stars-readonly.ps1 -DeployReadOnly
param([switch]$DeployReadOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

function Run([string]$label, [scriptblock]$cmd) {
  Write-Host ("`n[" + $label + "]") -ForegroundColor Cyan
  $global:LASTEXITCODE = 0
  & $cmd
  if ($LASTEXITCODE -ne 0) { throw "$label FAILED ($LASTEXITCODE)" }
}

if ((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls') {
  throw 'Use the feature/rustup-payment-admin-controls branch in RUST-UP-Local.'
}
if ([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)) {
  # Wrangler 4.119+ can provide the EXISTING OAuth/API token in JSON form.
  # Capture privately into a child-process environment variable; never print it.
  $oldProgress = $ProgressPreference
  $ProgressPreference = 'SilentlyContinue'
  try {
    $authJson = & npx --yes wrangler auth token --json 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Wrangler authentication is unavailable' }
    $auth = ($authJson | Out-String | ConvertFrom-Json)
    if ($auth.type -notin @('oauth','api_token') -or
        [string]::IsNullOrWhiteSpace([string]$auth.token)) {
      throw 'Wrangler returned no usable OAuth/API token'
    }
    $env:CLOUDFLARE_API_TOKEN = [string]$auth.token
    Write-Host 'PASS: Existing Wrangler authorization loaded privately.' -ForegroundColor Green
  } catch {
    throw 'Cloudflare login missing. Run: npx wrangler login; then rerun this release script. Never share your token.'
  } finally {
    $authJson = $null
    $auth = $null
    $ProgressPreference = $oldProgress
  }
}
Run 'Update code' { git pull --ff-only origin feature/rustup-payment-admin-controls }
Run 'Offline read-only API tests' { node --test ".\payments\integration\telegram-stars\stars-readonly-live.test.mjs" }
Run 'Check read-only backend source syntax' {
  node --check ".\payments\integration\telegram-stars\stars-readonly-live.mjs"
  if ($LASTEXITCODE -ne 0) { throw 'Stars API syntax error' }
  node --check ".\payments\integration\telegram-stars\worker.stars-readonly-entry.mjs"
}
Write-Host "`n[Recover EXACT current Cloudflare worker]" -ForegroundColor Cyan
$global:LASTEXITCODE = 0
$log = @(node ".\payments\scripts\recover-live-bot-source.mjs" 2>&1)
if ($LASTEXITCODE -ne 0) {
  $log | ForEach-Object { Write-Host $_ }
  throw 'Cloudflare source recovery failed'
}
$match = $log | Select-String -Pattern '^Location:\s*(.+)$' | Select-Object -Last 1
if (!$match) { throw 'Recovered folder path missing' }
$recovered = $match.Matches[0].Groups[1].Value.Trim()
if (!(Test-Path -LiteralPath $recovered)) { throw 'Recovered folder not found' }
Write-Host 'PASS: Current Worker source safely recovered in private local folder.'
Run 'Compare current live Worker and stage isolated Stars code' {
  node ".\payments\scripts\prepare-live-stars-readonly.mjs" "$recovered"
}
$entry = Join-Path $recovered 'worker.stars-readonly-entry.mjs'
$bundle = Join-Path $recovered 'worker.stars-readonly.bundle.js'
$config = Join-Path $recovered 'wrangler.stars-readonly.toml'
Run 'Build EXACT live Worker + read-only Stars routes' {
  npx --yes esbuild "$entry" --bundle --platform=browser --format=esm --target=es2022 --sourcemap=linked "--outfile=$bundle"
}
Run 'Bundle JavaScript syntax' { node --check "$bundle" }
Run 'Wrangler Cloudflare dry-run' {
  npx --yes wrangler deploy --dry-run --config "$config"
}
Run 'Verify Cloudflare source is STILL unchanged' {
  node ".\payments\scripts\prepare-live-stars-readonly.mjs" "$recovered" --check-live
}
if (!$DeployReadOnly) {
  Write-Host "`nPASS: Read-only Stars deployment preflight passed. NOTHING DEPLOYED." -ForegroundColor Green
  Write-Host 'Review output. Re-run with -DeployReadOnly to publish only read-only endpoints.'
  exit 0
}
Run 'Deploy read-only API while all payment flags are FALSE' {
  npx --yes wrangler deploy --config "$config"
}
Write-Host "`n[Verify live Stars health]" -ForegroundColor Cyan
$health = Invoke-RestMethod -Uri 'https://rustup-bot.ttzoomrust.workers.dev/api/stars/health' -TimeoutSec 20
if (!$health.ok -or $health.service -ne 'rustup-stars-readonly' -or
    $health.checkoutEnabled -or $health.productionEnabled -or $health.gameBalanceCredit) {
  throw 'Invalid or unsafe live Stars health response. Investigate and roll back if needed.'
}
Write-Host 'PASS: Read-only Stars API is deployed; checkout=false, production=false, gameBalanceCredit=false.' -ForegroundColor Green
Write-Host 'Existing Telegram bot, game and cron were preserved from the latest Cloudflare snapshot.'
Write-Host 'Reopen the Mini App through @rustuper_bot to refresh Telegram initData.'
