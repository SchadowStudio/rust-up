# RUST UP: publish only safe Telegram Stars variable amount UI corrections.
# Does not redeploy Cloudflare, enable payments or modify game database.
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo
function Safe([string]$label,[scriptblock]$command){
 Write-Host ("`n["+$label+"]") -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $command
 if($LASTEXITCODE -ne 0){throw "$label failed (exit $LASTEXITCODE)"}
}
if((git branch --show-current).Trim() -ne 'feature/rustup-payment-admin-controls'){
 throw 'Run in RUST-UP-Local on feature/rustup-payment-admin-controls'
}
Safe 'Pull verified UI changes'{
 git pull --ff-only origin feature/rustup-payment-admin-controls
}
Safe 'Test valid/invalid amount inputs, purchase history and website release'{
 node --test ".\payments\scripts\stars-variable-wallet-ui.test.mjs" ".\payments\scripts\publish-stars-ui-refresh.test.mjs"
}
$dir=Join-Path $env:TEMP ('rustup-stars-ui-'+[guid]::NewGuid().ToString('N'))
Safe 'Clone existing RUST UP Mini App'{
 git clone --depth 1 --branch main https://github.com/ttzoomrust-hub/rust-up.git "$dir"
}
Safe 'Verify only Stars UI and cache key will be changed'{
 node ".\payments\scripts\publish-stars-ui-refresh.mjs" "$dir" --check
}
Safe 'Publish corrected Stars UI to GitHub Pages main'{
 node ".\payments\scripts\publish-stars-ui-refresh.mjs" "$dir" --publish
}
Write-Host 'PASS: RUST UP Stars wallet UI updated without changing payment flags.' -ForegroundColor Green
