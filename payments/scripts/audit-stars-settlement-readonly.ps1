# Read-only audit of the live RUST UP Stars payment and game ledgers.
# Never deploys a Worker, enables payments, changes D1, or prints secrets.
$ErrorActionPreference = 'Stop'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $root
$ownToken=$false
try {
  if ([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)) {
    $response=@(npx --yes wrangler auth token --json 2>$null)
    if($LASTEXITCODE -ne 0) {
      throw 'Cloudflare login missing. Run: npx wrangler login'
    }
    $result=($response | Out-String | ConvertFrom-Json)
    if([string]::IsNullOrWhiteSpace([string]$result.token))
      {throw 'Cloudflare auth token unavailable'}
    $env:CLOUDFLARE_API_TOKEN=[string]$result.token
    $ownToken=$true
  }
  Write-Host '[RUST UP] Read-only Stars D1 reconciliation...' -ForegroundColor Cyan
  node ".\payments\scripts\audit-stars-settlement-readonly.mjs"
  $code=$LASTEXITCODE
  if($code -eq 2){
    Write-Host '[RUST UP] Read-only audit found release blockers. No payment or balance was changed.' -ForegroundColor Yellow
    exit 2
  }
  if($code -ne 0){throw ('Stars audit failed with code '+$code)}
  Write-Host '[RUST UP] Read-only checks passed. This is NOT a payment activation.' -ForegroundColor Green
}
finally {
  if($ownToken){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
  $response=$null
  $result=$null
}
