import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {ASSETS,decimalToAtomic,formatAtomic,txId,evm,tronHex,ERC20_TRANSFER_TOPIC} from '../src/assets.js';
import {verifiedTelegramId} from '../src/auth.js';
import {verifyChainPayment} from '../src/chains.js';
globalThis.crypto=webcrypto;
test('five distinct crypto networks and assets',()=>{
 assert.equal(Object.keys(ASSETS).length,5);
 assert.equal(ASSETS.USDT_ERC20.chain,'ethereum');
 assert.equal(ASSETS.USDT_TRC20.chain,'tron');
});
test('atomic amounts never use floating-point money',()=>{
 assert.equal(decimalToAtomic('0.00000001',8),'1');
 assert.equal(decimalToAtomic('12.345678',6),'12345678');
 assert.equal(formatAtomic('12345678',6),'12.345678');
 assert.equal(decimalToAtomic('1.000000000000000001',18),'1000000000000000001');
 for(const x of ['-1','0','1.0000001','1e3','1,1'])assert.throws(()=>decimalToAtomic(x,6));
});
test('hashes must match chain',()=>{
 const h='a'.repeat(64);assert.equal(txId('BTC',h),h);
 assert.equal(txId('ETH','0x'+h),'0x'+h);
 assert.throws(()=>txId('BTC','0x'+h));
 assert.throws(()=>txId('ETH',h));
 assert.equal(evm('0x'+'AB'.repeat(20)),'0x'+'ab'.repeat(20));
});
test('TRON address checksum including real USDT contract',async()=>{
 assert.equal(await tronHex('TR7NHqjeKQxGTCi8q8ZY4pL8otq'),
 '41a614f803b6fd780986a42c78ec9c7f77e6ded13c');
 await assert.rejects(()=>tronHex('TR7NHqjeKQxGTCi8q8ZY4pL8ot1'));
});
const bytes=s=>new TextEncoder().encode(s);
async function mac(key,text){
 const k=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return new Uint8Array(await crypto.subtle.sign('HMAC',k,bytes(text)));
}
test('Telegram HMAC validates owner; replay and forged claims fail',async()=>{
 const token='123:TEST',now=1762300000000,user=JSON.stringify({id:12345});
 const date=String(Math.floor(now/1000));
 const secret=await mac(bytes('WebAppData'),token);
 const digest=await mac(secret,'auth_date='+date+'\nuser='+user);
 const hash=[...digest].map(x=>x.toString(16).padStart(2,'0')).join('');
 const data='auth_date='+date+'&user='+encodeURIComponent(user)+'&hash='+hash;
 assert.equal(await verifiedTelegramId(data,token,now),'12345');
 await assert.rejects(()=>verifiedTelegramId(data,token+'bad',now));
 await assert.rejects(()=>verifiedTelegramId(data,token,now+3700000));
 await assert.rejects(()=>verifiedTelegramId(data+'&user=%7B%7D',token,now));
});
async function fakeRpc(data,fn){
 const original=globalThis.fetch;
 globalThis.fetch=async (_url,opt)=>({ok:true,json:async()=>({result:data[JSON.parse(opt.body).method]})});
 try{return await fn();}finally{globalThis.fetch=original;}
}
test('ETH payments verify recipient, amount, receipt, and confirmations',async()=>{
 const hash='0x'+'a'.repeat(64),destination='0x'+'b'.repeat(40),sent=1000000000000000n;
 const data={eth_chainId:'0x1',
 eth_getTransactionByHash:{hash,to:destination,value:'0x'+sent.toString(16),blockNumber:'0x65'},
 eth_getTransactionReceipt:{transactionHash:hash,status:'0x1',blockNumber:'0x65',logs:[]},
 eth_blockNumber:'0x70'};
 const order={asset:'ETH',chain:'ethereum',receive_address:destination,amount_atomic:sent.toString()};
 await fakeRpc(data,async()=>{
  assert.equal((await verifyChainPayment(order,hash,{ETHEREUM_RPC_URL:'https://eth.example'})).confirmations,12);
  await assert.rejects(()=>verifyChainPayment({...order,receive_address:'0x'+'c'.repeat(40)},hash,{ETHEREUM_RPC_URL:'https://eth.example'}));
 });
});
test('USDT ERC-20 checks contract and Transfer recipient',async()=>{
 const hash='0x'+'a'.repeat(64),destination='0x'+'b'.repeat(40),token='0x'+'d'.repeat(40);
 const log={address:token,topics:[ERC20_TRANSFER_TOPIC,'0x'+'0'.repeat(64),'0x'+'0'.repeat(24)+'b'.repeat(40)],data:'0x2625a0'};
 const data={eth_chainId:'0x1',
 eth_getTransactionByHash:{hash,to:token,value:'0x0',blockNumber:'0x65'},
 eth_getTransactionReceipt:{transactionHash:hash,status:'0x1',blockNumber:'0x65',logs:[log]},
 eth_blockNumber:'0x70'};
 const order={asset:'USDT_ERC20',chain:'ethereum',receive_address:destination,amount_atomic:'2500000'};
 await fakeRpc(data,async()=>{
  assert.equal((await verifyChainPayment(order,hash,{ETHEREUM_RPC_URL:'https://eth.example',USDT_ERC20_CONTRACT:token})).actualAtomic,'2500000');
  await assert.rejects(()=>verifyChainPayment(order,hash,{ETHEREUM_RPC_URL:'https://eth.example',USDT_ERC20_CONTRACT:'0x'+'e'.repeat(40)}));
 });
});
test('Bitcoin Core output must pay correct address',async()=>{
 const hash='a'.repeat(64),address='bc1qtestaddress0000000000000000000000000000';
 const order={asset:'BTC',chain:'bitcoin',receive_address:address,amount_atomic:'10000'};
 await fakeRpc({getrawtransaction:{txid:hash,confirmations:3,
 vout:[{value:0.0001,scriptPubKey:{address}}]}},async()=>{
  assert.equal((await verifyChainPayment(order,hash,{BITCOIN_RPC_URL:'https://btc.example'})).actualAtomic,'10000');
 });
});
