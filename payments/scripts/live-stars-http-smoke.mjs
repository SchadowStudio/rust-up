// Safe live HTTP smoke: only unauthenticated requests that MUST be rejected.
// No valid Telegram initData, invoice, payment provider call, or D1 writes.
const base='https://rustup-bot.ttzoomrust.workers.dev';
const origin='https://ttzoomrust-hub.github.io';
async function probe(route,body){
 const res=await fetch(base+route,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
  headers:{'origin':origin,'content-type':'application/json'},
  body:JSON.stringify(body)
 });
 const contentType=res.headers.get('content-type')||'';
 if(!contentType.includes('application/json'))
  throw Error(route+' returned non-JSON HTTP '+res.status);
 let data;
 try{data=await res.json();}catch{throw Error(route+' invalid JSON');}
 if(res.status!==401||data?.ok!==false||
    data.error!=='telegram_auth_required')
  throw Error(route+' did not reject forged identity (status '+res.status+
   ', error '+String(data?.error||'unknown')+')');
 console.log('PASS:',route,'rejects forged Telegram identity with 401');
}
await probe('/api/stars/variable/quote',{
 initData:'forged',amountMinor:183
});
await probe('/api/stars/variable/checkout',{
 initData:'forged',amountMinor:183,
 requestId:'00000000-0000-4000-8000-000000000001'
});
console.log('LIVE WORKER HTTP SAFE SMOKE PASSED. No charges, invoices, or credits.');
