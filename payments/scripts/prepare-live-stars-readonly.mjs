// Prepare the EXACT newest recovered RUST UP Worker with read-only Stars routes.
// Do NOT deploy here. No secrets or live bot source are committed to GitHub.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseRecoveredModules} from './recover-live-bot-source.mjs';
import {buildSafeWranglerConfig,verifySnapshot,writeConfigIfUnchanged}
 from './prepare-live-bot-deployment.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.private','rustup-bot-recovered')+path.sep;
const API='https://api.cloudflare.com/client/v4';
const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const SCRIPT='rustup-bot';
const COPIES=[
  ['worker.stars-readonly-entry.mjs','worker.stars-readonly-entry.mjs'],
  ['stars-readonly-live.mjs','stars-readonly-live.mjs'],
  ['telegram-initdata.mjs','telegram-initdata.mjs']
];
function safeConfig(s,c){
  let raw=buildSafeWranglerConfig(s,c);
  const old='main = "./worker.payment-admin.bundle.js"';
  if(!raw.includes(old))throw Error('wrangler_config_template_changed');
  raw=raw.replace(old,'main = "./worker.stars-readonly.bundle.js"');
  // Require Cloudflare to store a recoverable source map with each upload.
  raw=raw.replace('keep_vars = true','keep_vars = true\nupload_source_maps = true');
  const gate='PAYMENT_PRODUCTION_ENABLED = "false"';
  if(!raw.includes(gate))throw Error('production_gate_missing');
  raw=raw.replace(gate,gate+'\nSTARS_PAYMENT_ENABLED = "false"'+
     '\nSTARS_FIXED_PRODUCTS_ENABLED = "false"'+
     '\nSTARS_REFUNDS_ENABLED = "false"');
  return raw.replace('# Local RUST UP admin-command release',
    '# Local RUST UP read-only Stars API release');
}
async function get(pathname,token){
 const res=await fetch(API+pathname,{
   headers:{authorization:'Bearer '+token},redirect:'error',
   signal:AbortSignal.timeout(25000)
 });
 if(!res.ok)throw Error('cloudflare_read_failed_http_'+res.status);
 return res;
}
async function inspect(dir,token){
 const manifest=JSON.parse(await fs.readFile(path.join(dir,'RECOVERY-MANIFEST.json'),'utf8'));
 const base='/accounts/'+ACCOUNT+'/workers/scripts/'+SCRIPT;
 const [source,settings,schedules]=await Promise.all([
   get(base+'/content/v2',token),get(base+'/settings',token),get(base+'/schedules',token)
 ]);
 const current=parseRecoveredModules(await source.text(),source.headers.get('content-type')||'');
 verifySnapshot(current,manifest);
 const s=await settings.json(),c=await schedules.json();
 if(s.success===false||c.success===false)throw Error('cloudflare_metadata_failed');
 const config=safeConfig(s.result,c.result);
 for(const flag of ['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
   'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED'])
   if(!config.includes(flag+' = "false"'))throw Error('unsafe_payment_gate_'+flag);
 return config;
}
async function main(){
 const arg=process.argv[2],check=process.argv[3]==='--check-live';
 if(!arg||process.argv.length>4||(process.argv[3]&&!check))
   throw Error('Usage: node payments/scripts/prepare-live-stars-readonly.mjs "<private recovery folder>" [--check-live]');
 const dir=await fs.realpath(path.resolve(arg));
 if(!dir.startsWith(PRIVATE))throw Error('not_private_recovery_directory');
 const token=process.env.CLOUDFLARE_API_TOKEN;
 if(typeof token!=='string'||token.length<15)
   throw Error('CLOUDFLARE_API_TOKEN must be set locally (never paste it into chat)');
 const config=await inspect(dir,token);
 const configFile=path.join(dir,'wrangler.stars-readonly.toml');
 if(check){
   if(await fs.readFile(configFile,'utf8')!==config)throw Error('local_config_changed');
   const bundle=await fs.readFile(path.join(dir,'worker.stars-readonly.bundle.js'),'utf8');
   if(!bundle.includes('rustup-stars-readonly')||
      !bundle.includes('stars_checkout_disabled')||!bundle.includes('/api/game'))
      throw Error('unexpected_readonly_bundle_missing_routes');
   console.log('PASS: Current live Worker still matches the original recovered snapshot.');
   console.log('PASS: Only read-only Stars endpoints staged; all payment gates OFF.');
   return;
 }
 for(const [source,dest] of COPIES){
   const from=path.join(ROOT,'payments','integration','telegram-stars',source);
   await fs.copyFile(from,path.join(dir,dest),fs.constants.COPYFILE_EXCL);
 }
 await writeConfigIfUnchanged(configFile,config);
 console.log('PASS: All 9 current live bot modules match the private snapshot.');
 console.log('PASS: Existing game/admin webhook, D1, four secrets and cron verified.');
 console.log('PASS: Read-only Stars module staged; real payment gates explicitly OFF.');
 console.log('Private entry:',path.join(dir,'worker.stars-readonly-entry.mjs'));
 console.log('Private Wrangler config:',configFile);
 console.log('NOT DEPLOYED');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error('STARS READONLY RELEASE BLOCKED:',e.message);process.exitCode=1;});
