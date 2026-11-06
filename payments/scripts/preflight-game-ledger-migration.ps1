# RUST UP – read-only migration preflight for canonical paid receipt journal.
# Never executes SQL DDL or edits a game account; does not deploy a Worker.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $root
$ownsToken=$false
try {
 if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
  throw 'Switch to feature/rustup-payment-admin-controls first'
 }
 $global:LASTEXITCODE=0
 node --test '.\payments\scripts\preflight-game-ledger-migration.test.mjs' '.\payments\integration\account-credit-ledger\atomic-game-credit.test.mjs'
 if($LASTEXITCODE -ne 0){throw 'Local ledger migration regressions failed'}
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $data=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Wrangler login missing'}
  $auth=($data|Out-String|ConvertFrom-Json)
  if([string]::IsNullOrWhiteSpace([string]$auth.token)){
   throw 'Wrangler did not return a usable OAuth token'
  }
  $env:CLOUDFLARE_API_TOKEN=[string]$auth.token
  $ownsToken=$true
  $data=$null;$auth=$null
 }
 Write-Host '[RUST UP] Checking actual D1 account schema, balance mirrors and payment controls (read-only)' -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 node '.\payments\scripts\preflight-game-ledger-migration.mjs'
 $code=$LASTEXITCODE
 if($code -eq 2){
  Write-Warning 'Migration preflight has blockers; no D1 writes have occurred.'
  exit 2
 }
 if($code -ne 0){throw 'Live migration preflight could not be verified'}
 Write-Host 'PASS: migration preflight only. No D1 tables were created.' -ForegroundColor Green
} finally {
 if($ownsToken){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $data=$null;$auth=$null
}
