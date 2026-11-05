# RUST UP: operator-selected reference rate preview.
# Full precision (5 decimals): the rate is NOT an official Telegram fiat quote.
# The Mini App's paid-game wallet and all payment gates stay disabled.
param(
  [string]$RubPerStar,
  [string]$MinRub='1',
  [string]$MaxRub='1000000',
  [switch]$PublishReadOnlyPreview
)
$ErrorActionPreference='Stop'
function ParseRubles([string]$value){
  if([string]::IsNullOrWhiteSpace($value)){throw 'RUB value is required'}
  $value=$value.Trim().Replace(',','.')
  if($value -notmatch '^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$'){
    throw 'Invalid RUB amount. Use up to two kopeck digits.'
  }
  $parts=$value.Split('.')
  $minor=[int64]::Parse($parts[0])*100
  if($parts.Length -eq 2){$minor += [int64]::Parse($parts[1].PadRight(2,'0'))}
  if($minor -lt 1 -or $minor -gt 100000000){
    throw 'Amount must be greater than zero, at most one million RUB.'
  }
  return $minor
}
function ParseRateNumerator([string]$value){
  if([string]::IsNullOrWhiteSpace($value)){throw 'RUB per Star rate is required'}
  $value=$value.Trim().Replace(',','.')
  if($value -notmatch '^(?:0|[1-9]\d{0,6})(?:\.\d{1,5})?$'){
    throw 'Invalid RUB/Star rate. Use up to five decimal places.'
  }
  $parts=$value.Split('.')
  $fixed=[int64]::Parse($parts[0])*100000
  if($parts.Length -eq 2){$fixed += [int64]::Parse($parts[1].PadRight(5,'0'))}
  if($fixed -le 0 -or $fixed -gt 100000000000){
    throw 'Rate is out of supported range.'
  }
  # 5 decimals of RUB per Star = 1/1000 kopeck per Star.
  # 1.87159 RUB/Star -> 187159 kopecks / 1000 Stars.
  return $fixed
}
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $repo
$rateFile=Join-Path $repo 'payments/stars-owner-rate.json'
if(!(Test-Path -LiteralPath $rateFile)){throw 'Owner Stars rate file missing'}
$owner=Get-Content -LiteralPath $rateFile -Raw -Encoding UTF8 | ConvertFrom-Json
if([string]::IsNullOrWhiteSpace($RubPerStar)){
  $RubPerStar=[string]$owner.rubPerStarDecimal
}
$num=ParseRateNumerator $RubPerStar
$den=1000
$min=ParseRubles $MinRub
$max=ParseRubles $MaxRub
if($min -gt $max){throw 'Minimum cannot exceed maximum'}
if([string]::IsNullOrWhiteSpace($owner.STARS_RUB_MINOR_PER_STAR_NUM) -or
   [string]::IsNullOrWhiteSpace($owner.STARS_RUB_MINOR_PER_STAR_DEN)){
  throw 'Operator rate manifest is incomplete'
}
if($RubPerStar -eq [string]$owner.rubPerStarDecimal -and
  ([string]$num -ne [string]$owner.STARS_RUB_MINOR_PER_STAR_NUM -or
   [string]$den -ne [string]$owner.STARS_RUB_MINOR_PER_STAR_DEN)){
  throw 'Operator rate manifest differs from exact decimal rate'
}
if(!(Test-Path '.\payments\scripts\preview-stars-quote.ps1')){
  throw 'Preview script missing: git pull required'
}
Write-Host ('1 Star = '+$RubPerStar+' RUB (reference price, whole Stars rounded up)') -ForegroundColor Cyan
$call=@(
  '-NoProfile','-ExecutionPolicy','Bypass',
  '-File','.\payments\scripts\preview-stars-quote.ps1',
  '-MinRubMinor',[string]$min,
  '-MaxRubMinor',[string]$max,
  '-RubMinorPerStarNumerator',[string]$num,
  '-RubMinorPerStarDenominator',[string]$den
)
if($PublishReadOnlyPreview){$call+='-PublishReadOnlyPreview'}
& powershell @call
if($LASTEXITCODE -ne 0){throw 'Quote preview failed. Payment gates unchanged.'}
Write-Host 'PASS: Exact operator-selected rate validated. Real-game credits remain disabled.' -ForegroundColor Green
