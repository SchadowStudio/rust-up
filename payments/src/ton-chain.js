// TON native Toncoin payment verification via TON Center v3-compatible
// independent archive/indexed APIs. NO jetton and NO TRON/TRX confusion.
// Finality requires an indexed masterchain inclusion, a matching mainnet
// shard block and independently observed latest masterchain head.
import {tonRawAddress,tonHashHex} from './ton.js';
function safeUrl(value){
 let u;
 try{u=new URL(value)}catch{throw Error('ton_indexer_url_not_configured')}
 if(u.protocol!=='https:'||u.username||u.password||u.hash||
    !u.hostname.includes('.'))throw Error('ton_indexer_https_required');
 return u;
}
export async function tonIndexerGet(env,resource,params={}){
 const origin=safeUrl(env.TON_INDEXER_URL);
 const prefix=origin.pathname.replace(/\/$/,'').endsWith('/api/v3')
  ?origin.pathname.replace(/\/$/,''):'/api/v3';
 origin.pathname=prefix+'/'+resource;
 origin.search='';
 for(const [key,value] of Object.entries(params))
  origin.searchParams.set(key,String(value));
 const headers={'accept':'application/json'};
 if(env.TON_INDEXER_API_KEY)headers['X-API-Key']=env.TON_INDEXER_API_KEY;
 const resp=await fetch(origin.toString(),{
  headers,redirect:'error',cache:'no-store',
  signal:AbortSignal.timeout(12000)
 });
 if(!resp.ok)throw Error('ton_indexer_unavailable');
 const result=await resp.json();
 if(!result||typeof result!=='object'||Array.isArray(result))
  throw Error('ton_invalid_indexer_result');
 return result;
}
function addrSafe(address){
 try{return tonRawAddress(address)}
 catch{return null}
}
function blockRefMatches(tx,block){
 const ref=tx.block_ref;
 return ref&&ref.workchain===0&&Number.isSafeInteger(ref.seqno)&&ref.seqno>0&&
  String(ref.shard||'')===String(block.shard||'')&&
  block.workchain===0&&block.seqno===ref.seqno&&block.global_id===-239;
}
export async function verifyTonPayment(order,hash,env){
 if(order.asset!=='TON'||order.chain!=='ton')
  throw Error('wrong_ton_chain');
 if(env.MULTI_TON_ENABLED!=='true')throw Error('ton_not_enabled');
 const normalized=tonHashHex(hash);
 const recipient=tonRawAddress(order.receive_address);
 const data=await tonIndexerGet(env,'transactions',{
  account:recipient,hash:normalized,limit:2
 });
 if(!Array.isArray(data.transactions)||data.transactions.length!==1)
  throw Error('ton_transaction_not_found');
 const tx=data.transactions[0],received=tx?.in_msg?.value;
 if(tonHashHex(tx?.hash||'')!==normalized||
    addrSafe(tx.account)!==recipient||
    addrSafe(tx.in_msg?.destination)!==recipient||
    tx.in_msg?.bounced===true||tx.emulated===true||
    tx.description?.aborted===true||
    !/^[0-9]{1,60}$/.test(String(received||'')))
  throw Error('ton_payment_invalid');
 if(BigInt(received)<BigInt(order.amount_atomic))
  throw Error('recipient_or_amount_mismatch');
 if(!Number.isSafeInteger(tx.now)||tx.now<1500000000||
    !Number.isSafeInteger(tx.mc_block_seqno)||tx.mc_block_seqno<1||
    !tx.block_ref||tx.block_ref.workchain!==0||
    !Number.isSafeInteger(tx.block_ref.seqno)||tx.block_ref.seqno<1)
  throw Error('ton_not_masterchain_finalized');
 const [blocks,head]=await Promise.all([
  tonIndexerGet(env,'blocks',{
   workchain:0,shard:tx.block_ref.shard,
   seqno:tx.block_ref.seqno,limit:2
  }),
  tonIndexerGet(env,'masterchainInfo')
 ]);
 const block=blocks.blocks?.[0],root=block?.root_hash;
 if(!Array.isArray(blocks.blocks)||blocks.blocks.length!==1||
    !blockRefMatches(tx,block)||
    !Number.isSafeInteger(head?.last?.seqno)||
    head.last.seqno<tx.mc_block_seqno||
    head.last.global_id!==-239)
  throw Error('ton_finality_block_mismatch');
 const blockHash=tonHashHex(root);
 const time=tx.now*1000;
 if(!Number.isSafeInteger(time))throw Error('invalid_block_timestamp');
 return {actualAtomic:String(received),paymentTimeMs:time,
  confirmations:1,blockHash};
}
