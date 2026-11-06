# RUST UP: reconcile one ALREADY-refunded Telegram Stars order.
# NEVER calls refundStarPayment. No new invoices or new game credits.
param(
 [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F-]{36}$')][string]$OrderId,
 [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $root
$ownCloudflare = $false
$ownBot = $false

try {
 node --check '.\payments\scripts\reconcile-refunded-main-bot-stars.mjs'
 if ($LASTEXITCODE -ne 0) { throw 'Reconciliation JavaScript syntax invalid' }

 if ([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)) {
  $raw = @(npx --yes wrangler auth token --json 2>$null)
  if ($LASTEXITCODE -ne 0) { throw 'Cloudflare login required: npx wrangler login' }
  $credential = $raw | Out-String | ConvertFrom-Json
  if ([string]::IsNullOrWhiteSpace([string]$credential.token)) {
   throw 'Cloudflare API token unavailable'
  }
  $env:CLOUDFLARE_API_TOKEN = [string]$credential.token
  $ownCloudflare = $true
 }

 if ([string]::IsNullOrWhiteSpace($env:RUSTUP_MAIN_BOT_TOKEN)) {
  for ($attempt = 1; $attempt -le 3; $attempt++) {
   $secure = Read-Host 'Bot token for @rustuper_bot (hidden; paste and press Enter)' -AsSecureString
   $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
   try {
    $candidate = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
   }
   finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    $ptr = [IntPtr]::Zero
   }

   if ($candidate -cmatch '^[0-9]{5,15}:[A-Za-z0-9_-]{30,}$') {
    $env:RUSTUP_MAIN_BOT_TOKEN = $candidate
    $ownBot = $true
    $candidate = $null
    break
   }
   $candidate = $null
   Write-Host 'Invalid or empty token. No reconciliation attempted.' -ForegroundColor Yellow
  }
 }

 if ($env:RUSTUP_MAIN_BOT_TOKEN -cnotmatch '^[0-9]{5,15}:[A-Za-z0-9_-]{30,}$') {
  throw 'Valid bot token required; no game balance changed'
 }

 if ($Apply) {
  Write-Host 'No new Telegram refund will be sent. This only reverses verified game coins.' -ForegroundColor Yellow
  $confirmation = Read-Host "Type RECONCILE $OrderId"
  if ($confirmation -cne "RECONCILE $OrderId") {
   throw 'Reconciliation cancelled'
  }
  & node '.\payments\scripts\reconcile-refunded-main-bot-stars.mjs' $OrderId '--apply' $confirmation
 }
 else {
  & node '.\payments\scripts\reconcile-refunded-main-bot-stars.mjs' $OrderId '--check'
 }

 $exitCode = $LASTEXITCODE
 if ($exitCode -eq 2) {
  Write-Host 'Telegram refund history is still unconfirmed. No balance was changed.' -ForegroundColor Yellow
  exit 2
 }
 if ($exitCode -ne 0) {
  throw ('Reconciliation failed with code ' + $exitCode + '. Do not send another refund.')
 }
}
finally {
 if ($ownBot) { Remove-Item Env:RUSTUP_MAIN_BOT_TOKEN -ErrorAction SilentlyContinue }
 if ($ownCloudflare) { Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue }
 $candidate = $null
 $secure = $null
 $credential = $null
 $raw = $null
}
