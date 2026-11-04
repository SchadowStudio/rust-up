// Prepare a local recovered RUST UP bot for a reviewed deployment.
// Does NOT deploy to Cloudflare or alter any existing Worker settings.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const bridge=path.join(root,'payments','integration','telegram-stars');
const MARKER='async function onUpdate(upd, env) {\n';
const BLOCK=`  // RUSTUP_PAYMENT_ADMIN_HOOK: existing /tg webhook authenticates this update.\n  if (await handleExistingBotPaymentCommands(upd, env, {isAdmin, telegramApi:tg})) return;\n`;
export function patchOriginalBot(source){
  if(typeof source!=='string'||!source.includes(MARKER)||
     source.split(MARKER).length!==2)
    throw Error('original_bot_handler_not_found_exactly_once');
  if(source.includes('RUSTUP_PAYMENT_ADMIN_HOOK')||
     source.includes("handleExistingBotPaymentCommands"))
    throw Error('payment_admin_hook_already_present');
  if(!source.includes("from './admin.js'")||
     !source.includes('isAdmin(env,')||
     !source.includes("'/tg'")&&!source.includes('"/tg"'))
    throw Error('unsupported_original_bot_source');
  return "import {handleExistingBotPaymentCommands} from './live-bot-hook.mjs';\n"+
    source.replace(MARKER,MARKER+BLOCK);
}
async function main(){
  const target=process.argv[2];
  if(!target)throw Error('Usage: node payments/scripts/patch-recovered-live-bot.mjs "<local-recovered-bot-directory>"');
  const directory=await fs.realpath(path.resolve(target));
  const allowed=path.join(root,'.private','rustup-bot-recovered')+path.sep;
  if(!directory.startsWith(allowed))throw Error('Refusing to patch outside local private recovery directory');
  const worker=path.join(directory,'worker.js');
  const source=await fs.readFile(worker,'utf8');
  const updated=patchOriginalBot(source);
  for(const name of ['live-bot-hook.mjs','payment-controls.mjs']){
    await fs.copyFile(path.join(bridge,name),path.join(directory,name),fs.constants.COPYFILE_EXCL);
  }
  await fs.writeFile(path.join(directory,'worker.before-payment-admin.js'),source,{
    flag:'wx',mode:0o600
  });
  await fs.writeFile(worker,updated,{mode:0o600});
  console.log('Prepared recovered bot source with /pay commands.');
  console.log('Existing webhook /tg, game API routes and /tgc /tga are preserved.');
  console.log('NOT DEPLOYED: add PAYMENTS_DB staging binding and keep production payment gates false.');
  console.log('Review the changes and run a full build before any deployment.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('Patch failed:',e.message);process.exitCode=1;});
