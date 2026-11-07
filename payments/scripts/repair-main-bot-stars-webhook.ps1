# Fix Telegram pre_checkout_query delivery for RUST UP production bot.
# The original message/callback subscriptions remain enabled.
# Rotates WEBHOOK_SECRET in Cloudflare and Telegram together.
# Never prints Telegram or webhook secrets.
$ErrorActionPreference='Stop'
$account='af72e32cb9f1ba99dba07df30fe540fe'
$worker='rustup-bot'
$expectedUrl='https://rustup-bot.ttzoomrust.workers.dev/tg'
$cloudBase='https://api.cloudflare.com/client/v4/accounts/'+$account+'/workers/scripts/'+$worker
$ownedCloudflare=$false
$token=$null
$secretPtr=[IntPtr]::Zero
$raw=$null
$credential=$null
$botToken=$null
$newSecret=$null
$telegramEndpoint=$null
$cloudflareUpdated=$false
$telegramUpdated=$false
try {
 $token=Read-Host 'Token for @rustuper_bot (hidden; never paste into chat)' -AsSecureString
 $secretPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($token)
 $botToken=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr)
 if($botToken -cnotmatch '^[0-9]{5,15}:[A-Za-z0-9_-]{30,}$'){throw 'Invalid Telegram bot token format'}
 $telegramEndpoint='https://api.telegram.org/bot'+$botToken+'/'
 function TelegramPost([string]$method,[object]$data){
  $json=$data | ConvertTo-Json -Depth 8 -Compress
  try {
   $result=Invoke-RestMethod -Method Post -Uri ($script:telegramEndpoint+$method) -Body $json -ContentType 'application/json' -TimeoutSec 25
  }catch{throw ('Telegram API request failed: '+$method+' (token and URL withheld)')}
  if(!$result.ok){throw ('Telegram API rejected: '+$method)}
  return $result.result
 }
 $me=TelegramPost 'getMe' @{}
 if($me.username -cne 'rustuper_bot'){throw 'Token does not belong to @rustuper_bot'}
 $webhook=TelegramPost 'getWebhookInfo' @{}
 if($webhook.url -cne $expectedUrl){throw 'Unexpected Telegram webhook URL; refusing to change another bot endpoint'}
 $priorUpdates=@($webhook.allowed_updates)
 if($priorUpdates.Count -eq 0){throw 'Existing allowed_updates missing; refusing to replace unknown subscription list'}
 $updated=@($priorUpdates + @('pre_checkout_query') | Select-Object -Unique)
 if($priorUpdates -contains 'pre_checkout_query'){
  Write-Host 'Telegram already allows pre_checkout_query; no secret rotation needed.' -ForegroundColor Green
  return
 }
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $raw=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Run npx wrangler login first'}
  $credential=$raw|Out-String|ConvertFrom-Json
  if([string]::IsNullOrWhiteSpace([string]$credential.token)){throw 'Wrangler Cloudflare API token unavailable'}
  $env:CLOUDFLARE_API_TOKEN=[string]$credential.token
  $ownedCloudflare=$true
 }
 $headers=@{Authorization='Bearer '+$env:CLOUDFLARE_API_TOKEN}
 try{
  $settings=Invoke-RestMethod -Method Get -Uri ($cloudBase+'/settings') -Headers $headers -TimeoutSec 25
 }catch{throw 'Cloudflare Worker settings preflight failed'}
 if(!$settings.success){throw 'Cloudflare Worker settings unavailable'}
 $binding=@($settings.result.bindings | Where-Object {$_.name -eq 'WEBHOOK_SECRET'})
 if($binding.Count -ne 1 -or $binding[0].type -ne 'secret_text'){
  throw 'Cloudflare WEBHOOK_SECRET binding missing or wrong type'
 }
 $botBinding=@($settings.result.bindings | Where-Object {$_.name -eq 'BOT_TOKEN'})
 if($botBinding.Count -ne 1 -or $botBinding[0].type -ne 'secret_text'){throw 'Cloudflare BOT_TOKEN binding invalid'}
 $rand=New-Object byte[] 36
 $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
 try{$rng.GetBytes($rand)}finally{$rng.Dispose()}
 $newSecret=[Convert]::ToBase64String($rand).TrimEnd('=').Replace('+','-').Replace('/','_')
 if($newSecret -cnotmatch '^[A-Za-z0-9_-]{32,256}$'){throw 'Generated webhook secret validation failed'}
 Write-Host 'Updating Cloudflare webhook verification and enabling Telegram pre_checkout_query...' -ForegroundColor Cyan
 # Cloudflare first. Telegram retries transient webhook 503 responses while we rotate.
 try {
  $body=@{name='WEBHOOK_SECRET';type='secret_text';text=$newSecret} | ConvertTo-Json -Compress
  $cloudResult=Invoke-RestMethod -Method Put -Uri ($cloudBase+'/secrets') -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 25
 }catch{throw 'Cloudflare WEBHOOK_SECRET update failed; Telegram unchanged'}
 if(!$cloudResult.success){throw 'Cloudflare rejected WEBHOOK_SECRET update; Telegram unchanged'}
 $cloudflareUpdated=$true
 # Preserve all prior update subscriptions and do not drop pending updates.
 $request=@{
  url=$expectedUrl
  allowed_updates=$updated
  drop_pending_updates=$false
  max_connections=40
  secret_token=$newSecret
 }
 # Retry same idempotent Telegram configuration if network fails.
 for($attempt=1;$attempt -le 3 -and !$telegramUpdated;$attempt++){
  try {
   $ok=TelegramPost 'setWebhook' $request
   if($ok -eq $true){$telegramUpdated=$true}
  }catch{
   if($attempt -eq 3){Write-Warning 'Telegram setWebhook could not be confirmed. Do NOT retry purchases; rerun this repair with operator review.'}
  }
 }
 if(!$telegramUpdated){throw 'WEBHOOK PARTIAL ROTATION: Cloudflare secret changed; Telegram change not confirmed. Bot may return 503.'}
 $verified=TelegramPost 'getWebhookInfo' @{}
 if($verified.url -cne $expectedUrl -or @($verified.allowed_updates) -notcontains 'pre_checkout_query'){
  throw 'Telegram webhook verification failed; do not attempt a new payment'
 }
 Write-Host 'SUCCESS: webhook configured for message, callback_query, and pre_checkout_query.' -ForegroundColor Green
 [pscustomobject]@{
  bot=$me.username
  webhookHost=([Uri]$verified.url).Host
  webhookPath=([Uri]$verified.url).AbsolutePath
  allowedUpdates=($verified.allowed_updates -join ',')
  pendingUpdates=$verified.pending_update_count
  previousLastError=$webhook.last_error_message
  telegramSecretRotationConfirmed=$true
 } | Format-List
}finally{
 if($secretPtr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr)}
 if($ownedCloudflare){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $botToken=$null
 $newSecret=$null
 $token=$null
 $raw=$null
 $credential=$null
}
