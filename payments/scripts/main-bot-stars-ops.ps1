# Main bot RUST UP Stars operator operations.
# activate: refuse unsafe activation; status: read live; stop: emergency checkout shutdown.
param([Parameter(Mandatory=$true)][ValidateSet('activate','status','stop')][string]$Action)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
$owned=$false
try {
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $raw=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Log in with npx wrangler login first'}
  $credential=$raw|Out-String|ConvertFrom-Json
  if([string]::IsNullOrWhiteSpace([string]$credential.token)){throw 'Wrangler token unavailable'}
  $env:CLOUDFLARE_API_TOKEN=[string]$credential.token
  $owned=$true
 }
 node --check '.\payments\scripts\main-bot-stars-ops.mjs'
 if($LASTEXITCODE -ne 0){throw 'Safety script failed syntax check'}
 node '.\payments\scripts\main-bot-stars-ops.mjs' $Action
 if($LASTEXITCODE -ne 0){throw 'Payment operation blocked or incomplete; inspect output'}
}finally {
 if($owned){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $raw=$null;$credential=$null
}
