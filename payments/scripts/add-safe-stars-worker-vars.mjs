// Safe fail-closed Stars environment defaults for the private Wrangler config.
// This DOES NOT enable payment or deploy. It keeps existing secrets and bindings.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const flags=['STARS_PAYMENT_ENABLED','STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED'];
async function main(){
 const arg=process.argv[2];
 if(!arg)throw Error('Pass the local private RUST UP Worker recovery directory.');
 const dir=await fs.realpath(path.resolve(arg));
 if(!dir.startsWith(path.join(root,'.private','rustup-bot-recovered')+path.sep))
  throw Error('not_a_private_recovered_worker');
 const file=path.join(dir,'wrangler.rustup-bot.toml');
 const current=await fs.readFile(file,'utf8');
 for(const must of ['name = "rustup-bot"','PAYMENT_PRODUCTION_ENABLED = "false"','keep_vars = true','binding = "PAYMENTS_DB"']){
  if(!current.includes(must))throw Error('unsafe_wrangler_file_missing_'+must.split(' ')[0]);
 }
 if(flags.every(f=>current.includes(f+' = "false"'))){
  console.log('PASS: All Stars environment flags already explicitly OFF.');
  return;
 }
 if(flags.some(f=>current.includes(f+' = ')))throw Error('unsafe_existing_stars_flag_detected');
 const newline=current.includes('\r\n')?'\r\n':'\n';
 const key='PAYMENT_PRODUCTION_ENABLED = "false"';
 if(current.split(key).length!==2)throw Error('duplicate_or_missing_production_gate');
 const changed=current.replace(key,key+newline+flags.map(f=>f+' = "false"').join(newline));
 const backup=file+'.before-stars-flags';
 try{await fs.access(backup);throw Error('backup_already_exists_refuse_overwrite');}
 catch(e){if(e.code!=='ENOENT')throw e;}
 await fs.copyFile(file,backup,fs.constants.COPYFILE_EXCL);
 await fs.writeFile(file,changed);
 console.log('PASS: Three explicit Stars flags OFF in private Wrangler config.');
 console.log('PASS: No production gate, secrets, databases or cron changed.');
 console.log('NOT DEPLOYED: Run local Worker validation and Wrangler --dry-run.');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)
 main().catch(e=>{console.error('Safe env flags BLOCKED:',e.message);process.exitCode=1;});
