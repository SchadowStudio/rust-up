// Copy the Stars integration into a reviewed PRIVATE local recovery folder.
// This script NEVER uploads, deploys, modifies live Cloudflare resources,
// changes /pay or the original Worker source files.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const bridge=path.join(root,'payments','integration','telegram-stars');
const names=[
 ['worker.stars-entry.mjs','worker.stars-entry.mjs'],
 ['stars-existing-worker-wrapper.mjs','stars-existing-worker-wrapper.mjs'],
 ['stars-live-bridge.mjs','stars-live-bridge.mjs'],
 ['stars.mjs','stars.mjs'],
 ['telegram-initdata.mjs','telegram-initdata.mjs']
];
async function main(){
 const arg=process.argv[2];
 if(!arg)throw Error('Usage: node payments/scripts/prepare-stars-recovered-worker.mjs "<private-recovery-folder>"');
 const dir=await fs.realpath(path.resolve(arg));
 if(!dir.startsWith(path.join(root,'.private','rustup-bot-recovered')+path.sep))
   throw Error('not_a_private_recovered_worker_folder');
 const original=await fs.readFile(path.join(dir,'worker.js'),'utf8');
 if(!original.includes('RUSTUP_PAYMENT_ADMIN_HOOK'))
  throw Error('existing_pay_command_integration_missing');
 const admin=await fs.readFile(path.join(dir,'admin.js'),'utf8');
 if(!admin.includes('RUSTUP_PAYMENT_MINI_APP'))
  throw Error('original_admin_panel_integration_missing');
 await fs.access(path.join(dir,'payment-controls.mjs'));
 await fs.access(path.join(dir,'worker.payment-admin.bundle.js'));
 const expected=path.join(dir,'worker.before-stars.bundle.js');
 for(const target of [...names.map(x=>x[1]),'worker.before-stars.bundle.js']){
  try{await fs.access(path.join(dir,target));throw Error('stars_bundle_already_prepared_or_partial_'+target);}
  catch(e){if(e.code!=='ENOENT')throw e;}
 }
 for(const [source,target] of names)
  await fs.copyFile(path.join(bridge,source),path.join(dir,target),fs.constants.COPYFILE_EXCL);
 await fs.copyFile(path.join(dir,'worker.payment-admin.bundle.js'),expected,fs.constants.COPYFILE_EXCL);
 console.log('PASS: Original /pay, Telegram admin, support, game and cron source preserved.');
 console.log('PASS: Standalone Stars wrapper and adapters staged in private recovery directory.');
 console.log('NEXT: npx --yes esbuild "'+path.join(dir,'worker.stars-entry.mjs')+
  '" --bundle --platform=browser --format=esm --target=es2022 --outfile="'+
  path.join(dir,'worker.payment-admin.bundle.js')+'"');
 console.log('NOT DEPLOYED. PAYMENT_PRODUCTION_ENABLED=false remains unchanged.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error('Stars integration BLOCKED:',e.message);process.exitCode=1;});
