# RUST UP Telegram Stars: read-only activation readiness.
# This never enables live payments, never creates an invoice, and never credits a game.
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo
if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
 throw 'Run this from RUST-UP-Local on feature/rustup-payment-admin-controls.'
}
$global:LASTEXITCODE=0
git pull --ff-only origin feature/rustup-payment-admin-controls
if($LASTEXITCODE -ne 0){throw 'Git pull failed; do not deploy anything'}
node --test ".\payments\scripts\check-stars-activation.test.mjs"
if($LASTEXITCODE -ne 0){throw 'Activation readiness tests failed'}
node --test ".\payments\scripts\audit-variable-stars.test.mjs"
if($LASTEXITCODE -ne 0){throw 'Stars payment audit tests failed'}

if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
 try {
  $auth=& npx --yes wrangler auth token --json 2>$null
  if($LASTEXITCODE -ne 0){throw 'No Wrangler login'}
  $session=($auth|Out-String|ConvertFrom-Json)
  if($session.type -notin @('oauth','api_token') -or
     [string]::IsNullOrWhiteSpace([string]$session.token)){
    throw 'Could not read existing Wrangler session'
  }
  $env:CLOUDFLARE_API_TOKEN=[string]$session.token
  Write-Host 'PASS: Wrangler login loaded privately.' -ForegroundColor Green
 } catch {
  throw 'Run npx wrangler login, then retry. Never paste a token in chat.'
 } finally {$auth=$null;$session=$null}
}
Write-Host 'Checking current Cloudflare Worker, D1 tables, and Stars price setup (read only)...' -ForegroundColor Cyan
node ".\payments\scripts\check-stars-activation.mjs"
if($LASTEXITCODE -ne 0){throw 'Stars activation preflight failed; payment gates must remain OFF'}
Write-Host 'PASS: Stars readiness report produced. No payment flags or balances modified.' -ForegroundColor Green
