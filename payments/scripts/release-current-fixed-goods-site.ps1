# RUST UP – one-command update for fixed NON-WAGERABLE Stars digital goods.
# Default performs tests and a website compatibility check ONLY.
# -Publish explicitly commits and pushes the reviewed isolated Stars panel.
# This does NOT enable payments, case deposits, crypto, or game wallet credits.
param([switch]$Publish)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $root
function Check([string]$title,[scriptblock]$step){
 Write-Host ('[RUST UP] '+$title) -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $step
 if($LASTEXITCODE -ne 0){throw ($title+' failed, exit '+$LASTEXITCODE)}
}
if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
 throw 'Expected branch feature/rustup-payment-admin-controls'
}
Check 'Update reviewed RUST UP source'{
 git pull --ff-only origin feature/rustup-payment-admin-controls
}
Check 'Verify current Mini App, fixed goods Stars, and release gates'{
 node --test '.\payments\scripts\publish-current-demo-stars-fixed-goods.test.mjs' '.\payments\scripts\supporter-payment-preflight.test.mjs' '.\payments\frontend\telegram-miniapp\stars-fixed-market-terms.test.mjs'
}
$site=Join-Path $root '.private\rustup-website-release'
$siteRoot=Split-Path -Parent $site
if(!(Test-Path -LiteralPath $siteRoot)){
 New-Item -ItemType Directory -Path $siteRoot -Force | Out-Null
}
if(!(Test-Path -LiteralPath (Join-Path $site '.git'))){
 if(Test-Path -LiteralPath $site){
  throw 'Website release location is not a clean Git clone. Preserve it for inspection.'
 }
 Check 'Recover original website in private local clone'{
  git clone 'https://github.com/ttzoomrust-hub/rust-up.git' "$site"
 }
}
Push-Location -LiteralPath $site
try{
 $remote=(git remote get-url origin).Trim()
 if($remote -notmatch '^(https://github\.com/|git@github\.com:)ttzoomrust-hub/rust-up(\.git)?/?$'){
  throw 'Website clone has an unexpected GitHub remote'
 }
 if((git branch --show-current).Trim() -ne 'main'){
  throw 'Website checkout is not on main'
 }
 if((git status --porcelain).Length -gt 0){
  throw 'Private website checkout has local changes'
 }
 Check 'Fast-forward private website clone to current main'{
  git pull --ff-only origin main
 }
}finally{Pop-Location}
$publisher='.\payments\scripts\publish-current-demo-stars-fixed-goods.mjs'
Check 'Verify exact website version and disallow game-wallet payments'{
 node "$publisher" "$site" --check
}
if(!$Publish){
 Write-Host 'PASS: Website is compatible. NOTHING PUBLISHED.' -ForegroundColor Green
 Write-Host 'Only the isolated fixed-goods shop is staged. No real-money switches enabled.'
 exit 0
}
Check 'Explicitly publish fixed digital goods wallet panel'{
 node "$publisher" "$site" --publish
}
Write-Host 'PASS: Reviewed digital-goods Stars shop committed and pushed to website main.' -ForegroundColor Green
Write-Host 'No payment feature flags or game balances changed; GitHub Pages may cache the old site briefly.'
