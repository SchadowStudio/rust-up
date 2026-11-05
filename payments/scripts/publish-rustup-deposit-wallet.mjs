// One-command publisher for RUST UP's EXISTING Telegram Mini App:
// replace unwanted Supporter UI with a clean, variable-RUB Stars deposit panel.
// Correct the conditional Telegram SDK bootstrap at the same time.
// PAYMENT CHECKOUT REMAINS BLOCKED BY BACKEND GATES; no money or game credits.
// Publishes only 2 new website assets + public index.html after exact git checks.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const FRONT=path.join(ROOT,'frontend','telegram-miniapp');
const REMOTE='https://github.com/ttzoomrust-hub/rust-up.git';
const HTML_SHA='6a1bd44d05f01ec0531f32d444c4bc7087a407dc';
const JS='js/stars-deposit-v5.js',CSS='css/stars-deposit-v5.css';
const SRCJS=path.join(FRONT,'stars-deposit-v5.js');
const SRCCSS=path.join(FRONT,'stars-deposit-v5.css');
const OLD_BOOT=[
 '  <script>',
 '    // Telegram Mini App: Telegram passes tgWebAppData in the URL; only then load its SDK (keeps offline/browser use fast)',
 '    (function () {',
 '      var tg = /tgWebApp/.test(location.hash + location.search);',
 "      try { if (tg) sessionStorage.setItem('rustup_tg', '1'); else tg = sessionStorage.getItem('rustup_tg') === '1'; } catch (e) {}",
 "      if (tg) document.write('<script src=\"https://telegram.org/js/telegram-web-app.js\"><\\/script>');",
 '    })();',
 '  </script>'
].join('\n');
const NEW_BOOT='  <script src="https://telegram.org/js/telegram-web-app.js?64"></script>';
const OLD_JS='<script src="js/stars-variable-wallet-v4.js?v=20261105supporter1"></script>';
const NEW_JS='<script src="js/stars-deposit-v5.js?v=20261105deposit1"></script>';
const OLD_CSS='<link rel="stylesheet" href="css/stars-variable-wallet-v4.css?v=20261105supporter1">';
const NEW_CSS='<link rel="stylesheet" href="css/stars-deposit-v5.css?v=20261105deposit1">';
const nl=s=>s.replace(/\r\n/g,'\n');
function once(s,a,b){
 if(s.split(a).length!==2||s.includes(b))throw Error('unexpected_public_site_change');
 return s.replace(a,b);
}
export function patchDepositHtml(s){
 if(typeof s!=='string'||s.length<100)throw Error('invalid_site_html');
 if(s.includes(NEW_JS)&&s.includes(NEW_CSS)&&s.includes(NEW_BOOT)&&
   !s.includes('rustup_tg'))return s;
 const src=nl(s);
 const patched=once(once(once(src,OLD_BOOT,NEW_BOOT),OLD_JS,NEW_JS),OLD_CSS,NEW_CSS);
 if(patched.includes('document.write')||patched.includes('rustup_tg')||
    patched.indexOf(NEW_BOOT)>patched.indexOf(NEW_JS))
  throw Error('telegram_sdk_bootstrap_unverified');
 return patched;
}
export function verifyDepositAssets(js,css){
 if(typeof js!=='string'||js.length<7000||typeof css!=='string'||css.length<300)
  throw Error('invalid_deposit_asset');
 new Function(js);
 for(const x of [
  'RUSTUP_STARS_VARIABLE_V4',
  "request('quote'",
  "request('history'",
  "request('checkout'",
  'payButton.disabled=data.checkoutEnabled!==true',
  'window.Telegram?.WebApp?.initData',
  'Telegram не передал данные авторизации',
  'Сервер не подтвердил Telegram-сессию',
  "credentials:'omit'",
  'creditedToGame!==false'
 ])if(!js.includes(x))throw Error('required_deposit_safety_marker_missing');
 if(js.includes('rustup-supporter-status')||
  js.includes('/api/stars/supporter-badge')||
  css.includes('rustup-supporter-status')||
  /innerHTML\s*=|eval\s*\(/.test(js))throw Error('unwanted_badge_or_insecure_js');
 if(!css.includes('.rustup-amount-input'))throw Error('amount_input_style_missing');
 return true;
}
function git(cwd,...args){
 return execFileSync('git',args,{cwd,encoding:'utf8',
  stdio:['ignore','pipe','pipe'],timeout:120000}).trim();
}
function main(){
 const mode=process.argv[2]||'--check';
 if(!['--check','--publish'].includes(mode)||process.argv.length>3)
  throw Error('Usage: node payments/scripts/publish-rustup-deposit-wallet.mjs --check|--publish');
 const js=fs.readFileSync(SRCJS,'utf8');
 const css=fs.readFileSync(SRCCSS,'utf8');
 verifyDepositAssets(js,css);
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rustup-stars-deposit-'));
 try{
  const site=path.join(tmp,'site');
  execFileSync('git',['clone','--depth','1','--branch','main',REMOTE,site],{
   stdio:['ignore','pipe','pipe'],timeout:120000
  });
  const origin=git(site,'remote','get-url','origin');
  if(!/^(?:https:\/\/github\.com\/|git@github\.com:)ttzoomrust-hub\/rust-up(?:\.git)?\/?$/.test(origin)||
     git(site,'branch','--show-current')!=='main'||
     git(site,'status','--porcelain'))
   throw Error('unexpected_website_checkout');
  const html=fs.readFileSync(path.join(site,'index.html'),'utf8');
  const changed=patchDepositHtml(html);
  const files=[[JS,js],[CSS,css]];
  const isIdentical=nl(html)===nl(changed)&&files.every(([file,value])=>
   fs.existsSync(path.join(site,file))&&
   nl(fs.readFileSync(path.join(site,file),'utf8'))===nl(value));
  if(isIdentical){
   console.log('PASS: Clean Stars deposit UI and Telegram SDK already published.');
   return;
  }
  if(git(site,'rev-parse','HEAD:index.html')!==HTML_SHA)
   throw Error('public_index_changed_manual_review_required');
  for(const [file] of files)if(fs.existsSync(path.join(site,file)))
   throw Error('destination_asset_already_exists_'+file);
  if(mode==='--check'){
   console.log('PASS: Existing site reviewed, clean Stars deposit panel ready.');
   console.log('NOT PUBLISHED. No payment gates changed.');
   return;
  }
  fs.writeFileSync(path.join(site,'index.html'),changed,'utf8');
  for(const [file,value] of files)
   fs.writeFileSync(path.join(site,file),value,'utf8');
  git(site,'add','--','index.html',JS,CSS);
  const names=git(site,'diff','--cached','--name-only').split(/\r?\n/).sort();
  if(JSON.stringify(names)!==JSON.stringify(['index.html',JS,CSS].sort()))
   throw Error('unexpected_website_file_change');
  git(site,'diff','--cached','--check');
  git(site,'commit','-m',
   'Show variable RUB Stars deposit without Supporter and initialize Telegram SDK');
  git(site,'push','origin','main');
  console.log('PASS: Clean RUST UP Stars deposit interface published on existing Mini App.');
  console.log('No real invoices enabled, no Telegram tokens changed, no game balance credited.');
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 try{main();}catch(e){
  console.error('RUST UP DEPOSIT UI PUBLISH BLOCKED:',String(e?.message||e));
  process.exitCode=1;
 }
