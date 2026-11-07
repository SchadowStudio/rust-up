# RUST UP: READ-ONLY Cloudflare audit for competing Wrangler deployers.
# No Worker upload, money change, or user identity exposed.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $root
$ownsToken=$false
try{
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $raw=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Wrangler auth unavailable. Run npx wrangler login.'}
  $info=($raw|Out-String|ConvertFrom-Json)
  if([string]::IsNullOrWhiteSpace([string]$info.token)){
   throw 'Wrangler login returned no token'
  }
  $env:CLOUDFLARE_API_TOKEN=[string]$info.token
  $ownsToken=$true
  $raw=$null;$info=$null
 }
 Write-Host '[RUST UP] Checking Worker deployment ownership and Stars binding...' -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 node '.\payments\scripts\audit-worker-publishers.mjs'
 $code=$LASTEXITCODE
 if($code -eq 2){
  Write-Warning 'Worker payment binding/flags are missing or unsafe, or publisher ownership is not verified.'
  Write-Host 'When publisherAudit=UNAVAILABLE_ACCOUNT_SETTINGS_READ_REQUIRED, Cloudflare Account Settings Read permission is needed for local actor audit.'
  Write-Host 'Missing audit permission does not prove one or several publishers; do not deploy or enable money until ownership is verified.'
  Write-Host 'READ ONLY: No changes were made.'
  exit 2
 }
 if($code -ne 0){throw 'Read-only audit failed; do not guess live deployment state.'}
 Write-Host 'PASS: No competing publish or missing Stars bindings found in inspected history.' -ForegroundColor Green
}
finally {
 if($ownsToken){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $raw=$null;$info=$null
}
