# RUST UP main bot Stars: activate | custom | orders | status | stop.
# Never publish tokens. No live release without fresh local test results
# and explicit operator acceptance of real-money pilot risk.
param(
 [Parameter(Mandatory=$true)]
 [ValidateSet('activate','custom','orders','status','stop')]
 [string]$Action,
 [string]$ApprovalReference
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $root
$ownedCloudflare=$false
try {
 if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
  throw 'Wrong Git branch: feature/rustup-payment-admin-controls required'
 }
 node --check '.\payments\scripts\main-bot-stars-ops.mjs'
 if($LASTEXITCODE -ne 0){throw 'Pilot operator script syntax invalid'}
 if($Action -eq 'activate'){
  node --test '.\payments\scripts\main-bot-stars-ops.test.mjs'
  if($LASTEXITCODE -ne 0){throw 'Pilot atomic order-limit tests failed'}
  node '.\payments\scripts\test-full-stars-offline-e2e.mjs'
  if($LASTEXITCODE -ne 0){throw 'Stars settlement/refund offline E2E tests failed'}
  node --check '.\payments\scripts\refund-main-bot-stars.mjs'
  if($LASTEXITCODE -ne 0){throw 'Refund operator script syntax invalid'}
  Write-Host 'Controlled REAL Stars pilot: only Telegram ID 7390606911, 1 Star first, two orders maximum.' -ForegroundColor Yellow
  Write-Host 'Real money and game balance will change. A refund may require manual reconciliation.' -ForegroundColor Yellow
  if([string]::IsNullOrWhiteSpace($ApprovalReference)){
   $ApprovalReference=Read-Host 'Enter the ACTUAL documented release-review reference'
  }
  if($ApprovalReference -cnotmatch '^[A-Za-z0-9._:-]{12,160}$'){
   throw 'A real release-review reference of 12-160 safe characters is required'
  }
  $consent=Read-Host 'Type START TEST to authorize the controlled REAL Stars pilot'
  if($consent -cne 'START TEST'){throw 'No activation: operator declined'}
  $env:RUSTUP_OPERATOR_RELEASE_REFERENCE=$ApprovalReference
  $env:RUSTUP_OPERATOR_REVIEW_CONFIRMED='true'
 }
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $raw=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Run npx wrangler login first'}
  $credential=$raw|Out-String|ConvertFrom-Json
  if([string]::IsNullOrWhiteSpace([string]$credential.token)){
   throw 'Wrangler credential unavailable'
  }
  $env:CLOUDFLARE_API_TOKEN=[string]$credential.token
  $ownedCloudflare=$true
 }
 node '.\payments\scripts\main-bot-stars-ops.mjs' $Action
 $code=$LASTEXITCODE
 if($code -eq 2 -and $Action -eq 'activate'){
  Write-Host 'Pilot NOT activated. Above are the exact remaining live blockers.' -ForegroundColor Yellow
  exit 2
 }
 if($code -ne 0){throw ('Pilot operator action failed, exit code '+$code)}
}finally{
 Remove-Item Env:RUSTUP_OPERATOR_RELEASE_REFERENCE -ErrorAction SilentlyContinue
 Remove-Item Env:RUSTUP_OPERATOR_REVIEW_CONFIRMED -ErrorAction SilentlyContinue
 if($ownedCloudflare){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $raw=$null
 $credential=$null
}
