// This scanner is isolated from the original single-project payment system.
// Every candidate must pass chain verification and tenant-isolated settlement.
import {ASSETS,ERC20_TRANSFER_TOPIC,evm} from '../assets.js';
import {verifyChainPayment} from '../chains.js';
import {settleV2,expireV2} from './settlement.js';

const at=s=>new Date(s).toISOString();
const hex=x=>'0x'+BigInt(x).toString(16);
const norm=x=>String(x||'').toLowerCase();
async function rpc(url,method,params,auth=''){
 if(!url||!/^https:\/\//i.test(url))throw Error('https_rpc_required');
 const headers={'content-type':'application/json'};
 if(auth)headers.authorization='Basic '+auth;
 const response=await fetch(url,{method:'POST',headers,
  body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),
  signal:AbortSignal.timeout(13000)});
 if(!response.ok)throw Error('rpc_http_failure');
 const obj=await response.json();
 if(obj.error)throw Error('rpc_rejected');
 return obj.result;
}
async function scanCursor(db,key){
 const row=await db.prepare('SELECT cursor_value FROM payment_scan_cursors WHERE scanner=?').bind('v2:'+key).first();
 return row?.cursor_value||null;
}
async function advance(db,key,cursor){
 await db.prepare(`INSERT INTO payment_scan_cursors(scanner,cursor_value,updated_at_ms)
  VALUES(?,?,?) ON CONFLICT(scanner) DO UPDATE SET
  cursor_value=excluded.cursor_value,updated_at_ms=excluded.updated_at_ms`)
  .bind('v2:'+key,String(cursor),Date.now()).run();
}
async function activeOrders(db,now){
 const rows=await db.prepare(`SELECT * FROM v2_invoices
  WHERE status IN ('awaiting_payment','expired') AND created_at_ms>?
  ORDER BY created_at_ms LIMIT 5001`).bind(now-7*86400000).all();
 if(rows.results?.length>5000)throw Error('too_many_unsettled_invoices_requires_sharding');
 return rows.results||[];
}
function record(map,key,order){
 const list=map.get(key)||[];list.push(order);map.set(key,list);
}
async function trySettle(db,order,hash,env,counter){
 try{
  const proof=await verifyChainPayment(order,hash,env);
  const result=await settleV2(db,order,proof);
  if(result.status==='verified')counter.verified++;
  else if(result.status==='manual_review')counter.review++;
 }catch(e){
  const expected=new Set(['recipient_or_amount_mismatch','insufficient_confirmations',
   'unconfirmed_or_failed','payment_predates_order','transaction_not_found',
   'underpaid_or_wrong_recipient']);
  if(expected.has(e.message)){counter.ignored++;return;}
  // Network failure or inconsistent RPC data: do NOT advance a scan cursor.
  throw e;
 }
}
async function scanEthereum(db,orders,env,counter){
 const eth=orders.filter(x=>x.chain==='ethereum');
 if(!eth.length)return;
 const url=env.ETHEREUM_RPC_URL;
 if(!url)throw Error('ethereum_rpc_not_configured');
 const [chainId,headHex]=await Promise.all([
  rpc(url,'eth_chainId',[]),rpc(url,'eth_blockNumber',[])
 ]);
 if(BigInt(chainId)!==1n)throw Error('ethereum_mainnet_required');
 const head=Number(BigInt(headHex));
 const safeHead=head-11; // 12 confirmations: do not scan unfinalized blocks.
 const cursor=await scanCursor(db,'ethereum');
 const from=cursor===null?Number(env.ETHEREUM_START_BLOCK):Number(cursor)+1;
 if(!Number.isSafeInteger(from)||from<1)throw Error('ethereum_start_block_required');
 if(from>safeHead)return;
 const to=Math.min(from+19,safeHead);
 const native=new Map(),tokens=new Map();
 for(const intent of eth){
  const key=norm(intent.receive_address);
  record(intent.asset==='ETH'?native:tokens,key,intent);
 }
 const candidates=new Map();
 function candidate(intent,hash){
  if(typeof hash==='string'&&hash.length===66)
   candidates.set(intent.id+':'+hash,{intent,hash});
 }
 if(native.size){
  for(let h=from;h<=to;h++){
   const block=await rpc(url,'eth_getBlockByNumber',[hex(h),true]);
   if(!block||Number(BigInt(block.number))!==h)throw Error('ethereum_inconsistent_block');
   for(const tx of block.transactions||[]){
    for(const order of native.get(norm(tx.to))||[]){
     if(BigInt(tx.value||'0x0')>=BigInt(order.amount_atomic))candidate(order,tx.hash);
    }
   }
  }
 }
 if(tokens.size){
  if(!env.USDT_ERC20_CONTRACT)throw Error('token_contract_not_configured');
  const destinations=[...tokens.keys()];
  for(let k=0;k<destinations.length;k+=20){
   const selected=destinations.slice(k,k+20);
   const padded=selected.map(x=>'0x'+'0'.repeat(24)+x.slice(2));
   const logs=await rpc(url,'eth_getLogs',[{
    fromBlock:hex(from),toBlock:hex(to),
    address:evm(env.USDT_ERC20_CONTRACT),
    topics:[ERC20_TRANSFER_TOPIC,null,padded]
   }]);
   if(!Array.isArray(logs))throw Error('invalid_contract_logs');
   for(const entry of logs){
    const addr='0x'+String(entry.topics?.[2]||'').slice(-40).toLowerCase();
    for(const order of tokens.get(addr)||[]){
     if(BigInt(entry.data||'0x0')>=BigInt(order.amount_atomic))
      candidate(order,entry.transactionHash);
    }
   }
  }
 }
 for(const {intent,hash} of candidates.values())
  await trySettle(db,intent,norm(hash),env,counter);
 await advance(db,'ethereum',to);
 counter.scannedEthereumBlocks+=to-from+1;
}
async function scanBitcoin(db,orders,env,counter){
 const btc=orders.filter(x=>x.asset==='BTC');
 if(!btc.length)return;
 if(!env.BITCOIN_RPC_URL)throw Error('bitcoin_rpc_not_configured');
 const cursor=await scanCursor(db,'bitcoin');
 if(!cursor&&!env.BITCOIN_START_BLOCKHASH)throw Error('bitcoin_initial_blockhash_required');
 const params=[cursor||env.BITCOIN_START_BLOCKHASH,6,true,true];
 const r=await rpc(env.BITCOIN_RPC_URL,'listsinceblock',params,env.BITCOIN_RPC_BASIC_B64||'');
 if(!r||!Array.isArray(r.transactions)||!r.lastblock)throw Error('invalid_bitcoin_rpc_response');
 if((r.removed||[]).some(tx=>tx.confirmations<0)){
  // Reorganization requires operator review; never automatically reverse credits.
  throw Error('bitcoin_reorganization_manual_review');
 }
 const byAddr=new Map();for(const order of btc)record(byAddr,order.receive_address,order);
 const candidates=new Map();
 for(const tx of r.transactions){
  if(tx.category!=='receive'||tx.confirmations<ASSETS.BTC.confirmations)continue;
  for(const order of byAddr.get(tx.address)||[]){
   if(/^[a-fA-F0-9]{64}$/.test(String(tx.txid||'')))
    candidates.set(order.id+':'+tx.txid,{order,hash:tx.txid});
  }
 }
 for(const {order,hash} of candidates.values())await trySettle(db,order,norm(hash),env,counter);
 await advance(db,'bitcoin',r.lastblock);
 counter.scannedBitcoinTransactions+=r.transactions.length;
}
async function tronGrid(url,pathname,key){
 if(typeof url!=='string'||!/^https:\/\//i.test(url))throw Error('https_tron_indexer_required');
 const res=await fetch(url.replace(/\/$/,'')+pathname,{
  headers:{...(key?{'TRON-PRO-API-KEY':key}:{})},
  signal:AbortSignal.timeout(12000)});
 if(!res.ok)throw Error('tron_indexer_unavailable');
 const body=await res.json();
 if(!body.success||!Array.isArray(body.data))throw Error('tron_indexer_invalid_response');
 return body;
}
async function scanTron(db,orders,env,counter){
 const tron=orders.filter(x=>x.chain==='tron');
 if(!tron.length)return;
 if(!env.TRON_RPC_URL||!env.TRON_INDEXER_URL)throw Error('tron_nodes_not_configured');
 // A bounded round-robin cursor avoids starving one address on every invocation.
 const offset=Number((await scanCursor(db,'tron_order_offset'))||'0')%tron.length;
 const rotated=tron.slice(offset).concat(tron.slice(0,offset));
 const batch=rotated.slice(0,Math.min(10,tron.length));
 for(const order of batch){
  const path=order.asset==='TRX'?'transactions':'transactions/trc20';
  const query=new URLSearchParams({
   only_confirmed:'true',only_to:'true',limit:'200',
   min_timestamp:String(Math.max(0,order.created_at_ms-300000)),
   order_by:'block_timestamp,desc'
  });
  if(order.asset==='USDT_TRC20'){
   if(!env.USDT_TRC20_CONTRACT)throw Error('trc20_contract_not_configured');
   query.set('contract_address',env.USDT_TRC20_CONTRACT);
  }
  const root='/v1/accounts/'+encodeURIComponent(order.receive_address)+'/'+path;
  let next='',pages=0;
  do{
   const u=root+'?'+query.toString()+(next?'&fingerprint='+encodeURIComponent(next):'');
   const data=await tronGrid(env.TRON_INDEXER_URL,u,env.TRON_RPC_API_KEY);
   for(const t of data.data){
    const hash=order.asset==='TRX'?t.txID:t.transaction_id;
    if(!/^[a-fA-F0-9]{64}$/.test(String(hash||'')))continue;
    if(order.asset==='USDT_TRC20'&&
       norm(t.to)!==norm(order.receive_address))continue;
    await trySettle(db,order,norm(hash),env,counter);
    counter.scannedTronTransactions++;
   }
   next=data.meta?.fingerprint||'';
   pages++;
  }while(next&&pages<4);
  if(next)throw Error('tron_scan_pagination_limit');
 }
 await advance(db,'tron_order_offset',offset+batch.length);
}
export async function scanMultiPayments(env) {
 if(!env.DB||env.MULTI_AUTO_SCAN_ENABLED!=='true')
  return {skipped:true,reason:'disabled'};
 const db=env.DB,now=Date.now();
 await expireV2(db,now);
 const orders=await activeOrders(db,now);
 const results={orders:orders.length,verified:0,review:0,ignored:0,
  scannedEthereumBlocks:0,scannedBitcoinTransactions:0,scannedTronTransactions:0,errors:[]};
 // One chain failing never blocks other chains, but failed cursors don't advance.
 for(const [name,func] of [
  ['ethereum',scanEthereum],['bitcoin',scanBitcoin],['tron',scanTron]
 ]){
  try{await func(db,orders,env,results)}
  catch(e){results.errors.push(name+':'+String(e.message).slice(0,100))}
 }
 return results;
}
