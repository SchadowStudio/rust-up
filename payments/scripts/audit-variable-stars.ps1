# READ-ONLY RUST UP variable Stars payment audit.
# Does not create charges, enable payment gates, edit D1, or expose tokens.
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo
if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  try{
    $response=& npx --yes wrangler auth token --json 2>$null
    if($LASTEXITCODE -ne 0){throw 'Wrangler not logged in'}
    $credential=($response|Out-String|ConvertFrom-Json)
    if($credential.type -notin @('oauth','api_token') -or
       [string]::IsNullOrWhiteSpace([string]$credential.token)){
      throw 'Wrangler token not returned'
    }
    $env:CLOUDFLARE_API_TOKEN=[string]$credential.token
    Write-Host 'PASS: Private Wrangler credential loaded.' -ForegroundColor Green
  }catch{
    throw 'Use npx wrangler login locally first. Never paste secrets in chat.'
  }finally{
    $response=$null
    $credential=$null
  }
}
node ".\payments\scripts\audit-variable-stars.mjs"
if($LASTEXITCODE -eq 2){
  throw 'Audit found unresolved payments or enabled payment switches. Review before changing live configuration.'
}
if($LASTEXITCODE -ne 0){
  throw 'Cloudflare audit could not finish. Do not infer the payment system is healthy.'
}
Write-Host 'PASS: Read-only audit complete. No payment or game-state changes.' -ForegroundColor Green
