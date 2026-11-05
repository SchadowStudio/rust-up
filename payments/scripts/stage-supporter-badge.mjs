// Stage ONLY the new supporter badge entitlement against the exact recovered
// live RUST UP bot. Never touch source in Git, real worker deployment, or flags.
// Run after recover-current-stars-variable.mjs + stage-current-variable-stars.mjs.
// A different live version / source layout blocks the release.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {recoverVariableSource,verifyVariableSnapshot} from './recover-current-stars-variable.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.private','rustup-bot-recovered')+path.sep;
const SRC=path.join(ROOT,'payments','integration','telegram-stars');
const FILES=['stars-live-bridge.mjs','refunds.mjs','supporter-badge.mjs'];
const BACKUP='before-supporter-badge';
const CONFIG='wrangler.stars-variable.toml';
const hash=s=>createHash('sha256').update(s).digest('hex');
const norm=s=>s.replace(/\r\n/g,'\n');
async function validateSource(name,content){
 if(name==='stars-live-bridge.mjs'){
  if(!content.includes('grantSupporterBadge(db,')||
     !content.includes("path==='/api/stars/supporter-badge'")||
     !content.includes('readSupporterBadge(db,userId)'))
   throw Error('supporter_bridge_not_ready');
 }else if(name==='refunds.mjs'){
  if(!content.includes('supporterRefundStatement(db,orderId,at)')||
     !content.includes('db.batch(statements)'))
   throw Error('supporter_refund_not_atomic');
 }else if(name==='supporter-badge.mjs'){
  if(!content.includes("supporter_badge_v1")||
     !content.includes("AND o.status='paid'")||
     !content.includes('AND c.unlocked_at_ms IS NOT NULL'))
   throw Error('supporter_entitlement_guard_missing');
 }
 if(!content.includes('gameBalanceChanged:false')&&name==='supporter-badge.mjs')
  throw Error('supporter_game_separation_missing');
}
export function verifySupporterReleaseConfig(config){
 if(typeof config!=='string'||config.length<200||
    !config.includes('main = "./worker.stars-variable.bundle.js"')||
    !config.includes('keep_vars = true')||
    !config.includes('binding = "DB"')||
    !config.includes('binding = "PAYMENTS_DB"')||
    !config.includes('crons = ["* * * * *"]'))
  throw Error('supporter_baseline_worker_config_changed');
 for(const key of ['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
  'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
  'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
  'PAYMENT_WALLET_STRICT_MODE']){
  if(!config.includes(key+' = "false"'))throw Error('unsafe_payment_gate_'+key);
 }
 return true;
}
export async function stageSupporterBadge(folder,token,check=false){
 const dir=await fs.realpath(path.resolve(folder));
 if(!dir.startsWith(PRIVATE))throw Error('private_worker_recovery_required');
 const manifest=JSON.parse(await fs.readFile(path.join(dir,'RECOVERY-MANIFEST.json'),'utf8'));
 const live=await recoverVariableSource(token);
 verifyVariableSnapshot(live.source,manifest);
 verifySupporterReleaseConfig(await fs.readFile(path.join(dir,CONFIG),'utf8'));
 const originalMap=new Map(manifest.files.map(x=>[x.name,x]));
 const originals=new Map(),planned=new Map();
 for(const name of FILES){
  const newSource=await fs.readFile(path.join(SRC,name),'utf8');
  await validateSource(name,newSource);
  planned.set(name,newSource);
  if(name==='supporter-badge.mjs')continue;
  const original=await fs.readFile(
   check?path.join(dir,BACKUP,name):path.join(dir,name),'utf8');
  const expected=originalMap.get(name);
  if(!expected||hash(original)!==expected.sha256||
     !live.source.has(name)||original!==live.source.get(name)&&norm(original)!==norm(live.source.get(name)))
   throw Error('original_live_worker_module_changed_'+name);
  originals.set(name,original);
 }
 if(check){
  for(const [name,expected] of planned){
   if(norm(await fs.readFile(path.join(dir,name),'utf8'))!==norm(expected))
    throw Error('supporter_staging_source_mismatch_'+name);
  }
  for(const [name,original] of originals){
   if(norm(await fs.readFile(path.join(dir,BACKUP,name),'utf8'))!==norm(original))
    throw Error('supporter_original_backup_changed_'+name);
  }
  const bundle=await fs.readFile(path.join(dir,'worker.stars-variable.bundle.js'),'utf8');
  for(const marker of ['supporter_badge_v1','/api/stars/supporter-badge',
   'STARS_VARIABLE_CREDIT_LEDGER_READY']){
   if(!bundle.includes(marker))throw Error('missing_badge_bundled_feature');
  }
  return {ok:true,staged:true,liveUnchanged:true,paymentsEnabled:false};
 }
 const backupDir=path.join(dir,BACKUP);
 await fs.mkdir(backupDir,{recursive:false,mode:0o700});
 for(const [name,original] of originals)
  await fs.writeFile(path.join(backupDir,name),original,{flag:'wx',mode:0o600});
 for(const [name,value] of planned)
  await fs.writeFile(path.join(dir,name),value,{
   flag:name==='supporter-badge.mjs'?'wx':'w',mode:0o600
  });
 return {ok:true,staged:true,liveUnchanged:true,paymentsEnabled:false};
}
async function main(){
 const folder=process.argv[2],mode=process.argv[3]||'--stage';
 if(!folder||!['--stage','--check'].includes(mode)||process.argv.length>4)
  throw Error('Usage: node payments/scripts/stage-supporter-badge.mjs "<private recovered bot>" --stage|--check');
 const token=process.env.CLOUDFLARE_API_TOKEN;
 if(typeof token!=='string'||token.length<15)
  throw Error('cloudflare_private_session_required');
 const result=await stageSupporterBadge(folder,token,mode==='--check');
 console.log(JSON.stringify(result));
 console.log('NOT DEPLOYED. Original bot/game and every payment flag preserved.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error('SUPPORTER BADGE STAGING BLOCKED:',e.message);process.exitCode=1;});
