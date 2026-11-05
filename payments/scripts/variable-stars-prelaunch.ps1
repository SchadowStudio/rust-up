# RUST UP variable Telegram Stars PRELAUNCH (READ ONLY).
# Owner-selected price is recorded in GitHub; the script audits the live Worker.
# Does not deploy or modify it.
# No invoices, charges, payment switches, D1 writes or game credits.
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $repo
$branch='feature/rustup-payment-admin-controls'
$current=(git branch --show-current)
if($LASTEXITCODE -ne 0 -or $current.Trim() -ne $branch){
 throw "Expected existing RUST UP branch $branch. No changes made."
}
git pull --ff-only origin $branch
if($LASTEXITCODE -ne 0){throw 'Git pull failed; no live actions performed'}
node --test '.\payments\scripts\variable-stars-prelaunch.test.mjs'
if($LASTEXITCODE -ne 0){throw 'Offline prelaunch unit tests failed'}
if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
 try{
  $result=& npx --yes wrangler auth token --json 2>$null
  if($LASTEXITCODE -ne 0){throw 'wrangler_login_required'}
  $auth=($result|Out-String|ConvertFrom-Json)
  if($auth.type -notin @('oauth','api_token') -or
   [string]::IsNullOrWhiteSpace([string]$auth.token)){
   throw 'wrangler_login_required'
  }
  $env:CLOUDFLARE_API_TOKEN=[string]$auth.token
 }catch{
  throw 'Login required: run npx wrangler login locally. Never paste tokens into chat.'
 }finally{$result=$null;$auth=$null}
}
Write-Host 'Checking live Worker, two D1 databases, refunds and public Mini App...' -ForegroundColor Cyan
node '.\payments\scripts\variable-stars-prelaunch.mjs'
$code=$LASTEXITCODE
if($code -eq 2){
 Write-Host 'Prelaunch blockers found. This is a valid diagnostic result; payments remain OFF.' -ForegroundColor Yellow
 exit 2
}
if($code -ne 0){throw 'Read-only prelaunch diagnostic failed without evidence'}
Write-Host 'Prelaunch checks passed. Real money release still requires independent evidence.' -ForegroundColor Green
