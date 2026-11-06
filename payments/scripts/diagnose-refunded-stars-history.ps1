# Read-only Telegram refund history diagnostics; sanitized output only.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $root
$ownedCloudflare=$false
$ownedBot=$false
try{
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $raw=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Cloudflare authorization unavailable. Run npx wrangler login.'}
  $credential=$raw|Out-String|ConvertFrom-Json
  if([string]::IsNullOrWhiteSpace([string]$credential.token)){throw 'Cloudflare auth missing'}
  $env:CLOUDFLARE_API_TOKEN=[string]$credential.token
  $ownedCloudflare=$true
 }
 if([string]::IsNullOrWhiteSpace($env:RUSTUP_MAIN_BOT_TOKEN)){
  $secure=Read-Host 'Token for @rustuper_bot (hidden; do not paste into chat)' -AsSecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try{$env:RUSTUP_MAIN_BOT_TOKEN=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
  finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
  $ownedBot=$true
 }
 node --check '.\payments\scripts\diagnose-refunded-stars-history.mjs'
 if($LASTEXITCODE -ne 0){throw 'Script syntax invalid'}
 node '.\payments\scripts\diagnose-refunded-stars-history.mjs'
 if($LASTEXITCODE -ne 0){throw 'Diagnostic failed; no refund or reversal attempted'}
}finally{
 if($ownedBot){Remove-Item Env:RUSTUP_MAIN_BOT_TOKEN -ErrorAction SilentlyContinue}
 if($ownedCloudflare){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $secure=$null;$raw=$null;$credential=$null
}
