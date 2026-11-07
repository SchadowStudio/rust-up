import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildSafeWranglerConfig,verifySnapshot,writeConfigIfUnchanged} from './prepare-live-bot-deployment.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const hash=x=>createHash('sha256').update(x).digest('hex');
const files=new Map([['worker.js','an original test script'],['admin.js','original admin module']]);
const manifest={worker:'rustup-bot',files:[...files].map(([name,data])=>({
 name,sha256:hash(data),bytes:Buffer.byteLength(data)
}))};
const settings={
 compatibility_date:'2025-06-01',compatibility_flags:[],
 bindings:[
  {type:'secret_text',name:'BOT_TOKEN'},
  {type:'secret_text',name:'WEBHOOK_SECRET'},
  {type:'secret_text',name:'ADMIN_BOT_TOKEN'},
  {type:'secret_text',name:'CLIPS_BOT_TOKEN'},
  {type:'plain_text',name:'BOT_USERNAME',text:'rustuper_bot'},
  {type:'d1',name:'DB',id:'9b0b533f-540a-4a25-a429-70ca8bd4e23d'}
 ]
};
test('safe release config keeps existing secrets, two D1 databases and minute cron',()=>{
 const conf=buildSafeWranglerConfig(settings,{schedules:[{cron:'* * * * *'}]});
 assert.match(conf,/name = "rustup-bot"/);
 assert.match(conf,/keep_vars = true/);
 assert.match(conf,/PAYMENT_PRODUCTION_ENABLED = "false"/);
 assert.match(conf,/binding = "DB"/);
 assert.match(conf,/binding = "PAYMENTS_DB"/);
 assert.match(conf,/database_id = "06079270-a227-466a-9991-abd4201ec5f6"/);
 assert.match(conf,/crons = \["\* \* \* \* \*"\]/);
});
test('missing bot secret, database mismatch or cron changes block deploy preparation',()=>{
 assert.throws(()=>buildSafeWranglerConfig({
  ...settings,bindings:settings.bindings.filter(x=>x.name!=='BOT_TOKEN')
 },{schedules:[{cron:'* * * * *'}]}),/secret_binding_missing/);
 assert.throws(()=>buildSafeWranglerConfig({
  ...settings,bindings:settings.bindings.map(x=>x.name==='DB'?{...x,id:'wrong'}:x)
 },{schedules:[{cron:'* * * * *'}]}),/game_database_binding_changed/);
 assert.throws(()=>buildSafeWranglerConfig(settings,{schedules:[{cron:'*/5 * * * *'}]}),/unexpected_live_cron/);
});
test('snapshot comparer blocks live deployment changes',()=>{
 const complete=new Map([...files,...new Array(7).fill(0).map((_,i)=>['mod'+i+'.js','placeholder'])]);
 const m={worker:'rustup-bot',files:[...complete].map(([name,s])=>({
  name,sha256:hash(s),bytes:Buffer.byteLength(s)
 }))};
 assert.equal(verifySnapshot(complete,m),true);
 complete.set('worker.js','modified by a different deployer');
 assert.throws(()=>verifySnapshot(complete,m),/live_bot_changed_since_recovery_worker/);
});

test('preflight rerun accepts unchanged config but refuses any local drift', async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rustup-preflight-'));
  const p=path.join(dir,'wrangler.rustup-bot.toml');
  try{
    await writeConfigIfUnchanged(p,'name = "rustup-bot"\\n');
    await writeConfigIfUnchanged(p,'name = "rustup-bot"\\n');
    await assert.rejects(()=>writeConfigIfUnchanged(p,'name = "wrong"\\n'),/local_deploy_config_drift/);
    assert.equal(await fs.readFile(p,'utf8'),'name = "rustup-bot"\\n');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
