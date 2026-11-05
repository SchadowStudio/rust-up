# RUST UP owner quote preview. No live payment or game-balance activation.
# Rates are a decision by the operator, not Telegram's fiat exchange rate.
param(
  [string]$RubPerStar,
  [string]$MinRub='1',
  [string]$MaxRub='1000000',
  [switch]$PublishReadOnlyPreview
)
$ErrorActionPreference='Stop'
function ParseRubles([string]$value){
  if([string]::IsNullOrWhiteSpace($value)){throw 'RUB value is required'}
  $text=$value.Trim().Replace(',','.')
  if($text -notmatch '^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$'){
    throw 'Invalid RUB amount. Use nonnegative RUB and up to two kopeck digits.'
  }
  $parts=$text.Split('.')
  $minor=[int64]::Parse($parts[0])*100
  if($parts.Length -eq 2){$minor += [int64]::Parse($parts[1].PadRight(2,'0'))}
  if($minor -lt 1 -or $minor -gt 100000000){
    throw 'Amount must be greater than zero, at most one million RUB.'
  }
  return $minor
}
if([string]::IsNullOrWhiteSpace($RubPerStar)){
  $RubPerStar=Read-Host 'Betreiberkurs: Wieviel RUB entsprechen 1 Telegram Star?'
}
$rate=ParseRubles $RubPerStar
$min=ParseRubles $MinRub
$max=ParseRubles $MaxRub
if($min -gt $max){throw 'Minimum cannot exceed maximum'}
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo
if(!(Test-Path '.\payments\scripts\preview-stars-quote.ps1')){
  throw 'Preview script missing: git pull required'
}
Write-Host ('1 Star = '+$RubPerStar+' RUB. Quote preview only.') -ForegroundColor Cyan
$call=@(
 '-NoProfile','-ExecutionPolicy','Bypass',
 '-File','.\payments\scripts\preview-stars-quote.ps1',
 '-MinRubMinor',[string]$min,
 '-MaxRubMinor',[string]$max,
 '-RubMinorPerStarNumerator',[string]$rate,
 '-RubMinorPerStarDenominator','1'
)
if($PublishReadOnlyPreview){$call+='-PublishReadOnlyPreview'}
& powershell @call
if($LASTEXITCODE -ne 0){throw 'Quote preview failed. Payment gates unchanged.'}
Write-Host 'PASS: Owner price preview checked. Real payments remain disabled.' -ForegroundColor Green
