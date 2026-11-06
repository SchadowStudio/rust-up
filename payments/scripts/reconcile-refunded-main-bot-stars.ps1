# Reconcile an ALREADY refunded Stars order. NEVER calls refundStarPayment.
param(
 [Parameter(Mandatory=$true)][string]$OrderId,
 [switch]$Apply
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $root
$ownedCloudflare=$false
$ownedBot=$false
try {
 if($OrderId -notmatch '^[0-9a-fA-F-]{36}$'){throw 'Invalid order UUID'}
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $raw=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Run npx wrangler login first'}
  $credential=($raw|Out-String|ConvertFrom-Json)
  if([string]::IsNullOrWhiteSpace([string]$credential.token)){throw 'Cloudflare token unavailable'}
  $env:CLOUDFLARE_API_TOKEN=[string]$credential.token
  $ownedCloudflare=$true
 }
 if([string]::IsNullOrWhiteSpace($env:RUSTUP_MAIN_BOT_TOKEN)){
  for($attempt=1;$attempt -le 3;$attempt++){
   $secure=Read-Host 'Bot token for @rustuper_bot (hidden; type/paste token, then Enter)' -AsSecureString
   $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
   try{$candidate=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
   finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr);$ptr=[IntPtr]::Zero}
   if($candidate -cmatch '^[0-9]{5,15}:[A-Za-z0-9_-]{30,}
 node --check '.\payments\scripts\reconcile-refunded-main-bot-stars.mjs'
 if($LASTEXITCODE -ne 0){throw 'Reconciliation syntax check failed'}
 if($Apply){
  Write-Host 'Apply only after Telegram has independently confirmed the refund.' -ForegroundColor Yellow
  $confirm=Read-Host "Type RECONCILE $OrderId"
  if($confirm -cne "RECONCILE $OrderId"){throw 'Cancelled, no balance changes'}
  node '.\payments\scripts\reconcile-refunded-main-bot-stars.mjs' $OrderId '--apply' $confirm
 }else{
  node '.\payments\scripts\reconcile-refunded-main-bot-stars.mjs' $OrderId '--check'
 }
 if($LASTEXITCODE -eq 2){
  Write-Host 'Refund history not confirmed. Do not reissue refund; no game balance changed.' -ForegroundColor Yellow
 }elseif($LASTEXITCODE -ne 0){
  throw 'Reconciliation not verified; do not reissue provider refund'
 }
}finally{
 if($ownedBot){Remove-Item Env:RUSTUP_MAIN_BOT_TOKEN -ErrorAction SilentlyContinue}
 if($ownedCloudflare){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $secure=$null;$ptr=[IntPtr]::Zero;$raw=$null;$credential=$null
}
){
    $env:RUSTUP_MAIN_BOT_TOKEN=$candidate
    $ownedBot=$true
    $candidate=$null
    break
   }
   $candidate=$null
   Write-Host 'No valid Telegram bot token entered. Nothing was changed.' -ForegroundColor Yellow
  }
 }
 if($env:RUSTUP_MAIN_BOT_TOKEN -cnotmatch '^[0-9]{5,15}:[A-Za-z0-9_-]{30,}
 node --check '.\payments\scripts\reconcile-refunded-main-bot-stars.mjs'
 if($LASTEXITCODE -ne 0){throw 'Reconciliation syntax check failed'}
 if($Apply){
  Write-Host 'Apply only after Telegram has independently confirmed the refund.' -ForegroundColor Yellow
  $confirm=Read-Host "Type RECONCILE $OrderId"
  if($confirm -cne "RECONCILE $OrderId"){throw 'Cancelled, no balance changes'}
  node '.\payments\scripts\reconcile-refunded-main-bot-stars.mjs' $OrderId '--apply' $confirm
 }else{
  node '.\payments\scripts\reconcile-refunded-main-bot-stars.mjs' $OrderId '--check'
 }
 if($LASTEXITCODE -eq 2){
  Write-Host 'Refund history not confirmed. Do not reissue refund; no game balance changed.' -ForegroundColor Yellow
 }elseif($LASTEXITCODE -ne 0){
  throw 'Reconciliation not verified; do not reissue provider refund'
 }
}finally{
 if($ownedBot){Remove-Item Env:RUSTUP_MAIN_BOT_TOKEN -ErrorAction SilentlyContinue}
 if($ownedCloudflare){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $secure=$null;$ptr=[IntPtr]::Zero;$raw=$null;$credential=$null
}
){
  throw 'Missing or invalid bot token. Reconciliation was not attempted.'
 }
 node --check '.\payments\scripts\reconcile-refunded-main-bot-stars.mjs'
 if($LASTEXITCODE -ne 0){throw 'Reconciliation syntax check failed'}
 if($Apply){
  Write-Host 'Apply only after Telegram has independently confirmed the refund.' -ForegroundColor Yellow
  $confirm=Read-Host "Type RECONCILE $OrderId"
  if($confirm -cne "RECONCILE $OrderId"){throw 'Cancelled, no balance changes'}
  node '.\payments\scripts\reconcile-refunded-main-bot-stars.mjs' $OrderId '--apply' $confirm
 }else{
  node '.\payments\scripts\reconcile-refunded-main-bot-stars.mjs' $OrderId '--check'
 }
 if($LASTEXITCODE -eq 2){
  Write-Host 'Refund history not confirmed. Do not reissue refund; no game balance changed.' -ForegroundColor Yellow
 }elseif($LASTEXITCODE -ne 0){
  throw 'Reconciliation not verified; do not reissue provider refund'
 }
}finally{
 if($ownedBot){Remove-Item Env:RUSTUP_MAIN_BOT_TOKEN -ErrorAction SilentlyContinue}
 if($ownedCloudflare){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $secure=$null;$ptr=[IntPtr]::Zero;$raw=$null;$credential=$null
}
