// RUST UP Telegram Mini App: always load official SDK before js/app.js.
// Fail-closed publisher: updates only two audited site files; no payment changes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const CLIENT=path.join(ROOT,'frontend','telegram-miniapp','stars-variable-wallet-v4.js');
const REMOTE='https://github.com/ttzoomrust-hub/rust-up.git';
const BASELINE={
 'index.html':'6a1bd44d05f01ec0531f32d444c4bc7087a407dc',
 'js/stars-variable-wallet-v4.js':'aac794a3d17a850a0979934ae9310a846ca53462'
};
const OLD=[
 '  <script>',
 '    // Telegram Mini App: Telegram passes tgWebAppData in the URL; only then load its SDK (keeps offline/browser use fast)',
 '    (function () {',
 "      var tg = /tgWebApp/.test(location.hash + location.search);",
 "      try { if (tg) sessionStorage.setItem('rustup_tg', '1'); else tg = sessionStorage.getItem('rustup_tg') === '1'; } catch (e) {}",
 "      if (tg) document.write('<script src=\"https://telegram.org/js/telegram-web-app.js\"><\\/script>');",
 '    })();',
 '  </script>'
].join('\n');
const NEW='  <script src="https://telegram.org/js/telegram-web-app.js?64"></script>';
const TAG0='js/stars-variable-wallet-v4.js?v=20261105supporter1';
const TAG1='js/stars-variable-wallet-v4.js?v=20261105telegramauth2';
const norm=s=>s.replace(/\r\n/g,'\n');
function replaceOnce(s,a,b){
 if(s.split(a).length!==2||s.includes(b))
  throw Error('unreviewed_telegram_sdk_or_cache_version');
 return s.replace(a,b);
}
export function patchTelegramHtml(raw){
 if(typeof raw!=='string')throw Error('invalid_telegram_html');
 if(raw.includes(NEW)&&raw.includes(TAG1)&&!raw.includes('rustup_tg'))return raw;
 const updated=replaceOnce(replaceOnce(norm(raw),OLD,NEW),TAG0,TAG1);
 if(updated.includes('rustup_tg')||updated.includes('document.write')||
   updated.indexOf('telegram-web-app.js?64')>=updated.indexOf('js/app.js?'))
  throw Error('unexpected_telegram_sdk_bootstrap');
 return updated;
}
export function verifyClient(js){
 if(typeof js!=='string'||js.length<9000)throw Error('unexpected_client_source');
 new Function(js);
 for(const part of [
  '/api/stars/variable/','/api/stars/supporter-badge',
  'Telegram не передал данные авторизации',
  'Сервер не подтвердил Telegram-сессию',
  'window.Telegram?.WebApp?.initData',
  'payButton.disabled=data.checkoutEnabled!==true',
  "credentials:'omit'"
 ])if(!js.includes(part))throw Error('client_auth_guard_missing');
 if(/innerHTML\s*=|eval\s*\(/.test(js))throw Error('unsafe_client_mutation');
 return true;
}
function git(cwd,...args){
 return execFileSync('git',args,{cwd,encoding:'utf8',
  stdio:['ignore','pipe','pipe'],timeout:60000}).trim();
}
function main(){
 const mode=process.argv[2]||'--check';
 if(!['--check','--publish'].includes(mode)||process.argv.length>3)
  throw Error('Usage: node payments/scripts/publish-telegram-initdata-bootstrap.mjs --check|--publish');
 const js=fs.readFileSync(CLIENT,'utf8');verifyClient(js);
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'rustup-tg-sdk-'));
 try{
  const site=path.join(work,'site');
  execFileSync('git',['clone','--depth','1','--branch','main',REMOTE,site],{
   stdio:['ignore','pipe','pipe'],timeout:120000
  });
  const remote=git(site,'remote','get-url','origin');
  if(!/^(?:https:\/\/github\.com\/|git@github\.com:)ttzoomrust-hub\/rust-up(?:\.git)?\/?$/.test(remote)||
   git(site,'branch','--show-current')!=='main'||git(site,'status','--porcelain'))
   throw Error('unreviewed_public_website');
  const html=fs.readFileSync(path.join(site,'index.html'),'utf8');
  const oldClient=fs.readFileSync(path.join(site,'js/stars-variable-wallet-v4.js'),'utf8');
  const patched=patchTelegramHtml(html);
  if(norm(html)===norm(patched)&&norm(oldClient)===norm(js)){
   console.log('PASS: Telegram SDK bootstrap already published.');return;
  }
  for(const [p,sha] of Object.entries(BASELINE))
   if(git(site,'rev-parse','HEAD:'+p)!==sha)
    throw Error('public_site_modified_'+p);
  if(mode==='--check'){
   console.log('PASS: Telegram SDK preload and differentiated 401 text ready.');
   console.log('NOT PUBLISHED.');return;
  }
  fs.writeFileSync(path.join(site,'index.html'),patched,'utf8');
  fs.writeFileSync(path.join(site,'js/stars-variable-wallet-v4.js'),js,'utf8');
  git(site,'add','--','index.html','js/stars-variable-wallet-v4.js');
  const changed=git(site,'diff','--cached','--name-only').split(/\r?\n/).sort();
  if(JSON.stringify(changed)!==JSON.stringify(Object.keys(BASELINE).sort()))
   throw Error('unreviewed_staged_files');
  git(site,'diff','--cached','--check');
  git(site,'commit','-m','Always load official Telegram WebApp SDK and clarify auth failures');
  git(site,'push','origin','main');
  console.log('PASS: Existing RUST UP Mini App Telegram SDK fix published.');
  console.log('No real payments, no bot redeploy, no game balance changes.');
 }finally{fs.rmSync(work,{force:true,recursive:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 try{main();}catch(e){
  console.error('RUST UP TELEGRAM SDK PUBLISH BLOCKED:',e.message);
  process.exitCode=1;
 }
