// Release only the corrected Stars JS asset to the EXISTING GitHub Pages Mini App.
// Never changes HTML routes, game, inventory, payments, admin or D1.
// Usage: node payments/scripts/publish-stars-session-refresh.mjs <clean website checkout> --check|--publish
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const NEW=path.join(ROOT,'frontend','telegram-miniapp','stars-readonly-v2.js');
const OLD_TTL=[
 '    const authDate=Number(new URLSearchParams(initData).get(\'auth_date\'));',
 '    const now=Math.floor(Date.now()/1000);',
 '    // Server accepts at most 600 seconds and up to 60 seconds future skew.',
 "    if(!Number.isSafeInteger(authDate)||authDate<now-600||authDate>now+60)",
 "      throw {code:'expired'};"
].join('\n')+'\n';
const NEW_TTL=[
 '    // Let the server validate auth_date and the Telegram HMAC signature.',
 '    // Browser clocks may be wrong and this Mini App can stay open for hours.',
 '    // Read-only server endpoints enforce a bounded TTL; payment gates stay OFF.'
].join('\n')+'\n';
const OLD_TAG='src="js/stars-readonly-v2.js?v=20261105s2"';
const NEW_TAG='src="js/stars-readonly-v2.js?v=20261105s3"';
function once(src,oldValue,newValue){
 const i=src.indexOf(oldValue);
 if(i<0||src.indexOf(oldValue,i+oldValue.length)>=0)
   throw Error('unexpected_website_version');
 return src.slice(0,i)+newValue+src.slice(i+oldValue.length);
}
const normalize=s=>s.replace(/\r\n/g,'\n');
export function patchSessionAsset(existing,current){
 const old=normalize(existing),newContent=normalize(current);
 if(!newContent.includes(NEW_TTL)||newContent.includes(OLD_TTL))
   throw Error('source_does_not_contain_secure_server_side_ttl_fix');
 const rebuiltOld=once(newContent,NEW_TTL,OLD_TTL);
 if(old===newContent)return existing;
 if(old!==rebuiltOld)throw Error('website_stars_js_drift');
 const replaced=newContent;
 return existing.includes('\r\n')?replaced.replace(/\n/g,'\r\n'):replaced;
}
export function patchSessionIndex(existing){
 if(existing.includes(NEW_TAG))return existing;
 return once(existing,OLD_TAG,NEW_TAG);
}
function git(cwd,...args){
 return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
}
function main(){
 const arg=process.argv[2],mode=process.argv[3]||'--check';
 if(!arg||!['--check','--publish'].includes(mode))
   throw Error('Usage: node payments/scripts/publish-stars-session-refresh.mjs "<clean website checkout>" --check|--publish');
 const dir=fs.realpathSync(path.resolve(arg));
 if(!fs.existsSync(path.join(dir,'.git')))throw Error('not_a_website_checkout');
 if(!/^(?:https:\/\/github\.com\/|git@github\.com:)ttzoomrust-hub\/rust-up(?:\.git)?\/?$/.test(git(dir,'remote','get-url','origin')))
   throw Error('wrong_website_remote');
 if(git(dir,'branch','--show-current')!=='main')throw Error('website_must_be_main');
 if(git(dir,'status','--porcelain'))throw Error('website_has_local_changes');
 if(mode==='--publish')git(dir,'pull','--ff-only','origin','main');
 const current=fs.readFileSync(NEW,'utf8');
 const asset=path.join(dir,'js','stars-readonly-v2.js');
 const indexFile=path.join(dir,'index.html');
 const oldAsset=fs.readFileSync(asset,'utf8');
 const oldIndex=fs.readFileSync(indexFile,'utf8');
 const newAsset=patchSessionAsset(oldAsset,current);
 const newIndex=patchSessionIndex(oldIndex);
 new Function(newAsset);
 if(!newAsset.includes('Telegram?.WebApp?.initData')||
    !newAsset.includes('/api/stars/')||
    newAsset.includes("if(!Number.isSafeInteger(authDate)"))
   throw Error('client_auth_patch_invalid');
 console.log('PASS: Only Stars client session check and cache-buster will change.');
 if(mode==='--check'){console.log('NOT PUBLISHED.');return;}
 if(newAsset===oldAsset&&newIndex===oldIndex){
   console.log('Already installed. No changes.');return;
 }
 try{
   fs.writeFileSync(asset,newAsset);
   fs.writeFileSync(indexFile,newIndex);
   execFileSync(process.execPath,['--check',asset],{stdio:'pipe'});
 }catch(error){
   fs.writeFileSync(asset,oldAsset);
   fs.writeFileSync(indexFile,oldIndex);
   throw Error('patch_failed_originals_restored: '+error.message);
 }
 git(dir,'add','--','js/stars-readonly-v2.js','index.html');
 git(dir,'commit','-m','Fix Telegram Stars read-only session expiry');
 git(dir,'push','origin','main');
 console.log('PASS: Session handling pushed to GitHub Pages main. Payment gates unchanged.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 try{main();}catch(error){console.error('STARS CLIENT RELEASE BLOCKED:',error.message);process.exitCode=1;}
