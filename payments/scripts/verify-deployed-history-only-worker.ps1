# RUST UP: Verify the ALREADY DEPLOYED read-only Stars history Worker.
# Deliberately does not run Wrangler deploy, D1 execute, or change any account.
param([Parameter(Mandatory=$true)][string]$StageFolder)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $repo
$ownedToken=$false
function Check([string]$label,[scriptblock]$action){
 Write-Host ('[RUST UP] '+$label) -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $action
 if($LASTEXITCODE -ne 0){throw ($label+' FAILED, exit '+$LASTEXITCODE)}
}
try {
 if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
  throw 'Verify only from the reviewed RUST UP feature branch'
 }
 $root=Join-Path $repo '.private\rustup-bot-recovered'
 if(!(Test-Path -LiteralPath $StageFolder -PathType Container)){
  throw 'Original private recovery folder missing; do not overwrite deployed Worker'
 }
 $private=(Resolve-Path -LiteralPath $root).Path.TrimEnd('\')+'\'
 $folder=(Resolve-Path -LiteralPath $StageFolder).Path
 if(!$folder.StartsWith($private,[StringComparison]::OrdinalIgnoreCase)){
  throw 'Untrusted recovery folder; stop'
 }
 Check 'Run offline tests for both supported Cloudflare module filename formats'{
  node --test '.\payments\scripts\verify-history-only-worker-release.test.mjs' '.\payments\scripts\probe-history-only-worker.test.mjs'
 }
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $authOutput=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Cloudflare login missing; run npx wrangler login'}
  $auth=($authOutput|Out-String|ConvertFrom-Json)
  if([string]::IsNullOrWhiteSpace([string]$auth.token)){
   throw 'Wrangler did not provide an authentication token'
  }
  $env:CLOUDFLARE_API_TOKEN=[string]$auth.token
  $ownedToken=$true
  $auth=$null;$authOutput=$null
 }
 Check 'READ ONLY: verify deployed code, original bot SHA-256, D1, secrets, cron and money flags'{
  node '.\payments\scripts\verify-history-only-worker-release.mjs' after "$folder"
 }
 Check 'READ ONLY: probe unauthenticated history, CORS and blocked quote/checkout routes'{
  node '.\payments\scripts\probe-history-only-worker.mjs'
 }
 Write-Host 'PASS: already-deployed Stars history Worker verified without a new deployment.' -ForegroundColor Green
 Write-Host 'Real payments and all game-balance settlement gates remain OFF.' -ForegroundColor Green
} finally {
 if($ownedToken){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $auth=$null;$authOutput=$null
}
