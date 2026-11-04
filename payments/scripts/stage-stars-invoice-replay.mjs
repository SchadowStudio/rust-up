// Safely stage the latest Telegram Stars bridge into the already recovered bot.
// Does not touch original bot modules, credentials, live Worker or any switches.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const oldSha='576cd3e70f5bc0ee42144351b8b174780fe8b347';
const newSha='97066c6237f9be3c882724059ee0ee9b59779cec';
function gitSha(s){const b=Buffer.from(s.replace(/\r\n/g,'\n'));return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');}
async function main(){
 if(!process.argv[2])throw Error('Pass recovered private RUST-UP bot folder.');
 const dir=await fs.realpath(path.resolve(process.argv[2]));
 if(!dir.startsWith(path.join(root,'.private','rustup-bot-recovered')+path.sep))
  throw Error('not_recovered_private_bot_folder');
 await fs.access(path.join(dir,'worker.stars-entry.mjs'));
 const file=path.join(dir,'stars-live-bridge.mjs');
 const source=path.join(root,'payments','integration','telegram-stars','stars-live-bridge.mjs');
 const [before,after]=await Promise.all([fs.readFile(file,'utf8'),fs.readFile(source,'utf8')]);
 if(gitSha(after)!==newSha)throw Error('expected_source_version_changed_review_again');
 if(gitSha(before)===newSha){console.log('PASS: Current invoice-replay bridge already staged.');return;}
 if(gitSha(before)!==oldSha)throw Error('recovered_bot_bridge_version_drift_refuse');
 const backup=file+'.before-invoice-replay';
 try{await fs.access(backup);throw Error('existing_backup_refuse_overwrite');}
 catch(e){if(e.code!=='ENOENT')throw e;}
 await fs.copyFile(file,backup,fs.constants.COPYFILE_EXCL);
 await fs.copyFile(source,file);
 if(gitSha(await fs.readFile(file,'utf8'))!==newSha)throw Error('copy_not_verified');
 console.log('PASS: Stars invoice replay / precheckout hardening safely staged.');
 console.log('PASS: Backup .before-invoice-replay retained.');
 console.log('NOT DEPLOYED. Rebuild Worker and run offline + Cloudflare preflight.');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)
 main().catch(e=>{console.error('Stars upgrade BLOCKED:',e.message);process.exitCode=1;});
