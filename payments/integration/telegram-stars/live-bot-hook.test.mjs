import test from 'node:test';
import assert from 'node:assert/strict';
import {handleExistingBotPaymentCommands} from './live-bot-hook.mjs';

function db(){
 const settings={master:0,stars:0,crypto:0};
 return {
  settings,
  prepare(sql){
   return {bind(...args){return {
     async all(){return {results:Object.entries(settings).map(([channel,enabled])=>({channel,enabled}))};},
     async run(){
       if(!sql.startsWith('UPDATE rustup_payment_settings'))throw Error('unexpected_sql');
       const [enabled,,adminId,channel]=args;
       if(adminId!==1001)throw Error('wrong_admin');
       settings[channel]=enabled;
       return {meta:{changes:1}};
     }
   }}};
  }
 };
}
function update(text,id=1001){
 return {message:{text,from:{id,username:'owner'},chat:{id,type:'private'}}};
}
test('Existing bot bridge does not intercept unrelated updates',async()=>{
 const out=await handleExistingBotPaymentCommands(update('/start'),{});
 assert.equal(out,false);
});
test('Existing bot bridge uses trusted existing admin check without changing game DB',async()=>{
 const paymentDb=db(),calls=[];
 const gameDb={prepare(){throw Error('game DB must not be touched');}};
 const env={DB:gameDb,PAYMENTS_DB:paymentDb, BOT_USERNAME:'rustuper_bot',
   PAYMENT_PRODUCTION_ENABLED:'false'};
 const adapter={
   isAdmin:async(_env,user)=>user.id===1001,
   telegramApi:async(_env,method,body)=>{
     calls.push({method,body});
     return {ok:true};
   }
 };
 assert.equal(await handleExistingBotPaymentCommands(update('/pay stars on'),env,adapter),true);
 assert.equal(paymentDb.settings.stars,1);
 assert.equal(calls.at(-1).method,'sendMessage');
 assert.match(calls.at(-1).body.text,/Stars: ON/);
 assert.equal(await handleExistingBotPaymentCommands(update('/pay stars off',2002),env,adapter),true);
 assert.equal(paymentDb.settings.stars,1);
 assert.equal(calls.length,1);
});
test('Existing bot bridge fails closed if Telegram/authorization dependencies absent',async()=>{
 await assert.rejects(()=>handleExistingBotPaymentCommands(update('/pay status'),{PAYMENTS_DB:db()}),/missing/);
});
