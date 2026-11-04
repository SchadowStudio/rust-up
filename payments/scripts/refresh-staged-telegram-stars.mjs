// Safely refresh ONLY previously staged Telegram Stars integration modules.
// Does not touch original worker.js, /pay, credentials, GitHub Pages or Cloudflare.
// Protects the originals in once-only .before-miniapp files for rollback.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const src=path.join(root,'payments','integration','telegram-stars');
const files=[
 ['stars.mjs','export async function handleStarsUpdate'],
 ['stars-live-bridge.mjs','export async function existingBotStarsApi'],
 ['stars-existing-worker-wrapper.mjs','export function wrapExistingWorker'],
 ['worker.stars-entry.mjs','wrapExistingWorker']
];
async function main(){
 const arg=process.argv[2];
 if(!arg)throw Error('Usage: node payments/scripts/refresh-staged-telegram-stars.mjs "<private-recovery-folder>"');
 const dir=await fs.realpath(path.resolve(arg));
 if(!dir.startsWith(path.join(root,'.private','rustup-bot-recovered')+path.sep))
  throw Error('outside_private_recovery_folder');
 const refundModule=path.join(dir,'refunds.mjs');
 try{await fs.access(refundModule);throw Error('refunds_module_already_staged');}
 catch(e){if(e.code!=='ENOENT')throw e;}
 await fs.access(path.join(src,'refunds.mjs'));
 const worker=await fs.readFile(path.join(dir,'worker.js'),'utf8');
 if(!worker.includes('RUSTUP_PAYMENT_ADMIN_HOOK'))
  throw Error('existing_pay_bot_worker_missing');
 for(const [name,marker] of files){
  const current=await fs.readFile(path.join(dir,name),'utf8');
  if(!current.includes(marker))throw Error('unexpected_existing_staged_module_'+name);
  try{
   await fs.access(path.join(dir,name+'.before-miniapp'));
   throw Error('miniapp_refresh_already_performed_'+name);
  }catch(e){if(e.code!=='ENOENT')throw e;}
  await fs.access(path.join(src,name));
 }
 // All critical checks pass; take per-file rollback copies before refreshing.
 for(const [name] of files){
  await fs.copyFile(path.join(dir,name),path.join(dir,name+'.before-miniapp'),fs.constants.COPYFILE_EXCL);
  await fs.copyFile(path.join(src,name),path.join(dir,name));
 }
 await fs.copyFile(path.join(src,'refunds.mjs'),refundModule,fs.constants.COPYFILE_EXCL);
 console.log('PASS: Telegram Stars worker modules refreshed for existing Mini App wallet.');
 console.log('PASS: Reversible backups .before-miniapp saved. Existing /pay and game source unchanged.');
 console.log('NOT DEPLOYED. Rebuild worker.stars-entry.mjs and check bundle before any release.');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)
 main().catch(e=>{console.error('Stars refresh BLOCKED:',e.message);process.exitCode=1;});
