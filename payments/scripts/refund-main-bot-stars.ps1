# Manual operator refund for a REAL Stars payment on @rustuper_bot.
# Never paste your bot token into chat; enter it only in your local PowerShell prompt.
param([Parameter(Mandatory=$true)][string]$OrderId)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
$ownedCloudflare=$false
try {
 if($OrderId -notmatch '^[0-9a-fA-F-]{36}$'){throw 'Valid Stars order UUID required'}
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $raw=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Run npx wrangler login first'}
  $credential=$raw|Out-String|ConvertFrom-Json
  if([string]::IsNullOrWhiteSpace([string]$credential.token)){throw 'Wrangler credential unavailable'}
  $env:CLOUDFLARE_API_TOKEN=[string]$credential.token
  $ownedCloudflare=$true
 }
 node --check '.\payments\scripts\refund-main-bot-stars.mjs'
 if($LASTEXITCODE -ne 0){throw 'Refund code syntax check failed'}
 Write-Host 'Checking payment, frozen quote and game mirror before any Telegram refund...' -ForegroundColor Cyan
 node '.\payments\scripts\refund-main-bot-stars.mjs' --preflight $OrderId
 if($LASTEXITCODE -ne 0){
  Write-Host 'Refund was NOT attempted. Fix the above account or receipt issue first.' -ForegroundColor Yellow
  exit 2
 }
 if([string]::IsNullOrWhiteSpace($env:RUSTUP_MAIN_BOT_TOKEN)){
  $secret=Read-Host 'Main bot @rustuper_bot token (hidden, never paste in chat)' -AsSecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  try{
   $env:RUSTUP_MAIN_BOT_TOKEN=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  }finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
 }
 node --check '.\payments\scripts\refund-main-bot-stars.mjs'
 if($LASTEXITCODE -ne 0){throw 'Refund code syntax check failed'}
 Write-Host 'One-time real Stars refund. Only the original Telegram user receives Stars.' -ForegroundColor Yellow
 $confirm=Read-Host "Enter REFUND $OrderId to confirm"
 if($confirm -cne "REFUND $OrderId"){throw 'Refund cancelled'}
 node '.\payments\scripts\refund-main-bot-stars.mjs' $OrderId $confirm
 if($LASTEXITCODE -ne 0){throw 'Refund could not be fully confirmed. Do not retry; inspect original payment and logs.'}
}finally{
 Remove-Item Env:RUSTUP_MAIN_BOT_TOKEN -ErrorAction SilentlyContinue
 if($ownedCloudflare){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $secret=$null;$raw=$null;$credential=$null
}
