import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPaymentAdmin,readPaymentSwitches,isPaymentEnabled,
  handlePaymentAdminCommand,hardPaymentGate
} from './payment-controls.mjs';

function makeDb(initial={}){
  const values={master:0,stars:0,crypto:0,...initial};
  const audit=[];
  return {
    values,audit,
    prepare(sql){
      return {bind(...args){
        return {
          async all(){
            if(!sql.startsWith('SELECT channel,enabled FROM rustup_payment_settings'))
              throw Error('unexpected_query');
            return {results:Object.entries(values).map(([channel,enabled])=>({channel,enabled}))};
          },
          async run(){
            if(!sql.startsWith('UPDATE rustup_payment_settings SET enabled='))
              throw Error('unexpected_update');
            const [next,at,id,channel,condition]=args;
            if(!Number.isSafeInteger(id)||next!==condition||!(channel in values))
              throw Error('bad_bind');
            if(values[channel]===next)return {meta:{changes:0}};
            audit.push({channel,old:values[channel],next,at,id});
            values[channel]=next;
            return {meta:{changes:1}};
          }
        };
      }};
    }
  };
}
const OWNER=12345678;
function env(db,extra={}){
  return {
    DB:db, PAYMENT_ADMIN_IDS:String(OWNER),
    BOT_USERNAME:'rustuper_bot',
    PAYMENT_PRODUCTION_ENABLED:'false',
    STARS_PAYMENT_ENABLED:'true',
    EXTERNAL_VARIABLE_CRYPTO_CHECKOUT_ENABLED:'true',
    CRYPTO_GATEWAY_CONNECTED:'true',
    ...extra
  };
}
function update(text,from=OWNER,chatType='private',chatId=from,extra={}){
  return {message:{text,from:{id:from},chat:{id:chatId,type:chatType},...extra}};
}
function sink(){
  const sent=[];
  return {sent,sendMessage:async(chat,text)=>{sent.push({chat,text});}};
}

test('default disabled: production hard gate and D1 switches both required',async()=>{
  const db=makeDb(),cfg=env(db);
  assert.deepEqual({...await readPaymentSwitches(db)},{master:false,stars:false,crypto:false});
  assert.equal(await isPaymentEnabled(cfg,'stars'),false);
  assert.equal(await isPaymentEnabled(cfg,'crypto'),false);
  assert.equal(hardPaymentGate(cfg,'stars'),false);
  assert.equal(hardPaymentGate({...cfg,PAYMENT_PRODUCTION_ENABLED:'true'},'crypto'),true);
});

test('only named admin can change settings in private Telegram chat',async()=>{
  const db=makeDb(),cfg=env(db);
  const out=sink();
  for(const attempt of [
    update('/pay master on',OWNER+1),
    update('/pay master on',OWNER,'group',-100),
    update('/pay master on',OWNER,'private',OWNER+10),
    update('/pay master on',OWNER,'private',OWNER,{forward_origin:{type:'user'}})
  ]){
    const result=await handlePaymentAdminCommand(attempt,cfg,out);
    assert.equal(result.handled,true);
    assert.equal(result.authorized,false);
  }
  assert.equal(db.values.master,0);
  assert.equal(db.audit.length,0);
  assert.equal(out.sent.length,0);
});

test('separate Stars, crypto, global switches; updates produce audit events',async()=>{
  const db=makeDb(),cfg=env(db),out=sink();
  for(const command of ['/pay stars on','/pay crypto on','/pay master on']){
    const r=await handlePaymentAdminCommand(update(command),cfg,out);
    assert.equal(r.handled,true);
    assert.equal(r.ok,true);
  }
  assert.deepEqual(db.values,{master:1,stars:1,crypto:1});
  assert.deepEqual(db.audit.map(x=>x.channel),['stars','crypto','master']);
  assert.equal(await isPaymentEnabled(cfg,'stars'),false); // hard gate off
  assert.equal(await isPaymentEnabled(cfg,'crypto'),false);
  const active={...cfg,PAYMENT_PRODUCTION_ENABLED:'true'};
  assert.equal(await isPaymentEnabled(active,'stars'),true);
  assert.equal(await isPaymentEnabled(active,'crypto'),true);
  const off=await handlePaymentAdminCommand(update('/pay off'),cfg,out);
  assert.equal(off.updated,'master');
  assert.equal(db.values.master,0);
  assert.equal(db.audit.length,4);
  assert.equal(await isPaymentEnabled(active,'stars'),false);
  assert.equal(await isPaymentEnabled(active,'crypto'),false);
  assert.match(out.sent.at(-1).text,/Master: OFF/);
});

test('repeated command is idempotent, no duplicate audit rows',async()=>{
  const db=makeDb(),cfg=env(db),out=sink();
  await handlePaymentAdminCommand(update('/pay stars on'),cfg,out);
  await handlePaymentAdminCommand(update('/pay stars on'),cfg,out);
  assert.equal(db.audit.length,1);
  assert.equal(db.values.stars,1);
});

test('missing database/migration and disconnected provider fail closed',async()=>{
  const db=makeDb({master:1,stars:1,crypto:1});
  const enabled=env(db,{PAYMENT_PRODUCTION_ENABLED:'true'});
  assert.equal(await isPaymentEnabled(enabled,'stars'),true);
  assert.equal(await isPaymentEnabled({...enabled,DB:null},'stars'),false);
  assert.equal(await isPaymentEnabled({...enabled,DB:{prepare(){throw Error('db down');}}},'stars'),false);
  assert.equal(await isPaymentEnabled({...enabled,CRYPTO_GATEWAY_CONNECTED:'false'},'crypto'),false);
  assert.equal(await isPaymentEnabled({...enabled,EXTERNAL_VARIABLE_CRYPTO_CHECKOUT_ENABLED:'false'},'crypto'),false);
  const incomplete=makeDb();
  delete incomplete.values.crypto;
  await assert.rejects(()=>readPaymentSwitches(incomplete),/not_migrated/);
  assert.equal(await isPaymentEnabled({...enabled,DB:incomplete},'crypto'),false);
});

test('unconfigured admin list cannot grant admin privileges',async()=>{
  const db=makeDb(),out=sink();
  const cfg=env(db,{PAYMENT_ADMIN_IDS:''});
  assert.equal(isPaymentAdmin(OWNER,cfg),false);
  const res=await handlePaymentAdminCommand(update('/pay stars on'),cfg,out);
  assert.equal(res.authorized,false);
  assert.equal(db.audit.length,0);
});

test('bot suffix, invalid commands, and foreign bot handled safely',async()=>{
  const db=makeDb(),cfg=env(db),out=sink();
  assert.equal((await handlePaymentAdminCommand(update('/pay@other_bot master on'),cfg,out)).handled,false);
  assert.equal((await handlePaymentAdminCommand(update('/pay@rustuper_bot status'),cfg,out)).ok,true);
  assert.equal((await handlePaymentAdminCommand(update('/pay no_such_command'),cfg,out)).ok,true);
  assert.match(out.sent.at(-1).text,/Usage:/);
  assert.equal(db.audit.length,0);
});

test('malformed or missing settings returns error without applying an admin command',async()=>{
  const db=makeDb(),cfg=env(db),out=sink();
  delete db.values.stars;
  const x=await handlePaymentAdminCommand(update('/pay master on'),cfg,out);
  assert.equal(x.ok,false);
  assert.equal(db.audit.length,0);
  assert.equal(db.values.master,0);
});

test('existing bot admin authorization can use verified Telegram admin identity and isolated D1',async()=>{
  const productionDb={prepare(){throw Error('must not touch existing game DB');}};
  const paymentsDb=makeDb();
  const cfg={...env(productionDb,{PAYMENTS_DB:paymentsDb,PAYMENT_ADMIN_IDS:''})};
  const out=sink();
  let calls=0;
  const options={...out,authorize:async user=>{calls++;return user.id===OWNER;}};
  const result=await handlePaymentAdminCommand(update('/pay stars on'),cfg,options);
  assert.equal(result.ok,true);
  assert.equal(paymentsDb.values.stars,1);
  assert.equal(paymentsDb.audit.length,1);
  assert.equal(calls,1);
  assert.equal((await handlePaymentAdminCommand(update('/pay master on',OWNER+1),cfg,options)).authorized,false);
  assert.equal(paymentsDb.values.master,0);
  assert.equal(await isPaymentEnabled({...cfg,PAYMENT_PRODUCTION_ENABLED:'true'},'stars'),false);
});
