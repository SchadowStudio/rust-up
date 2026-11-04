import {ASSETS, ERC20_TRANSFER_TOPIC, evm, hexBig, tronHex, txId} from './assets.js';

function rpcUrl(u) {
 if(typeof u!=='string'||(!/^https:\/\//i.test(u)&&!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(u)))
  throw new Error('rpc_url_must_use_https');
 return u;
}
async function jsonRpc(url,method,params,auth='') {
 const headers={'content-type':'application/json'};
 if(auth)headers.authorization='Basic '+auth;
 const res=await fetch(rpcUrl(url),{method:'POST',headers,
  body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),
  signal:AbortSignal.timeout(12000)});
 if(!res.ok)throw new Error('rpc_unavailable');
 const body=await res.json();
 if(body.error)throw new Error('rpc_error');
 if(body.result==null)throw new Error('transaction_not_found');
 return body.result;
}
async function tronRpc(url,path,payload,key) {
 const res=await fetch(rpcUrl(url).replace(/\/$/,'')+path,{
  method:'POST',
  headers:{'content-type':'application/json',...(key?{'TRON-PRO-API-KEY':key}:{})},
  body:JSON.stringify(payload),
  signal:AbortSignal.timeout(12000)
 });
 if(!res.ok)throw new Error('rpc_unavailable');
 return res.json();
}
function mustMatch(actual,order) {
 if(BigInt(actual)<BigInt(order.amount_atomic))throw new Error('recipient_or_amount_mismatch');
}
async function ethVerify(order,hash,env) {
 const url=env.ETHEREUM_RPC_URL;
 const [chain,tx,receipt,head]=await Promise.all([
  jsonRpc(url,'eth_chainId',[]),
  jsonRpc(url,'eth_getTransactionByHash',[hash]),
  jsonRpc(url,'eth_getTransactionReceipt',[hash]),
  jsonRpc(url,'eth_blockNumber',[])
 ]);
 if(BigInt(chain)!==1n)throw new Error('wrong_ethereum_chain');
 if(tx.hash?.toLowerCase()!==hash||receipt.transactionHash?.toLowerCase()!==hash||
    receipt.status!=='0x1'||!receipt.blockNumber||!tx.blockNumber)
  throw new Error('unconfirmed_or_failed');
 if(tx.blockNumber.toLowerCase()!==receipt.blockNumber.toLowerCase())
  throw new Error('inconsistent_block');
 const confirmations=BigInt(head)-BigInt(receipt.blockNumber)+1n;
 if(confirmations<BigInt(ASSETS[order.asset].confirmations))
  throw new Error('insufficient_confirmations');
 let received=0n;
 if(order.asset==='ETH'){
  if(evm(tx.to)===evm(order.receive_address))received=hexBig(tx.value);
 } else {
  if(!env.USDT_ERC20_CONTRACT)throw new Error('missing_contract');
  const token=evm(env.USDT_ERC20_CONTRACT);
  for(const log of receipt.logs||[]){
   if(String(log.address).toLowerCase()!==token||
      String(log.topics?.[0]).toLowerCase()!==ERC20_TRANSFER_TOPIC||
      (log.topics||[]).length!==3||
      String(log.topics[2]).slice(-40).toLowerCase()!==evm(order.receive_address).slice(2))
    continue;
   received+=hexBig(log.data);
  }
 }
 mustMatch(received,order);
 return {confirmations:Number(confirmations),actualAtomic:received.toString()};
}
async function btcVerify(order,hash,env) {
 // Own Bitcoin Core with txindex=1, or an explicitly trusted RPC node.
 const tx=await jsonRpc(env.BITCOIN_RPC_URL,'getrawtransaction',
  [hash,true],env.BITCOIN_RPC_BASIC_B64);
 if(String(tx.txid).toLowerCase()!==hash)throw new Error('transaction_mismatch');
 if(!Number.isSafeInteger(tx.confirmations)||tx.confirmations<ASSETS.BTC.confirmations)
  throw new Error('insufficient_confirmations');
 let satoshis=0n;
 for(const output of tx.vout||[]){
  const destinations=[output.scriptPubKey?.address,...(output.scriptPubKey?.addresses||[])];
  if(!destinations.includes(order.receive_address))continue;
  if(!Number.isFinite(output.value)||output.value<0)throw new Error('rpc_invalid_value');
  const sat=Math.round(output.value*1e8);
  if(!Number.isSafeInteger(sat)||Math.abs(output.value-sat/1e8)>0.000000001)
   throw new Error('rpc_invalid_value');
  satoshis+=BigInt(sat);
 }
 mustMatch(satoshis,order);
 return {confirmations:tx.confirmations,actualAtomic:satoshis.toString()};
}
async function tronVerify(order,hash,env) {
 const url=env.TRON_RPC_URL,key=env.TRON_RPC_API_KEY;
 const [tx,info,head]=await Promise.all([
  tronRpc(url,'/walletsolidity/gettransactionbyid',{value:hash},key),
  tronRpc(url,'/walletsolidity/gettransactioninfobyid',{value:hash},key),
  tronRpc(url,'/walletsolidity/getnowblock',{},key)
 ]);
 if(String(tx.txID).toLowerCase()!==hash||!Number.isSafeInteger(info.blockNumber)||
    info.receipt?.result!=='SUCCESS')throw new Error('unconfirmed_or_failed');
 const newest=head.block_header?.raw_data?.number;
 const confirmations=newest-info.blockNumber+1;
 if(!Number.isSafeInteger(confirmations)||confirmations<ASSETS[order.asset].confirmations)
  throw new Error('insufficient_confirmations');
 const destination=await tronHex(order.receive_address);
 let received=0n;
 if(order.asset==='TRX'){
  for(const contract of tx.raw_data?.contract||[]){
   if(contract.type!=='TransferContract')continue;
   const t=contract.parameter?.value;
   if(String(t?.to_address).toLowerCase()!==destination)continue;
   if(!Number.isSafeInteger(t.amount)||t.amount<0)throw new Error('rpc_invalid_value');
   received+=BigInt(t.amount);
  }
 } else {
  if(!env.USDT_TRC20_CONTRACT)throw new Error('missing_contract');
  const token=(await tronHex(env.USDT_TRC20_CONTRACT)).slice(2);
  for(const log of info.log||[]){
   const contract=String(log.address||'').toLowerCase().replace(/^41/,'');
   if(contract!==token||
      String(log.topics?.[0]).toLowerCase()!==ERC20_TRANSFER_TOPIC.slice(2)||
      (log.topics||[]).length!==3||
      String(log.topics[2]).toLowerCase().slice(-40)!==destination.slice(2))
    continue;
   if(!/^[0-9a-f]+$/i.test(String(log.data)))throw new Error('rpc_invalid_value');
   received+=BigInt('0x'+log.data);
  }
 }
 mustMatch(received,order);
 return {confirmations,actualAtomic:received.toString()};
}
export async function verifyChainPayment(order,submittedHash,env) {
 const conf=ASSETS[order.asset];
 if(!conf||conf.chain!==order.chain)throw new Error('wrong_chain');
 const hash=txId(order.asset,submittedHash);
 const result=conf.chain==='ethereum'
  ?await ethVerify(order,hash,env)
  :conf.chain==='bitcoin'
   ?await btcVerify(order,hash,env)
   :await tronVerify(order,hash,env);
 return {...result,txHash:hash};
}
