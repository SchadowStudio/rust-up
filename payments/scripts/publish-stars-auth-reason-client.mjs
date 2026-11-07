// Publish ONLY safe Stars 401 reason labels plus matching asset cache-buster.
// No Worker, checkout, credit, refund, or unrelated website writes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const REMOTE='https://github.com/ttzoomrust-hub/rust-up.git';
const ORIG_TAG='js/stars-deposit-v5.js?v=20261106depositstatus1';
const NEXT_TAG='js/stars-deposit-v5.js?v=20261106authreason1';
const SHAS={
 'index.html':'14679cce4a1c5bdc45a28955d7cf3e9f54503644',
 'js/stars-deposit-v5.js':'0a9193e545c810e4c319045e2c7d987df8358bdc'
};
function git(cwd,...args){
 return execFileSync('git',args,{cwd,encoding:'utf8',
  stdio:['ignore','pipe','pipe'],timeout:120000}).trim();
}
function once(src,old,next){
 if(src.split(old).length!==2)throw Error('unexpected_website_version');
 return src.replace(old,next);
}
function patchClient(src){
 const before="  if(e?.status===401){";
 const after=[
 "  if(e?.status===401){",
 "   if(e?.authReason==='expired')",
 "    return 'AUTH_EXPIRED: Сессия Telegram устарела. Полностью закройте мини-приложение и откройте его заново из /start.';",
 "   if(e?.authReason==='signature_or_format')",
 "    return 'AUTH_SIGNATURE: Telegram-подпись не прошла проверку. Проверьте, что RUST UP запущен из @rustuper_bot и токен Worker соответствует этому боту.';",
 "   if(e?.authReason==='user')",
 "    return 'AUTH_USER: Telegram не передал корректный идентификатор пользователя.';"
 ].join('\n');
 let output=once(src,before,after);
 const err="if(!resp.ok||data?.ok!==true)throw {status:resp.status,code:data?.error};";
 const revised="if(!resp.ok||data?.ok!==true)throw {status:resp.status,code:data?.error,authReason:data?.authReason};";
 output=once(output,err,revised);
 new Function(output);
 if(!output.includes('AUTH_SIGNATURE')||!output.includes('AUTH_EXPIRED')||
    !output.includes("credentials:'omit'")||!output.includes('window.Telegram?.WebApp?.initData'))
  throw Error('auth_client_safety_guard_missing');
 return output;
}
const mode=process.argv[2]||'--check';
if(!['--check','--publish'].includes(mode)||process.argv.length>3)
 throw Error('usage: --check | --publish');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rustup-401-client-'));
try{
 const site=path.join(temp,'site');
 execFileSync('git',['clone','--depth','1','--branch','main',REMOTE,site],{
  stdio:['ignore','pipe','pipe'],timeout:120000
 });
 if(git(site,'branch','--show-current')!=='main'||
    git(site,'status','--porcelain'))
  throw Error('unreviewed_website_checkout');
 for(const [file,hash] of Object.entries(SHAS)){
  if(git(site,'rev-parse','HEAD:'+file)!==hash)
   throw Error('website_drift_'+file);
 }
 const sourceFile=path.join(site,'js/stars-deposit-v5.js');
 const indexFile=path.join(site,'index.html');
 const oldSource=fs.readFileSync(sourceFile,'utf8');
 const oldIndex=fs.readFileSync(indexFile,'utf8');
 const nextSource=patchClient(oldSource);
 const nextIndex=once(oldIndex,ORIG_TAG,NEXT_TAG);
 if(!nextIndex.includes('Монеты, скины')||nextIndex.includes('stars-diagnostic-temp.js'))
  throw Error('website_integrity_failed');
 console.log('PASS: Client exposes only bounded auth reason. No payment changes.');
 if(mode==='--check'){console.log('NOT PUBLISHED.');}
 else {
  fs.writeFileSync(sourceFile,nextSource,'utf8');
  fs.writeFileSync(indexFile,nextIndex,'utf8');
  git(site,'add','--','js/stars-deposit-v5.js','index.html');
  git(site,'diff','--cached','--check');
  const files=git(site,'diff','--cached','--name-only').split(/\r?\n/).sort();
  if(JSON.stringify(files)!==JSON.stringify(Object.keys(SHAS).sort()))
   throw Error('unexpected_staged_files');
  git(site,'commit','-m','Show safe Telegram Stars auth rejection reason');
  git(site,'push','origin','main');
  console.log('PASS: Only Stars client and cache-buster published. Payments OFF.');
 }
}finally{fs.rmSync(temp,{recursive:true,force:true});}
