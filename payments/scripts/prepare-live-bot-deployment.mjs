// RUST UP: prepare, but DO NOT deploy, a reviewed Wrangler configuration.
// Requires Workers Scripts Read token and a locally recovered bot source map.
// Refuses stale snapshots (e.g. another maintainer deployed in the meantime).
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseRecoveredModules} from './recover-live-bot-source.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const SCRIPT='rustup-bot';
const STATS_DB='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const PAYMENTS_DB='06079270-a227-466a-9991-abd4201ec5f6';
const hash=v=>createHash('sha256').update(v).digest('hex');

async function getCloudflare(pathname,token){
  const response=await fetch('https://api.cloudflare.com/client/v4'+pathname,{
    headers:{Authorization:'Bearer '+token},redirect:'error',
    signal:AbortSignal.timeout(20000)
  });
  if(!response.ok)throw Error('Cloudflare read failed (HTTP '+response.status+').');
  return response;
}
function quote(v){return JSON.stringify(v);}
export function buildSafeWranglerConfig(settings,schedules){
  const binds=settings?.bindings;
  if(!Array.isArray(binds))throw Error('cannot_check_existing_bindings');
  const byName=new Map(binds.map(b=>[b.name,b]));
  for(const s of ['BOT_TOKEN','WEBHOOK_SECRET','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN'])
    if(byName.get(s)?.type!=='secret_text')throw Error('secret_binding_missing_'+s);
  if(byName.get('DB')?.type!=='d1'||(byName.get('DB').id||byName.get('DB').database_id)!==STATS_DB)
    throw Error('game_database_binding_changed');
  if(byName.has('PAYMENTS_DB'))throw Error('existing_payments_db_binding_requires_review');
  const cron=(schedules?.schedules||[]).map(c=>c.cron);
  if(cron.length!==1||cron[0]!=='* * * * *')
    throw Error('unexpected_live_cron_schedule');
  if(settings.compatibility_date!=='2025-06-01')
    throw Error('worker_runtime_date_changed');
  if(Array.isArray(settings.compatibility_flags)&&settings.compatibility_flags.length)
    throw Error('worker_runtime_flags_changed');
  return [
    '# Local RUST UP admin-command release: do not commit this file.',
    '# Generated only after comparing all nine recovered source modules to live Cloudflare.',
    'name = '+quote(SCRIPT),
    'main = "./worker.payment-admin.bundle.js"',
    'compatibility_date = '+quote(settings.compatibility_date),
    'workers_dev = true',
    'keep_vars = true',
    '',
    '[triggers]',
    'crons = ["* * * * *"]',
    '',
    '[vars]',
    'PAYMENT_PRODUCTION_ENABLED = "false"',
    '',
    '[secrets]',
    'required = ["BOT_TOKEN", "WEBHOOK_SECRET", "ADMIN_BOT_TOKEN", "CLIPS_BOT_TOKEN"]',
    '',
    '[[d1_databases]]',
    'binding = "DB"',
    'database_name = "rustup-stats"',
    'database_id = '+quote(STATS_DB),
    '',
    '[[d1_databases]]',
    'binding = "PAYMENTS_DB"',
    'database_name = "rustup-stars-staging"',
    'database_id = '+quote(PAYMENTS_DB),
    ''
  ].join('\n');
}
export function verifySnapshot(current,manifest){
  if(manifest.worker!==SCRIPT||!Array.isArray(manifest.files)||manifest.files.length!==9)
    throw Error('invalid_local_recovery_manifest');
  for(const entry of manifest.files){
    const src=current.get(entry.name);
    if(typeof src!=='string'||hash(src)!==entry.sha256||
       Buffer.byteLength(src)!==entry.bytes)
      throw Error('live_bot_changed_since_recovery_'+entry.name);
  }
  return true;
}
async function main(){
  const arg=process.argv[2];
  if(!arg)throw Error('Usage: node payments/scripts/prepare-live-bot-deployment.mjs "<recovered-directory>"');
  const directory=await fs.realpath(path.resolve(arg));
  const requiredRoot=path.join(root,'.private','rustup-bot-recovered')+path.sep;
  if(!directory.startsWith(requiredRoot))throw Error('not_a_private_recovery_directory');
  const token=process.env.CLOUDFLARE_API_TOKEN;
  if(typeof token!=='string'||token.length<15)
    throw Error('Set a local Workers Scripts Read token in CLOUDFLARE_API_TOKEN.');
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'RECOVERY-MANIFEST.json'),'utf8'));
  const before=await fs.readFile(path.join(directory,'worker.before-payment-admin.js'),'utf8');
  const currentWorker=await fs.readFile(path.join(directory,'worker.js'),'utf8');
  const built=await fs.readFile(path.join(directory,'worker.payment-admin.bundle.js'),'utf8');
  const originalEntry=manifest.files.find(x=>x.name==='worker.js');
  if(!originalEntry||hash(before)!==originalEntry.sha256||!currentWorker.includes('RUSTUP_PAYMENT_ADMIN_HOOK'))
    throw Error('local_recovery_was_modified_or_not_patched');
  if(built.length<200000||!built.includes('handleExistingBotPaymentCommands'))
    throw Error('live_bundle_missing_payment_admin_hook');
  const base='/accounts/'+ACCOUNT+'/workers/scripts/'+SCRIPT;
  const [rawResponse,settingsResponse,schedulesResponse]=await Promise.all([
    getCloudflare(base+'/content/v2',token),
    getCloudflare(base+'/settings',token),
    getCloudflare(base+'/schedules',token)
  ]);
  const liveMap=parseRecoveredModules(await rawResponse.text(),
    rawResponse.headers.get('content-type')||'');
  verifySnapshot(liveMap,manifest);
  const s=await settingsResponse.json(),c=await schedulesResponse.json();
  if(s.success===false||c.success===false)
    throw Error('cloudflare_metadata_query_failed');
  const config=buildSafeWranglerConfig(s.result,c.result);
  const file=path.join(directory,'wrangler.rustup-bot.toml');
  // Repeated safety checks must not overwrite a hand-edited deploy config.
  // An existing identical config is safe; a different one is a hard stop.
  try {
    await fs.writeFile(file,config,{flag:'wx',mode:0o600});
  } catch (e) {
    if (e?.code!=='EEXIST') throw e;
    const existing=await fs.readFile(file,'utf8');
    if (existing!==config) throw Error('local_deploy_config_drift');
  }
  console.log('PASS: all 9 Cloudflare modules match the local recovery snapshot.');
  console.log('PASS: 4 bot secrets, existing game D1 and minute cron verified.');
  console.log('PASS: separate PAYMENTS_DB configured; PAYMENT_PRODUCTION_ENABLED=false.');
  console.log('Prepared local config:',file);
  console.log('No deployment performed. Current live bot and webhook remain unchanged.');
  console.log('NEXT: npx wrangler deploy --dry-run --config '+quote(file));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('Preflight BLOCKED:',e.message);process.exitCode=1;});
