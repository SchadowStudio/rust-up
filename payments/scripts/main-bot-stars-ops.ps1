# RUST UP Stars operator commands.
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
 $branch=(git branch --show-current).Trim()
 if($branch -ne 'feature/rustup-payment-admin-controls'){throw 'Wrong Git branch'}
 node --check '.\payments\scripts\main-bot-stars-ops.mjs'
 if($LASTEXITCODE -ne 0){throw 'Operator script syntax error'}
 if($Action -eq 'activate'){
  node --test '.\payments\scripts\main-bot-stars-ops.test.mjs'
  if($LASTEXITCODE -ne 0){throw 'Pilot order-limit tests failed'}
  node '.\payments\scripts\test-full-stars-offline-e2e.mjs'
  if($LASTEXITCODE -ne 0){throw 'Stars offline E2E tests failed'}
  node --check '.\payments\scripts\refund-main-bot-stars.mjs'
  if($LASTEXITCODE -ne 0){throw 'Stars refund script syntax error'}
  Write-Host 'REAL pilot: 1 Star first; at most 2 orders; owner only.' -ForegroundColor Yellow
  Write-Host 'Refunds may require manual reconciliation.' -ForegroundColor Yellow
  if([string]::IsNullOrWhiteSpace($ApprovalReference)){
   $ApprovalReference=Read-Host 'Enter the actual documented release review reference'
  }
  if($ApprovalReference -ceq 'RUSTUP-STARS-REVIEW-001'){
   throw 'Example review reference is not actual review evidence'
  }
  if($ApprovalReference -cnotmatch '^[A-Za-z0-9._:-]{12,160}$'){
   throw 'A genuine release review reference of 12 to 160 characters is required'
  }
  $consent=Read-Host 'Type START TEST to authorize real Stars payment pilot'
  if($consent -cne 'START TEST'){throw 'Activation cancelled'}
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
  Write-Host 'NOT ACTIVATED. Review the blockers above.' -ForegroundColor Yellow
 }elseif($code -ne 0){
  throw ('Payment operation error, exit code '+$code)
 }
}finally{
 Remove-Item Env:RUSTUP_OPERATOR_RELEASE_REFERENCE -ErrorAction SilentlyContinue
 Remove-Item Env:RUSTUP_OPERATOR_REVIEW_CONFIRMED -ErrorAction SilentlyContinue
 if($ownedCloudflare){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $raw=$null
 $credential=$null
}
