import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import worker from './worker.mjs';
import {verifiedTelegramInitData} from './telegram-initdata.mjs';

const token='12345678:'+'a'.repeat(35);
const now=Date.now();
function telegramData(overrides={}){
 const fields={auth_date:String(Math.floor(now/1000)),
   user:JSON.stringify({id:7654321,first_name:'Tester'}),...overrides};
 const check=Object.entries(fields).sort(([a],[b])=>a.localeCompare(b))
   .map(([k,v])=>k+'='+v).join('\n');
 const key=createHmac('sha256','WebAppData').update(token).digest();
 const hash=createHmac('sha256',key).update(check).digest('hex');
 return new URLSearchParams({...fields,hash}).toString();
}
test('valid fresh signed Telegram initData authenticates correct user',async()=>{
 const auth=await verifiedTelegramInitData(telegramData(),token,now);
 assert.equal(auth.userId,7654321);
});
test('modified user, stale data and duplicate auth keys are rejected',async()=>{
 const original=telegramData();
 await assert.rejects(
   ()=>verifiedTelegramInitData(original.replace('7654321','9999999'),token,now),
   /invalid_telegram_auth/
 );
 await assert.rejects(
   ()=>verifiedTelegramInitData(telegramData({auth_date:String(Math.floor(now/1000)-800)}),token,now),
   /expired_telegram_auth/
 );
 await assert.rejects(
   ()=>verifiedTelegramInitData(original+'&auth_date=1',token,now),
   /invalid_telegram_auth/
 );
});
test('Stars Worker is publicly health-checkable but disabled by default',async()=>{
 const env={STARS_PAYMENT_ENABLED:'false'};
 const health=await worker.fetch(new Request('https://example.invalid/health'),env);
 assert.equal(health.status,200);
 const status=await health.json();
 assert.equal(status.liveEnabled,false);
 assert.equal(status.realGameCredits,false);
 const unavailable=await worker.fetch(new Request('https://example.invalid/api/stars/checkout',{
   method:'POST',headers:{origin:'https://store.example', 'content-type':'application/json'},
   body:JSON.stringify({sku:'fixed_badge',initData:telegramData()})
 }),env);
 assert.equal(unavailable.status,503);
});
test('Stars Worker rejects unauthorized origin and forged initData',async()=>{
 const env={STARS_PAYMENT_ENABLED:'true',
   STARS_ALLOWED_ORIGIN:'https://store.example',TG_STARS_BOT_TOKEN:token,
   DB:{}};
 let response=await worker.fetch(new Request('https://example.invalid/api/stars/checkout',{
   method:'POST',headers:{origin:'https://attacker.example','content-type':'application/json'},
   body:JSON.stringify({sku:'fixed_badge',initData:telegramData()})
 }),env);
 assert.equal(response.status,403);
 response=await worker.fetch(new Request('https://example.invalid/api/stars/checkout',{
   method:'POST',headers:{origin:'https://store.example','content-type':'application/json'},
   body:JSON.stringify({sku:'fixed_badge',initData:'fake'})
 }),env);
 assert.equal(response.status,401);
});
