# Main bot RUST UP Stars operator operations.
# activate: refuse unsafe activation; status: read live; stop: emergency checkout shutdown.
param(
 [Parameter(Mandatory=$true)][ValidateSet('activate','custom','orders','status','stop')][string]$Action,
 [string]$ApprovalReference
)
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
 if($Action -eq 'activate'){
  Write-Host 'Pilot: max. zwei Bestellungen, nur Telegram-ID 7390606911, erste Zahlung 1 Star.' -ForegroundColor Yellow
  Write-Host 'Bei Problemen kann eine Rueckerstattung manuelle Pruefung benoetigen.' -ForegroundColor Yellow
  if([string]::IsNullOrWhiteSpace($ApprovalReference)){
   $ApprovalReference=Read-Host 'Referenz deiner tatsaechlich geprueften Freigabe (12-160 Zeichen)'
  }
  if($ApprovalReference -cnotmatch '^[A-Za-z0-9._:-]{12,160}
 if($LASTEXITCODE -ne 0){throw 'Safety script failed syntax check'}
 node '.\payments\scripts\main-bot-stars-ops.mjs' $Action
 if($LASTEXITCODE -eq 2 -and $Action -eq 'activate'){
  Write-Host 'Freigabe nicht erfolgt. Die oben aufgefuehrten Voraussetzungen fehlen.' -ForegroundColor Yellow
  # Preserve a nonzero process status without throwing an unhelpful PowerShell stack trace.
  $global:LASTEXITCODE=2
 }elseif($LASTEXITCODE -ne 0){
  throw ('Payment operation failed (exit '+$LASTEXITCODE+'). Inspect output before retrying.')
 }
}finally {
 Remove-Item Env:RUSTUP_OPERATOR_RELEASE_REFERENCE -ErrorAction SilentlyContinue
 Remove-Item Env:RUSTUP_OPERATOR_REVIEW_CONFIRMED -ErrorAction SilentlyContinue
 if($owned){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $raw=$null;$credential=$null
}
){
   throw 'Gueltige reale Freigabe-Referenz erforderlich; keine Referenz erfinden'
  }
  $consent=Read-Host 'Tippe START TEST, wenn du den Pilot mit echten Stars bewusst freigeben willst'
  if($consent -cne 'START TEST'){throw 'Pilot-Aktivierung abgebrochen'}
  $env:RUSTUP_OPERATOR_RELEASE_REFERENCE=$ApprovalReference
  $env:RUSTUP_OPERATOR_REVIEW_CONFIRMED='true'
 }
 node --check '.\payments\scripts\main-bot-stars-ops.mjs'
 if($LASTEXITCODE -ne 0){throw 'Safety script failed syntax check'}
 node '.\payments\scripts\main-bot-stars-ops.mjs' $Action
 if($LASTEXITCODE -eq 2 -and $Action -eq 'activate'){
  Write-Host 'Freigabe nicht erfolgt. Die oben aufgefuehrten Voraussetzungen fehlen.' -ForegroundColor Yellow
  # Preserve a nonzero process status without throwing an unhelpful PowerShell stack trace.
  $global:LASTEXITCODE=2
 }elseif($LASTEXITCODE -ne 0){
  throw ('Payment operation failed (exit '+$LASTEXITCODE+'). Inspect output before retrying.')
 }
}finally {
 if($owned){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $raw=$null;$credential=$null
}
