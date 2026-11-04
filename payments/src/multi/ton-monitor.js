// TON mainnet: bounded, round-robin indexed transaction discovery.
// Untrusted indexer results are merely hints. Every candidate is reverified
// by a 2-of-3 independent masterchain-finality quorum before settlement.
import {tonHashHex,tonRawAddress} from '../ton.js';
import {tonIndexerGet} from '../ton-chain.js';

// Discovery is not settlement proof. A failed primary indexer must not stop
// the scanner when a separately configured backup can provide candidate hints.
// Every hint still passes the independent chain-proof quorum in trySettle.
export async function discoverTonPage(env,params){
 const suffixes=['','_SECONDARY','_TERTIARY'];
 const seen=new Set();
 let lastError=Error('ton_discovery_indexers_unavailable');
 for(const suffix of suffixes){
  const url=env['TON_INDEXER_URL'+suffix];
  if(typeof url!=='string'||!url||seen.has(url))continue;
  seen.add(url);
  try{
   const data=await tonIndexerGet({
    ...env,TON_INDEXER_URL:url,
    TON_INDEXER_API_KEY:env['TON_INDEXER_API_KEY'+suffix]||''
   },'transactions',params);
   if(!Array.isArray(data.transactions)||data.transactions.length>100)
    throw Error('ton_indexer_invalid_transactions');
   return data;
  }catch(error){lastError=error;}
 }
 throw Error('ton_discovery_indexers_unavailable',{cause:lastError});
}

export async function scanTonPayments(db,orders,env,counter,helpers){
 if(env.MULTI_TON_ENABLED!=='true')return;
 const ton=orders.filter(x=>x.asset==='TON'&&x.chain==='ton');
 if(!ton.length)return;
 const {scanCursor,advance,trySettle}=helpers;
 if(!env.TON_INDEXER_URL)throw Error('ton_indexer_not_configured');
 const previous=await scanCursor(db,'ton_order_offset');
 const offset=Number(previous||'0')%ton.length;
 const selection=ton.slice(offset).concat(ton.slice(0,offset))
  .slice(0,Math.min(10,ton.length));
 for(const order of selection){
  const raw=tonRawAddress(order.receive_address);
  const start=Math.floor(Math.max(0,order.created_at_ms-300000)/1000);
  let offsetPage=0;
  const known=new Set();
  for(let page=0;page<5;page++){
   const result=await discoverTonPage(env,{
    account:raw,start_utime:start,sort:'desc',limit:100,
    offset:offsetPage
   });
   for(const tx of result.transactions){
    if(tx?.emulated===true||!Number.isSafeInteger(tx.mc_block_seqno)||
       tx.mc_block_seqno<1||tx.in_msg?.bounced===true||
       tx.description?.aborted===true)
     continue;
    let hash;
    try{
     if(tonRawAddress(tx.account)!==raw||
        tonRawAddress(tx.in_msg?.destination)!==raw||
        !/^[1-9][0-9]{0,59}$/.test(String(tx.in_msg?.value||'')))
      continue;
     hash=tonHashHex(tx.hash);
    }catch{continue}
    if(known.has(hash))continue;
    known.add(hash);
    await trySettle(db,order,hash,env,counter);
    counter.scannedTonTransactions=(counter.scannedTonTransactions||0)+1;
   }
   if(result.transactions.length<100)break;
   offsetPage+=100;
   if(page===4)throw Error('ton_scan_pagination_limit');
  }
 }
 await advance(db,'ton_order_offset',offset+selection.length);
}
