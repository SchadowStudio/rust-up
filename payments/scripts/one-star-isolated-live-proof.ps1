# Isolated Telegram production 1-Star payment proof with a SEPARATE BotFather bot.
# DOES NOT touch RUST UP's main bot, accounts, D1, cases, battles or payment gates.
param(
 [Parameter(Mandatory=$true)]
 [ValidateSet('purchase','listen','status','refund')][string]$Action,
 [Parameter(Mandatory=$true)][ValidatePattern('^[1-9][0-9]{0,15}$')][string]$TelegramUserId
)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo
$owned=$false
try {
 if($Action -ne 'status' -and [string]::IsNullOrWhiteSpace($env:TELEGRAM_LIVE_TEST_BOT_TOKEN)){
  $secret=Read-Host 'Paste the token of your NEW DEDICATED test bot, never @rustuper_bot' -AsSecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  try {$env:TELEGRAM_LIVE_TEST_BOT_TOKEN=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
  finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
  $secret=$null
  $owned=$true
 }
 node --check '.\payments\scripts\one-star-isolated-live-proof.mjs'
 if($LASTEXITCODE -ne 0){throw 'One-Star payment script has syntax errors'}
 node '.\payments\scripts\one-star-isolated-live-proof.mjs' $Action $TelegramUserId
 if($LASTEXITCODE -ne 0){throw 'Isolated Stars proof did not complete. Inspect state; never retry payment blindly.'}
}finally {
 if($owned){Remove-Item Env:TELEGRAM_LIVE_TEST_BOT_TOKEN -ErrorAction SilentlyContinue}
}
