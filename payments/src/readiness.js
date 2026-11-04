// Explicit operational gate: no real customer checkout until a game ledger
// is configured and an independent owner has approved production readiness.
export function readiness(env){
 const checks={
  acceptPaymentsFlag:env.CRYPTO_PAYMENTS_ENABLED==='true',
  autoScannerFlag:env.CRYPTO_AUTO_SCAN_ENABLED==='true',
  gameLedgerFlag:env.GAME_LEDGER_DELIVERY_ENABLED==='true',
  signedLedgerConsumer:typeof env.GAME_LEDGER_SIGNING_KEY==='string'&&
   env.GAME_LEDGER_SIGNING_KEY.length>=32,
  gameLedgerWebhook:typeof env.GAME_LEDGER_WEBHOOK_URL==='string'&&
   /^https:\/\//i.test(env.GAME_LEDGER_WEBHOOK_URL),
  verifiedTelegramBot:typeof env.TG_BOT_TOKEN==='string'&&
   env.TG_BOT_TOKEN.includes(':'),
  databaseConfigured:!!env.DB,
  operatorSecret:typeof env.OPERATOR_API_KEY==='string'&&
   env.OPERATOR_API_KEY.length>=40,
  ownerProductionApproval:env.OWNER_APPROVED_PRODUCTION==='true'
 };
 const missing=Object.keys(checks).filter(key=>!checks[key]);
 return {ready:missing.length===0,missing,checks};
}
