# Telegram Stars end-to-end simulation on Telegram's SEPARATE test network.
# Never uses @rustuper_bot, Cloudflare production, game balances or real Stars.
param(
 [Parameter(Mandatory=$true)]
 [ValidateSet('probe','identify','invoice','watch','listen','status','refund')]
 [string]$Action,
 [string]$TestUserId,
 [ValidateRange(1,1000000)][int]$Stars=1,
 [string]$OrderId
)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo
if(!(Test-Path '.\payments\scripts\telegram-stars-test-env.mjs')){
 throw 'Telegram TEST script missing. Pull the feature branch first.'
}
if($Action -eq 'invoice' -and [string]::IsNullOrWhiteSpace($TestUserId)){
 throw 'Invoice requires -TestUserId from a dedicated Telegram TEST account.'
}
if($Action -eq 'refund' -and $OrderId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'){
 throw 'Refund requires -OrderId from the TEST invoice, never a real payment.'
}
if($Action -ne 'status' -and [string]::IsNullOrWhiteSpace($env:TELEGRAM_TEST_BOT_TOKEN)){
 $secret=Read-Host 'Telegram TEST bot token (not @rustuper_bot)' -AsSecureString
 $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
 try{
  $env:TELEGRAM_TEST_BOT_TOKEN=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
 }finally{
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  $secret=$null
 }
}
try{
 $args=@('.\payments\scripts\telegram-stars-test-env.mjs',$Action)
 if($Action -eq 'invoice'){$args+=@($TestUserId,[string]$Stars)}
 if($Action -eq 'refund'){$args+=@('REFUND TEST '+$OrderId)}
 & node @args
 if($LASTEXITCODE -ne 0){throw 'Telegram TEST-only operation failed. No production operation was attempted.'}
}finally{
 Remove-Item Env:TELEGRAM_TEST_BOT_TOKEN -ErrorAction SilentlyContinue
}
