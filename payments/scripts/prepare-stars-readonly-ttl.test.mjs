import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildReadonlyHotfixConfig,verifyAndPatchSources} from './prepare-stars-readonly-ttl.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','integration','telegram-stars');
// On Windows, Git may check out CRLF; keep test fixtures canonical LF.
// The actual production patcher separately preserves the recovered CRLF.
const normalizeNewlines=value=>value.replace(/\r\n/g,'\n');
const updatedValidator=normalizeNewlines(fs.readFileSync(path.join(root,'telegram-initdata.mjs'),'utf8'));
const updatedApi=normalizeNewlines(fs.readFileSync(path.join(root,'stars-readonly-live.mjs'),'utf8'));
const oldValidator=updatedValidator
 .replace(
 `export async function verifiedTelegramInitData(raw,botToken,now=Date.now(),maxAgeSeconds=600) {
  // Short-lived by default for payment-sensitive callers. Explicit 24h maximum
  // is allowed ONLY for a separate read-only endpoint with checkout disabled.
  if(!Number.isSafeInteger(maxAgeSeconds)||maxAgeSeconds<60||
     maxAgeSeconds>86400)
    throw Error('invalid_telegram_auth_max_age');`,
 'export async function verifiedTelegramInitData(raw,botToken,now=Date.now()) {'
 ).replace('authDate<current-maxAgeSeconds','authDate<current-600');
const oldApi=updatedApi.replace(
 `  // Read-only catalogue/history permits a signed Telegram session up to 24h.
  // Payment-sensitive callers still use the validator's 10-minute default.
  try {user=await verifiedTelegramInitData(body?.initData,env?.BOT_TOKEN,Date.now(),86400);`,
 `  try {user=await verifiedTelegramInitData(body?.initData,env?.BOT_TOKEN);`
);
if(oldValidator===updatedValidator||oldApi===updatedApi)
 throw Error('test_fixture_failed_to_reconstruct_pre_hotfix_code');
const STATS='9b0b533f-540a-4a25-a429-70ca8bd4e23d',STARS='06079270-a227-466a-9991-abd4201ec5f6';
const settings={compatibility_date:'2025-06-01',compatibility_flags:[],bindings:[
 ...['BOT_TOKEN','WEBHOOK_SECRET','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN'].map(name=>({name,type:'secret_text'})),
 {name:'APP_URL',type:'plain_text',text:'https://ttzoomrust-hub.github.io/rust-up/'},
 {name:'DB',type:'d1',id:STATS},
 {name:'PAYMENTS_DB',type:'d1',id:STARS},
 ...['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED','STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED'].map(name=>({name,type:'plain_text',text:'false'}))
]};
const cron={schedules:[{cron:'* * * * *'}]};
test('reconstructs exact pre-hotfix source with Windows CRLF',()=>{
 const crlf=x=>x.replace(/\n/g,'\r\n');
 const changed=verifyAndPatchSources(crlf(oldValidator),crlf(oldApi),updatedValidator,updatedApi);
 assert.equal(changed.validator,crlf(updatedValidator));
 assert.equal(changed.api,crlf(updatedApi));
 assert.match(changed.api,/86400/);
});
test('refuses even one unrelated source difference',()=>{
 assert.throws(()=>verifyAndPatchSources(oldValidator+'hack',oldApi,updatedValidator,updatedApi),/deployed_validator_drift/);
 assert.throws(()=>verifyAndPatchSources(oldValidator,oldApi+'hack',updatedValidator,updatedApi),/deployed_stars_api_drift/);
});
test('wrangler config preserves both D1 bindings and disables every payment flag',()=>{
 const conf=buildReadonlyHotfixConfig(settings,cron);
 assert.match(conf,/binding = "DB"/);
 assert.match(conf,/binding = "PAYMENTS_DB"/);
 assert.match(conf,/keep_vars = true/);
 assert.match(conf,/upload_source_maps = true/);
 assert.match(conf,/STARS_PAYMENT_ENABLED = "false"/);
 assert.match(conf,/STARS_REFUNDS_ENABLED = "false"/);
});
test('refuses unexpected enabled payment gate or changed cron',()=>{
 const bad=structuredClone(settings);
 bad.bindings.find(x=>x.name==='STARS_PAYMENT_ENABLED').text='true';
 assert.throws(()=>buildReadonlyHotfixConfig(bad,cron),/payment_gate_must_remain_disabled/);
 assert.throws(()=>buildReadonlyHotfixConfig(settings,{schedules:[]}),/live_cron_changed/);
});
