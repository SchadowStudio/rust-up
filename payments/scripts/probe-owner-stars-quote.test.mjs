import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {probeOwnerStarsQuote}
 from './probe-owner-stars-quote.mjs';

test('public quote smoke checks never send real initData or create a payment',async()=>{
 const seen=[];
 const fetchImpl=async(url,options)=>{
  seen.push({url,options});
  const quote=String(url).endsWith('/quote');
  const want=quote?
   (options.method==='OPTIONS'?204:
    options.headers.origin==='https://evil.example'?403:
    options.method==='GET'?405:401):404;
  return {status:want,headers:new Headers({
   'cache-control':'no-store',
   'access-control-allow-origin':options.headers.origin===
    'https://ttzoomrust-hub.github.io'?'https://ttzoomrust-hub.github.io':''
  })};
 };
 const r=await probeOwnerStarsQuote(fetchImpl);
 assert.equal(r.status,'PASS');
 assert.equal(r.checks,5);
 assert.equal(r.paymentsAttempted,0);
 assert.equal(r.realCredentialsUsed,false);
 for(const c of seen){
  if(c.options.body)assert.match(c.options.body,/forged_offline_only/);
  assert.doesNotMatch(c.options.body||'',/telegram_payment_charge_id|invoiceUrl/);
 }
});
test('mismatched HTTP status never marks quote ready',async()=>{
 await assert.rejects(()=>probeOwnerStarsQuote(async()=>({status:200,
  headers:new Headers({'cache-control':'no-store'})})),/wrong_status/);
});
test('preview preparation defaults to no deployment and only accepts explicit opt-in',()=>{
 const ps=readFileSync(new URL('./prepare-owner-stars-quote.ps1',import.meta.url),'utf8');
 assert.match(ps,/\[switch\]\$PublishReadOnlyQuote/);
 assert.match(ps,/if\(!\$PublishReadOnlyQuote\)/);
 const active=ps.split('\n').filter(x=>!x.trim().startsWith('#')).join('\n');
 assert.ok(active.includes('wrangler deploy --dry-run'));
 assert.ok(active.includes('wrangler deploy --config'));
 assert.ok(active.indexOf('if(!$PublishReadOnlyQuote)')<
  active.indexOf('wrangler deploy --config'));
 assert.doesNotMatch(active,/STARS_PAYMENT_ENABLED.*true|\bUPDATE accounts\b|refundStarPayment/);
});
