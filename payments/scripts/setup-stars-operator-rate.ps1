# RUST UP: owner-defined RUB per 1 Telegram Star; no fixed payment packages.
# Never enables real invoices, cases, upgrades, game balance or withdrawals.
param(
 [string]$RubPerStar,
 [string]$MinRub='1',
 [string]$MaxRub='1000000',
 [switch]$PublishReadOnlyPreview
)
$ErrorActionPreference='Stop'
function ParseRubles([string]$text){
 $t=$text.Trim().Replace(',','.')
 if($t -notmatch '^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?{
  throw 'Invalid RUB amount: use positive RUB with up to 2 decimal digits.'
 }
 $parts=$t.Split('.')
 $minor=[int64]::Parse($parts[0])*100
 if($parts.Length -eq 2){
  $minor+=[int64]::Parse($parts[1].PadRight(2,'0'))
 }
 if($minor -lt 1 -or $minor -gt 100000000){
  throw 'RUB amount outside supported technical range.'
 }
 return $minor
}
if([string]::IsNullOrWhiteSpace($RubPerStar)){
 $RubPerStar=Read-Host 'Wie viele RUB entspricht genau 1 Telegram Star? (z.B. 3,00)'
}
$rate=ParseRubles $RubPerStar
$min=ParseRubles $MinRub
$max=ParseRubles $MaxRub
if($min -gt $max){throw 'Minimum darf Maximum nicht ueberschreiten.'}
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
if(!(Test-Path '.\payments\scripts\preview-stars-quote.ps1')){
 throw 'Preview script not found. Pull the current feature branch first.'
}
Write-Host ('Betreiberkurs: 1 Star = '+$RubPerStar+' RUB') -ForegroundColor Cyan
Write-Host ('Technische Grenzen: '+$MinRub+' bis '+$MaxRub+' RUB. Keine festen Pakete.')
$runnerArgs=@(
 '-NoProfile','-ExecutionPolicy','Bypass',
 '-File','.\payments\scripts\preview-stars-quote.ps1',
 '-MinRubMinor',[string]$min,
 '-MaxRubMinor',[string]$max,
 '-RubMinorPerStarNumerator',[string]$rate,
 '-RubMinorPerStarDenominator','1'
)
if($PublishReadOnlyPreview){$runnerArgs+='-PublishReadOnlyPreview'}
& powershell @runnerArgs
if($LASTEXITCODE -ne 0){throw 'Stars quote preview failed. Payment gates remain OFF.'}
Write-Host 'PASS: Owner rate prepared. Live payment remains DISABLED.' -ForegroundColor Green
){
  throw 'Invalid RUB amount: use positive RUB with up to 2 decimal digits.'
 }
 $parts=$t.Split('.')
 $minor=[int64]::Parse($parts[0])*100
 if($parts.Length -eq 2){
  $minor+=[int64]::Parse($parts[1].PadRight(2,'0'))
 }
 if($minor -lt 1 -or $minor -gt 100000000){
  throw 'RUB amount outside supported technical range.'
 }
 return $minor
}
if([string]::IsNullOrWhiteSpace($RubPerStar)){
 $RubPerStar=Read-Host 'Wie viele RUB entspricht genau 1 Telegram Star? (z.B. 3,00)'
}
$rate=ParseRubles $RubPerStar
$min=ParseRubles $MinRub
$max=ParseRubles $MaxRub
if($min -gt $max){throw 'Minimum darf Maximum nicht ueberschreiten.'}
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
if(!(Test-Path '.\payments\scripts\preview-stars-quote.ps1')){
 throw 'Preview script not found. Pull the current feature branch first.'
}
Write-Host ('Betreiberkurs: 1 Star = '+$RubPerStar+' RUB') -ForegroundColor Cyan
Write-Host ('Technische Grenzen: '+$MinRub+' bis '+$MaxRub+' RUB. Keine festen Pakete.')
$runnerArgs=@(
 '-NoProfile','-ExecutionPolicy','Bypass',
 '-File','.\payments\scripts\preview-stars-quote.ps1',
 '-MinRubMinor',[string]$min,
 '-MaxRubMinor',[string]$max,
 '-RubMinorPerStarNumerator',[string]$rate,
 '-RubMinorPerStarDenominator','1'
)
if($PublishReadOnlyPreview){$runnerArgs+='-PublishReadOnlyPreview'}
& powershell @runnerArgs
if($LASTEXITCODE -ne 0){throw 'Stars quote preview failed. Payment gates remain OFF.'}
Write-Host 'PASS: Owner rate prepared. Live payment remains DISABLED.' -ForegroundColor Green
