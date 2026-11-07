// Safe public smoke test for the READ-ONLY Stars history Worker.
// Requests are anonymous/forged. No Telegram invoice, webhook, DB write,
// wallet transfer, game balance change or checkout is attempted.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const API='https://rustup-bot.ttzoomrust.workers.dev';
const ORIGIN='https://ttzoomrust-hub.github.io';

export async function probeHistoryOnlyWorker(fetchImpl=fetch){
 const cases=[
  {route:'/api/stars/variable/history',method:'OPTIONS',want:204,
   headers:{origin:ORIGIN,'access-control-request-method':'POST'}},
  {route:'/api/stars/variable/history',method:'POST',want:401,
   headers:{origin:ORIGIN,'content-type':'application/json'},
   body:JSON.stringify({initData:'offline_forged_auth_not_a_player'})},
  {route:'/api/stars/variable/history',method:'POST',want:403,
   headers:{origin:'https://evil.example','content-type':'application/json'},
   body:JSON.stringify({initData:'offline_forged_auth_not_a_player'})},
  {route:'/api/stars/variable/quote',method:'POST',want:404,
   headers:{origin:ORIGIN,'content-type':'application/json'},
   body:JSON.stringify({amountMinor:10000})},
  {route:'/api/stars/variable/checkout',method:'POST',want:404,
   headers:{origin:ORIGIN,'content-type':'application/json'},
   body:JSON.stringify({amountMinor:10000})}
 ];
 const results=[];
 for(const test of cases){
  const response=await fetchImpl(API+test.route,{
   method:test.method,headers:test.headers,
   ...(test.body?{body:test.body}:{}),
   redirect:'error',signal:AbortSignal.timeout(12000)
  });
  if(response.status!==test.want)
   throw Error('history_only_runtime_unexpected_'+test.route.split('/').pop()+
    '_http_'+response.status);
  if(response.headers.get('cache-control')!=='no-store')
   throw Error('history_only_runtime_response_not_private');
  if(test.route.endsWith('/history')&&test.headers.origin===ORIGIN){
   if(response.headers.get('access-control-allow-origin')!==ORIGIN)
    throw Error('history_only_runtime_cors_invalid');
  }
  results.push({endpoint:test.route.split('/').pop(),expectedStatus:test.want,
   success:true});
 }
 return {
  probes:results,
  realTelegramCredentialsUsed:false,
  anyPaymentCreated:false,
  anyBalanceWrite:false,
  postDeploymentSmokePassed:true
 };
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 probeHistoryOnlyWorker()
  .then(report=>console.log('PASS: '+JSON.stringify(report)))
  .catch(err=>{
   console.error('HISTORY-ONLY SMOKE SAFETY STOP:',
    String(err?.message||err).slice(0,165));
   process.exitCode=1;
  });
}
