// Second-phase security update for users who already ran
// refresh-staged-telegram-stars.mjs before the purchase-lock fix.
// Updates ONLY stars-live-bridge.mjs after exact Git blob identity checks.
// No Cloudflare deployment; source & bundle recovery snapshots are preserved.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const expectedOld='adce5a938f79f6284dfb72cf9791965d0457079a';
const expectedNew='576cd3e70f5bc0ee42144351b8b174780fe8b347';
function gitBlob(text){
 const v=Buffer.from(text.replace(/\r\n/g,'\n'));
 return createHash('sha1').update('blob '+v.length+'\0').update(v).digest('hex');
}
async function main(){
 const arg=process.argv[2];
 if(!arg)throw Error('Pass recovered private RUST UP worker directory.');
 const dir=await fs.realpath(path.resolve(arg));
 if(!dir.startsWith(path.join(root,'.private','rustup-bot-recovered')+path.sep))
  throw Error('outside_private_rustup_recovery');
 await fs.access(path.join(dir,'worker.stars-entry.mjs'));
 await fs.access(path.join(dir,'stars-live-bridge.mjs.before-miniapp'));
 const target=path.join(dir,'stars-live-bridge.mjs');
 const source=path.join(root,'payments','integration','telegram-stars','stars-live-bridge.mjs');
 const [oldText,newText]=await Promise.all([
  fs.readFile(target,'utf8'),fs.readFile(source,'utf8')
 ]);
 if(gitBlob(newText)!==expectedNew)throw Error('source_version_changed_verify_new_release');
 const actual=gitBlob(oldText);
 if(actual===expectedNew){
  console.log('PASS: Exact purchase-lock hardening already staged; no changes made.');
  return;
 }
 if(actual!==expectedOld)throw Error('old_staged_module_differs_refuse_overwrite');
 const backup=target+'.before-purchase-locks';
 try{await fs.access(backup);throw Error('backup_already_exists_refuse_overwrite');}
 catch(e){if(e.code!=='ENOENT')throw e;}
 await fs.copyFile(target,backup,fs.constants.COPYFILE_EXCL);
 await fs.copyFile(source,target);
 const verified=gitBlob(await fs.readFile(target,'utf8'));
 if(verified!==expectedNew)throw Error('staged_module_verification_failed');
 console.log('PASS: Atomic Stars invoice reservation code staged in private bot.');
 console.log('PASS: Original stars-live-bridge.mjs saved as .before-purchase-locks.');
 console.log('NOT DEPLOYED: rebuild and dry-run the existing worker bundle.');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)
 main().catch(e=>{console.error('Stars staging BLOCKED:',e.message);process.exitCode=1;});
