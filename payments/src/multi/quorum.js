// Fail-closed N-of-3 blockchain verification for each payment.
// Reading one JSON-RPC node is NEVER enough to approve user funds.
// Three independently-operated RPC endpoints are recommended;
// quorum requires two identical canonical block proofs.
import {verifyChainPayment} from '../chains.js';
import {ASSETS} from '../assets.js';

const GROUPS={
 bitcoin:{url:'BITCOIN_RPC_URL',auth:'BITCOIN_RPC_BASIC_B64'},
 ethereum:{url:'ETHEREUM_RPC_URL'},
 tron:{url:'TRON_RPC_URL',auth:'TRON_RPC_API_KEY'}
};
export function validateIndependentRpcs(env,chain){
 const spec=GROUPS[chain];
 if(!spec)throw Error('unsupported_chain');
 const endpoints=[];
 for(const suffix of ['', '_SECONDARY', '_TERTIARY']){
  const name=spec.url+suffix, raw=env[name];
  let url;
  try{url=new URL(raw);}catch{throw Error('quorum_rpc_missing')}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||
     !url.hostname.includes('.')||url.port&&url.port!=='443')
   throw Error('quorum_rpc_must_use_https');
  endpoints.push({url:url.toString(),suffix,host:url.hostname.toLowerCase()});
 }
 if(new Set(endpoints.map(x=>x.host)).size!==3)
  throw Error('quorum_requires_three_independent_rpc_hosts');
 return endpoints;
}
function cloneEnv(env,chain,suffix){
 const spec=GROUPS[chain],copy={...env,
  [spec.url]:env[spec.url+suffix],
  MULTI_STRICT_QUORUM:'true'};
 if(spec.auth)copy[spec.auth]=env[spec.auth+suffix];
 return copy;
}
function proofEquivalent(a,b){
 return a.txHash===b.txHash &&
  a.blockHash===b.blockHash &&
  typeof a.blockHash==='string'&&a.blockHash.length>=64 &&
  a.actualAtomic===b.actualAtomic &&
  a.paymentTimeMs===b.paymentTimeMs;
}
export async function verifyChainPaymentQuorum(order,hash,env){
 const conf=ASSETS[order?.asset];
 if(!conf||conf.chain!==order.chain)throw Error('wrong_chain');
 const peers=validateIndependentRpcs(env,conf.chain);
 const checks=await Promise.allSettled(peers.map(({suffix})=>
  verifyChainPayment(order,hash,cloneEnv(env,conf.chain,suffix))));
 const valid=checks.filter(x=>x.status==='fulfilled').map(x=>x.value);
 for(let i=0;i<valid.length;i++){
  for(let j=i+1;j<valid.length;j++){
   if(proofEquivalent(valid[i],valid[j])){
    const minimum=Math.min(valid[i].confirmations,valid[j].confirmations);
    if(minimum<conf.confirmations)throw Error('insufficient_confirmations');
    return {...valid[i],confirmations:minimum};
   }
  }
 }
 // An RPC can be down or corrupted. Never accept a lone response.
 throw Error('blockchain_quorum_not_reached');
}
