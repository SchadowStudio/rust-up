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
  ethereumRpc:typeof env.ETHEREUM_RPC_URL==='string'&&
   /^https:\/\//i.test(env.ETHEREUM_RPC_URL),
  ethereumStartBlock:Number.isSafeInteger(Number(env.ETHEREUM_START_BLOCK))&&
   Number(env.ETHEREUM_START_BLOCK)>0,
  bitcoinRpc:typeof env.BITCOIN_RPC_URL==='string'&&
   /^https:\/\//i.test(env.BITCOIN_RPC_URL),
  bitcoinRpcAuth:typeof env.BITCOIN_RPC_BASIC_B64==='string'&&
   env.BITCOIN_RPC_BASIC_B64.length>16,
  bitcoinStartBlock:/^[0-9a-f]{64}$/i.test(String(env.BITCOIN_START_BLOCKHASH||'')),
  tronRpc:typeof env.TRON_RPC_URL==='string'&&
   /^https:\/\//i.test(env.TRON_RPC_URL),
  tronIndexer:typeof env.TRON_INDEXER_URL==='string'&&
   /^https:\/\//i.test(env.TRON_INDEXER_URL),
  tokenErc20:/^0x[0-9a-f]{40}$/i.test(String(env.USDT_ERC20_CONTRACT||'')),
  tokenTrc20:/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(String(env.USDT_TRC20_CONTRACT||'')),
  allowedCheckoutOrigin:typeof env.ALLOWED_ORIGIN==='string'&&
   /^https:\/\//i.test(env.ALLOWED_ORIGIN),
  allowedOperatorOrigin:typeof env.OPERATOR_ORIGIN==='string'&&
   /^https:\/\//i.test(env.OPERATOR_ORIGIN),
  databaseConfigured:!!env.DB,
  operatorSecret:typeof env.OPERATOR_API_KEY==='string'&&
   env.OPERATOR_API_KEY.length>=40,
  ownerProductionApproval:env.OWNER_APPROVED_PRODUCTION==='true'
 };
 const missing=Object.keys(checks).filter(key=>!checks[key]);
 return {ready:missing.length===0,missing,checks};
}
