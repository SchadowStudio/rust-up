# RUST UP — safe Stars activation preparation, live READ ONLY.
# This never creates payment invoices, modifies D1, changes Cloudflare settings,
# or enables any public payment gate.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
 throw 'Wrong Git branch; no changes made'
}
git pull --ff-only origin feature/rustup-payment-admin-controls
if($LASTEXITCODE -ne 0){throw 'Git pull failed'}
node --check '.\payments\scripts\stars-activation-gate-report.mjs'
if($LASTEXITCODE -ne 0){throw 'Diagnostic syntax failed'}
$owned=$false
try{
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $raw=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Wrangler login needed'}
  $auth=($raw|Out-String|ConvertFrom-Json)
  if([string]::IsNullOrWhiteSpace([string]$auth.token)){throw 'Wrangler access token unavailable'}
  $env:CLOUDFLARE_API_TOKEN=[string]$auth.token
  $owned=$true
 }
 node '.\payments\scripts\stars-activation-gate-report.mjs'
 if($LASTEXITCODE -ne 0){throw 'Read-only Cloudflare preflight failed'}
 Write-Host 'PASS: Production Stars readiness reported. No settings changed.' -ForegroundColor Green
}finally{
 if($owned){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $raw=$null;$auth=$null
}
