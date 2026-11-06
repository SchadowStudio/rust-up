# RUST UP: Live Worker and Stars credit readiness + complete synthetic payment tests.
# Read-only on Cloudflare and D1. Does NOT create a Telegram invoice or alter player credit.
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $repo
git pull --ff-only origin feature/rustup-payment-admin-controls
if($LASTEXITCODE -ne 0){throw 'Git pull failed; no test run'}
$ownsToken=$false
try{
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $auth=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Cloudflare login required: npx wrangler login'}
  $parsed=$auth|Out-String|ConvertFrom-Json
  if([string]::IsNullOrWhiteSpace([string]$parsed.token)){throw 'No Cloudflare API session'}
  $env:CLOUDFLARE_API_TOKEN=[string]$parsed.token
  $ownsToken=$true
  $auth=$null;$parsed=$null
 }
 node '.\payments\scripts\test-live-stars-readiness.mjs'
 $result=$LASTEXITCODE
 if($result -eq 3){
  Write-Host 'READINESS BLOCKED: live Stars payment switches or pilot secrets are not verified. No payment charged.' -ForegroundColor Yellow
 }elseif($result -ne 0){
  throw ('Tests failed with exit '+$result)
 }
}finally{
 if($ownsToken){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
}
