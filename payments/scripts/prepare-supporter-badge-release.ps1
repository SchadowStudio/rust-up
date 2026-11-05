# RUST UP Supporter badge: ONE COMMAND, exact current bot staging, NO PAYMENT.
# Tests isolated badge delivery/replay/refund with SQLite, private bot recovery,
# compile and Cloudflare --dry-run. NEVER deploys live code or toggles gates.
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $repo
if(!(Test-Path '.git')){throw 'Expected RUST-UP-Local repository not found'}
$branch=(git branch --show-current)
if($LASTEXITCODE -ne 0 -or $branch.Trim() -ne 'feature/rustup-payment-admin-controls'){
 throw 'Run on feature/rustup-payment-admin-controls'
}
function Check([string]$name,[scriptblock]$action){
 Write-Host ("["+$name+"]") -ForegroundColor Cyan
 $global:LASTEXITCODE=0
 & $action
 if($LASTEXITCODE -ne 0){throw "$name failed (exit $LASTEXITCODE)"}
}
Check 'Pull latest reviewed badge implementation'{
 git pull --ff-only origin feature/rustup-payment-admin-controls
}
Check 'SQLite paid/replayed/refunded badge and signed Mini App tests'{
 node --test '.\payments\integration\telegram-stars\supporter-badge.test.mjs' '.\payments\frontend\telegram-miniapp\stars-supporter-ui.test.mjs'
}
Check 'Telegram test-only invoice and refund regressions'{
 node --test '.\payments\scripts\telegram-stars-test-env.test.mjs'
}
if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
 try{
  $raw=& npx --yes wrangler auth token --json 2>$null
  if($LASTEXITCODE -ne 0){throw 'No Wrangler auth'}
  $auth=($raw|Out-String|ConvertFrom-Json)
  if($auth.type -notin @('oauth','api_token') -or
     [string]::IsNullOrWhiteSpace([string]$auth.token)){
   throw 'Invalid Wrangler auth'
  }
  $env:CLOUDFLARE_API_TOKEN=[string]$auth.token
  Write-Host 'PASS: Existing Wrangler credential available privately.' -ForegroundColor Green
 }catch{throw 'Run npx wrangler login, then try again. Do not share credentials.'}
 finally{$raw=$null;$auth=$null}
}
Write-Host '[Recover exact current 18-module production bot privately]' -ForegroundColor Cyan
$global:LASTEXITCODE=0
$log=@(node '.\payments\scripts\recover-current-stars-variable.mjs' 2>&1)
if($LASTEXITCODE -ne 0){
 $log|ForEach-Object{Write-Host $_}
 throw 'Private source recovery failed'
}
$match=$log|Select-String -Pattern '^Location:\s*(.+)$'|Select-Object -Last 1
if(!$match){throw 'Private worker source folder missing'}
$dir=$match.Matches[0].Groups[1].Value.Trim()
if(!(Test-Path -LiteralPath $dir)){throw 'Worker recovery was not saved'}
Check 'Stage unchanged worker and all payment flags OFF'{
 node '.\payments\scripts\stage-current-variable-stars.mjs' "$dir"
}
Check 'Apply only supporter badge source into PRIVATE stage'{
 node '.\payments\scripts\stage-supporter-badge.mjs' "$dir" --stage
}
$entry=Join-Path $dir 'worker.stars-variable-entry.mjs'
$bundle=Join-Path $dir 'worker.stars-variable.bundle.js'
$config=Join-Path $dir 'wrangler.stars-variable.toml'
Check 'Build complete existing game bot plus supporter fulfillment module'{
 npx --yes esbuild "$entry" --bundle --platform=browser --format=esm --target=es2022 --sourcemap=linked "--outfile=$bundle"
}
Check 'Compiled Worker syntax'{
 node --check "$bundle"
}
Check 'Re-verify exact live bot and supporter stage without changes'{
 node '.\payments\scripts\stage-supporter-badge.mjs' "$dir" --check
}
Check 'Cloudflare dry-run, NO deployment and all payment gates OFF'{
 npx --yes wrangler deploy --dry-run --config "$config"
}
Write-Host 'PASS: Full supporter badge backend staged and checked. NOT DEPLOYED.' -ForegroundColor Green
Write-Host 'Telegram test user and operator Stars price still needed for paid E2E.'
