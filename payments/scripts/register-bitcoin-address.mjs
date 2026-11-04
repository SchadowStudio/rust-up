// Registers a Trust Wallet-owned Bitcoin receive address in Bitcoin Core
// as watch-only; NO private keys, seed phrase, or signing authority.
import {validateReceivingAddress} from '../src/address.js';
const address=process.argv[2];
if(!address || process.argv[3]!=='--confirm-watch-only'){
 console.error('Usage: node scripts/register-bitcoin-address.mjs <new BTC receive address> --confirm-watch-only');
 process.exit(2);
}
if(!await validateReceivingAddress('bitcoin',address)){
 console.error('Invalid Bitcoin mainnet address/checksum.');
 process.exit(2);
}
const endpoint=process.env.BITCOIN_RPC_URL,authorization=process.env.BITCOIN_RPC_BASIC_B64;
if(!endpoint||!authorization||!/^https:\/\//i.test(endpoint)){
 console.error('Set BITCOIN_RPC_URL (protected HTTPS) and BITCOIN_RPC_BASIC_B64 in environment.');
 process.exit(2);
}
async function rpc(method,params){
 const response=await fetch(endpoint,{
  method:'POST',
  headers:{
   'content-type':'application/json',
   authorization:'Basic '+authorization
  },
  body:JSON.stringify({jsonrpc:'2.0',id:'watch-only',method,params}),
  signal:AbortSignal.timeout(20000)
 });
 if(!response.ok)throw Error('Bitcoin Core HTTP '+response.status);
 const result=await response.json();
 if(result.error)throw Error('Bitcoin Core rejected '+method+': '+result.error.code);
 return result.result;
}
try{
 const info=await rpc('getdescriptorinfo',['addr('+address+')']);
 if(typeof info?.descriptor!=='string'||!info.descriptor.startsWith('addr('))throw Error('unexpected_descriptor');
 const result=await rpc('importdescriptors',[[{
  desc:info.descriptor,timestamp:'now',active:false,label:'RUST UP watch only'
 }]]);
 if(!Array.isArray(result)||result[0]?.success!==true)
  throw Error('watch_only_import_failed');
 console.log('Watch-only descriptor registered. No spending key has been imported.');
 console.log('Receive address:',address);
 console.log('Keep original Trust Wallet under your sole control.');
}catch(e){
 console.error('Could not import watch-only descriptor:',String(e.message));
 process.exitCode=1;
}
