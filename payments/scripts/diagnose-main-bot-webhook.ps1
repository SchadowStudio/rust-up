# Read-only Telegram payment webhook diagnosis for the main bot.
$ErrorActionPreference='Stop'
$token=Read-Host 'Token for @rustuper_bot (hidden; do not paste into ChatGPT)' -AsSecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($token)
try {
 $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
 if($plain -notmatch '^[0-9]{5,15}:[A-Za-z0-9_-]{30,}$'){throw 'Invalid Bot API token format'}
 $base='https://api.telegram.org/bot'+$plain
 $me=Invoke-RestMethod -Uri ($base+'/getMe') -Method Post -TimeoutSec 15
 if(!$me.ok -or $me.result.username -ne 'rustuper_bot'){throw 'Token does not belong to @rustuper_bot'}
 $response=Invoke-RestMethod -Uri ($base+'/getWebhookInfo') -Method Post -TimeoutSec 15
 if(!$response.ok){throw 'Telegram did not return webhook information'}
 $w=$response.result
 $uri=$null
 if($w.url){$uri=[Uri]$w.url}
 [pscustomobject]@{
  bot=$me.result.username
  webhookHost=if($uri){$uri.Host}else{'NO_WEBHOOK'}
  webhookPath=if($uri){$uri.AbsolutePath}else{''}
  pendingUpdateCount=$w.pending_update_count
  lastErrorDate=$w.last_error_date
  lastErrorMessage=$w.last_error_message
  lastSyncErrorDate=$w.last_synchronization_error_date
  allowedUpdates=($w.allowed_updates -join ',')
  maxConnections=$w.max_connections
 } | Format-List
}finally{
 if($ptr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
 $plain=$null
 $token=$null
}
