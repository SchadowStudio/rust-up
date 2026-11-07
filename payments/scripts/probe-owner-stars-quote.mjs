// Anonymous, harmless runtime smoke checks for read-only Stars quote Worker.
// Deliberately never sends a real Telegram session or a payment request.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT='https://rustup-bot.ttzoomrust.workers.dev';
const APP='https://ttzoomrust-hub.github.io';
export async function probeOwnerStarsQuote(fetchImpl=fetch){
 const checks=[
  {route:'/api/stars/variable/quote',method:'OPTIONS',origin:APP,want:204},
  {route:'/api/stars/variable/quote',method:'POST',origin:APP,want:401},
  {route:'/api/stars/variable/quote',method:'POST',origin:'https://evil.example',want:403},
  {route:'/api/stars/variable/quote',method:'GET',origin:APP,want:405},
  {route:'/api/stars/variable/checkout',method:'POST',origin:APP,want:404}
 ];
 const results=[];
 for(const p of checks){
  const response=await fetchImpl(ROOT+p.route,{
   method:p.method,headers:{
    origin:p.origin,'content-type':'application/json'
   },
   ...(p.method==='POST'?{body:'{"initData":"forged_offline_only","amountMinor":10000}'}:{}),
   redirect:'error',signal:AbortSignal.timeout(12000)
  });
  if(response.status!==p.want)
   throw Error('quote_only_probe_wrong_status_'+p.route.split('/').pop()+'_'+response.status);
  if(response.headers.get('cache-control')!=='no-store')
   throw Error('quote_only_probe_cache_not_private');
  if(p.route.endsWith('/quote')&&p.origin===APP&&
     response.headers.get('access-control-allow-origin')!==APP)
   throw Error('quote_only_probe_cors_failure');
  results.push({route:p.route,method:p.method,status:response.status});
 }
 return {status:'PASS',checks:results.length,realCredentialsUsed:false,
  paymentsAttempted:0,gameBalanceWrites:0};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 probeOwnerStarsQuote()
  .then(r=>console.log(JSON.stringify(r)))
  .catch(e=>{console.error('QUOTE-ONLY RUNTIME SAFETY STOP:',
   String(e?.message||e).slice(0,150));process.exitCode=1;});
}
