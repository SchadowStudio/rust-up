# Safe, read-only RUST UP paid Stars pilot refund readiness audit.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $root
$owned=$false
try {
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $raw=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Run npx wrangler login first'}
  $credential=$raw|Out-String|ConvertFrom-Json
  if([string]::IsNullOrWhiteSpace([string]$credential.token)){throw 'Cloudflare token unavailable'}
  $env:CLOUDFLARE_API_TOKEN=[string]$credential.token
  $owned=$true
 }
 node --check '.\payments\scripts\stars-pilot-refund-readiness.mjs'
 if($LASTEXITCODE -ne 0){throw 'Refund readiness script syntax invalid'}
 node '.\payments\scripts\stars-pilot-refund-readiness.mjs'
 if($LASTEXITCODE -eq 2){
  Write-Host 'Refund is NOT ready. See the specific blockers above. No charges or game balances changed.' -ForegroundColor Yellow
 }elseif($LASTEXITCODE -ne 0){throw 'Refund readiness query failed'}
}finally{
 if($owned){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $raw=$null
 $credential=$null
}
