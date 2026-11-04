// Config-level gates only. A green configuration check is NOT a substitute for
// live receipt verification, wallet ownership proofs, backups and load testing.
import {validateIndependentRpcs} from './quorum.js';
import {PINNED_MAINNET_CONTRACTS} from '../asset-registry.js';
function hasRpcQuorum(env,chain){
 try{validateIndependentRpcs(env,chain);return true;}
 catch{return false;}
}
export function readinessV2(env){
 const checks={
  database:!!env.DB,
  strictQuorumEnabled:env.MULTI_STRICT_QUORUM==='true',
  ethereumQuorum:hasRpcQuorum(env,'ethereum'),
  bitcoinQuorum:hasRpcQuorum(env,'bitcoin'),
  tronQuorum:hasRpcQuorum(env,'tron'),
  operatorKey:typeof env.MULTI_ADMIN_KEY==='string'&&env.MULTI_ADMIN_KEY.length>=48,
  operatorApproval:env.MULTI_OPERATOR_APPROVED==='true',
  acceptingDeposits:env.MULTI_LIVE_ENABLED==='true',
  reconciliation:env.MULTI_AUTO_SCAN_ENABLED==='true',
  postSettlementAudit:env.MULTI_RECONCILE_ENABLED==='true',
  webhookDelivery:env.MULTI_DELIVERY_ENABLED==='true',
  webhookMasterSecret:typeof env.MULTI_WEBHOOK_MASTER_KEY==='string'&&env.MULTI_WEBHOOK_MASTER_KEY.length>=40,
  ethereumRpc:/^https:\/\//i.test(String(env.ETHEREUM_RPC_URL||'')),
  tronRpc:/^https:\/\//i.test(String(env.TRON_RPC_URL||'')),
  tronIndexer:/^https:\/\//i.test(String(env.TRON_INDEXER_URL||'')),
  bitcoinRpc:/^https:\/\//i.test(String(env.BITCOIN_RPC_URL||'')),
  bitcoinAuth:typeof env.BITCOIN_RPC_BASIC_B64==='string'&&env.BITCOIN_RPC_BASIC_B64.length>16,
  bitcoinSecondaryAuth:typeof env.BITCOIN_RPC_BASIC_B64_SECONDARY==='string'&&
   env.BITCOIN_RPC_BASIC_B64_SECONDARY.length>16,
  bitcoinTertiaryAuth:typeof env.BITCOIN_RPC_BASIC_B64_TERTIARY==='string'&&
   env.BITCOIN_RPC_BASIC_B64_TERTIARY.length>16,
  bitcoinStart:/^[a-f0-9]{64}$/i.test(String(env.BITCOIN_START_BLOCKHASH||'')),
  ethereumStart:Number.isSafeInteger(Number(env.ETHEREUM_START_BLOCK))&&Number(env.ETHEREUM_START_BLOCK)>0,
  erc20Contract:String(env.USDT_ERC20_CONTRACT||'').toLowerCase()===
   PINNED_MAINNET_CONTRACTS.USDT_ERC20.address.toLowerCase(),
  trc20Contract:String(env.USDT_TRC20_CONTRACT||'')===
   PINNED_MAINNET_CONTRACTS.USDT_TRC20.address,
  approvedWebhookHosts:typeof env.MULTI_WEBHOOK_HOST_ALLOWLIST==='string'&&
    env.MULTI_WEBHOOK_HOST_ALLOWLIST.split(',').some(x=>x.trim().length>5)
 };
 const missing=Object.keys(checks).filter(x=>!checks[x]);
 return {ready:missing.length===0,missing};
}
