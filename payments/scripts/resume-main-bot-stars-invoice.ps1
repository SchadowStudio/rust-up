# Recover exactly the existing pending 1-Star Telegram invoice.
# Read-only. Does NOT create a second order or call Telegram checkout.
$ErrorActionPreference='Stop'
$account='af72e32cb9f1ba99dba07df30fe540fe'
$db='06079270-a227-466a-9991-abd4201ec5f6'
$ownedToken=$false
try {
 if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)){
  $raw=@(npx --yes wrangler auth token --json 2>$null)
  if($LASTEXITCODE -ne 0){throw 'Run npx wrangler login first'}
  $credentials=$raw|Out-String|ConvertFrom-Json
  if([string]::IsNullOrWhiteSpace([string]$credentials.token)){throw 'Wrangler auth token not available'}
  $env:CLOUDFLARE_API_TOKEN=[string]$credentials.token
  $ownedToken=$true
 }
 $url='https://api.cloudflare.com/client/v4/accounts/'+$account+'/d1/database/'+$db+'/query'
 $sql='SELECT id,telegram_user_id,price_stars,requested_amount_minor,status,invoice_url,expires_at_ms,telegram_charge_id FROM rustup_stars_variable_orders WHERE telegram_user_id=7390606911 ORDER BY created_at_ms DESC LIMIT 3'
 $headers=@{Authorization='Bearer '+$env:CLOUDFLARE_API_TOKEN}
 $body=@{sql=$sql}|ConvertTo-Json -Compress
 try{$response=Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 25}
 catch{throw 'Cannot read Cloudflare payment database'}
 if(!$response.success){throw 'Payment database response failed'}
 $rows=@($response.result[0].results)
 if($rows.Count -ne 1){throw 'Expected exactly one pilot order. Inspect orders manually.'}
 $row=$rows[0]
 if($row.status -ne 'pending' -or $row.telegram_user_id -ne 7390606911 -or $row.price_stars -ne 1 -or $row.requested_amount_minor -ne 183 -or $row.telegram_charge_id){
  throw 'Current order is not the unpaid 1-Star pilot. Do not reopen payment.'
 }
 if([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge [long]$row.expires_at_ms){
  throw 'Invoice expired; do not reuse it or place another payment.'
 }
 $invoice=[string]$row.invoice_url
 if($invoice -cnotmatch '^https://t[.]me/[$][A-Za-z0-9_-]{8,256}$'){throw 'Invalid persisted Telegram invoice URL'}
 Set-Clipboard -Value $invoice
 Write-Host 'Existing pending 1-Star invoice copied to clipboard. NO new order was created.' -ForegroundColor Green
 Write-Host ('Order ID: '+$row.id)
 Write-Host ('Invoice expiry: '+([DateTimeOffset]::FromUnixTimeMilliseconds([long]$row.expires_at_ms).ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss zzz')))
 Write-Host 'Paste the copied link into your own Telegram Saved Messages, then open it once.'
}finally{
 if($ownedToken){Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue}
 $credentials=$null
 $raw=$null
 $invoice=$null
}
