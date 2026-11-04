// Production preflight for adding /api/adm/payments* to already deployed /pay worker.
// Requires a read-only Cloudflare token; makes ZERO changes to Cloudflare.
// Hard stop if a concurrent deployment or binding change is detected.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const account='af72e32cb9f1ba99dba07df30fe540fe';
const expectedVersion='5bb816ee-965b-49a5-9493-f05bea973e67';
const gameDB='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const paymentsDB='06079270-a227-466a-9991-abd4201ec5f6';
const digest=x=>createHash('sha256').update(x).digest('hex');
export function checkLivePaymentPanelDeployment(deploy,settings,schedule){
 const live=deploy?.deployments?.[0]?.versions?.[0]?.version_id;
 if(live!==expectedVersion)throw Error('live_worker_version_changed_reload_latest_sources');
 const byName=new Map((settings?.bindings||[]).map(b=>[b.name,b]));
 for(const name of ['BOT_TOKEN','WEBHOOK_SECRET','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN'])
  if(byName.get(name)?.type!=='secret_text')throw Error('missing_bot_secret_'+name);
 for(const [name,id] of [['DB',gameDB],['PAYMENTS_DB',paymentsDB]]){
  const b=byName.get(name);
  if(b?.type!=='d1'||(b.id||b.database_id)!==id)throw Error('database_binding_changed_'+name);
 }
 if(byName.get('PAYMENT_PRODUCTION_ENABLED')?.text!=='false')throw Error('production_payment_gate_is_not_false');
 if(settings.compatibility_date!=='2025-06-01')throw Error('runtime_changed');
 const cron=schedule?.schedules||[];
 if(cron.length!==1||cron[0].cron!=='* * * * *')throw Error('cron_changed');
 return true;
}
async function api(pathname,token){
 const r=await fetch('https://api.cloudflare.com/client/v4'+pathname,{
  headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)
 });
 if(!r.ok)throw Error('Cloudflare API HTTP '+r.status);
 const body=await r.json();
 if(body.success!==true)throw Error('Cloudflare request unsuccessful');
 return body.result;
}
async function main(){
 const target=process.argv[2];
 if(!target)throw Error('Pass the local recovered bot folder.');
 const folder=await fs.realpath(path.resolve(target));
 if(!folder.startsWith(path.join(root,'.private','rustup-bot-recovered')+path.sep))
  throw Error('outside_private_folder');
 const token=process.env.CLOUDFLARE_API_TOKEN;
 if(!token)throw Error('Read-only CLOUDFLARE_API_TOKEN required.');
 const [manifest,worker,admin,bundle,config]=await Promise.all([
  fs.readFile(path.join(folder,'RECOVERY-MANIFEST.json'),'utf8').then(JSON.parse),
  fs.readFile(path.join(folder,'worker.js'),'utf8'),
  fs.readFile(path.join(folder,'admin.before-payment-panel.js'),'utf8'),
  fs.readFile(path.join(folder,'worker.payment-admin.bundle.js'),'utf8'),
  fs.readFile(path.join(folder,'wrangler.rustup-bot.toml'),'utf8')
 ]);
 const snapshot=manifest.files.find(f=>f.name==='admin.js');
 if(!snapshot||snapshot.sha256!==digest(admin))throw Error('original_admin_source_not_verified');
 if(!worker.includes('RUSTUP_PAYMENT_ADMIN_HOOK')||
    !bundle.includes('handleAdminPaymentPanelApi')||
    !bundle.includes('RUSTUP_PAYMENT_MINI_APP'))
  throw Error('missing_payments_panel_in_new_bundle');
 if(!config.includes('PAYMENT_PRODUCTION_ENABLED = "false"')||
    !config.includes('binding = "PAYMENTS_DB"')||
    !config.includes('keep_vars = true'))throw Error('unsafe_local_wrangler_configuration');
 const base='/accounts/'+account+'/workers/scripts/rustup-bot';
 const [live,settings,cron]=await Promise.all([
  api(base+'/deployments',token),api(base+'/settings',token),api(base+'/schedules',token)
 ]);
 checkLivePaymentPanelDeployment(live,settings,cron);
 console.log('PASS: live worker deployment has not changed.');
 console.log('PASS: all bot secrets, two D1 bindings, production OFF and cron verified.');
 console.log('PASS: recovered admin source and new payment UI API hook verified.');
 console.log('NOT DEPLOYED. The Admin Mini App frontend is staged separately.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error('Release BLOCKED:',e.message);process.exitCode=1;});
