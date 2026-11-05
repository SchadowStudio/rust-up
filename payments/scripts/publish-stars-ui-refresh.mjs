// RUST UP: safely refresh only the amount entry and payment history UI.
// Never changes backend, creates invoices, enables payment flags, or credits game state.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const FILE='js/stars-variable-wallet-v4.js';
const BEFORE_SHA='7348c7c5e5c4df4920cf2f465bd268131a614c3f';
const OLD='src="js/stars-variable-wallet-v4.js?v=20261105variable4"';
const NEW='src="js/stars-variable-wallet-v4.js?v=20261105variable4h"';
function git(cwd,...args){
 return execFileSync('git',args,{cwd,encoding:'utf8',
  stdio:['ignore','pipe','pipe']}).trim();
}
export function patchStarsHtml(html){
 if(html.includes(NEW))return html;
 const start=html.indexOf(OLD);
 if(start<0||html.indexOf(OLD,start+OLD.length)>=0)
  throw Error('unexpected_live_stars_script_version');
 return html.slice(0,start)+NEW+html.slice(start+OLD.length);
}
export function validateNewStarsUi(js){
 if(typeof js!=='string'||js.length<5000)
  throw Error('invalid_stars_ui_source');
 new Function(js);
 for(const word of [
  'RUSTUP_STARS_VARIABLE_V4','parseAmountMinor','historyBusy',
  'Оплата подтверждена','Проверяется поддержкой',
  "input.addEventListener('input',reset)"
 ]){
  if(!js.includes(word))throw Error('missing_safe_stars_ui_feature');
 }
 if(/(?:state|balance)\s*\.\s*balance\s*(?:=|\+=)/.test(js))
  throw Error('game_balance_write_in_ui');
 return true;
}
function main(){
 const folder=process.argv[2],mode=process.argv[3]||'--check';
 if(!folder||!['--check','--publish'].includes(mode))
  throw Error('Usage: node payments/scripts/publish-stars-ui-refresh.mjs "<clean website clone>" --check|--publish');
 const dir=fs.realpathSync(path.resolve(folder));
 if(!fs.existsSync(path.join(dir,'.git')))throw Error('website_checkout_not_found');
 if(!/^(?:https:\/\/github\.com\/|git@github\.com:)ttzoomrust-hub\/rust-up(?:\.git)?\/?$/.test(
   git(dir,'remote','get-url','origin')))
  throw Error('wrong_website_repository');
 if(git(dir,'branch','--show-current')!=='main')throw Error('wrong_branch');
 if(git(dir,'status','--porcelain'))throw Error('uncommitted_website_changes');
 if(mode==='--publish')git(dir,'pull','--ff-only','origin','main');
 const live=path.join(dir,FILE);
 const htmlPath=path.join(dir,'index.html');
 const before=fs.readFileSync(live,'utf8');
 const html=fs.readFileSync(htmlPath,'utf8');
 const updated=fs.readFileSync(path.join(ROOT,
  'frontend','telegram-miniapp','stars-variable-wallet-v4.js'),'utf8');
 validateNewStarsUi(updated);
 const normalize=x=>x.replace(/\r\n/g,'\n');
 const isCurrent=normalize(before)===normalize(updated);
 // Git object SHA ignores Windows checkout CRLF transformations.
 const sha=git(dir,'rev-parse','HEAD:'+FILE);
 if(!isCurrent&&sha!==BEFORE_SHA)throw Error('unexpected_live_stars_asset_sha');
 const nextHtml=patchStarsHtml(html);
 if(isCurrent&&nextHtml===html){
  console.log('PASS: Latest Stars amount UI already published.');return;
 }
 if(nextHtml===html&&!isCurrent)throw Error('updated_asset_with_stale_cache_key');
 if(!html.includes('window.RUSTUP_STARS_VARIABLE_V4')&&
    !fs.readFileSync(path.join(dir,'js','app.js'),'utf8').includes(
      'window.RUSTUP_STARS_VARIABLE_V4?.render(box)'))
  throw Error('wallet_mount_missing');
 console.log('PASS: GitHub Pages only needs Stars UI asset + browser cache update.');
 if(mode==='--check'){console.log('NOT PUBLISHED.');return;}
 try{
  fs.writeFileSync(live,updated);
  fs.writeFileSync(htmlPath,nextHtml);
  execFileSync(process.execPath,['--check',live],{stdio:'pipe'});
 }catch(e){
  fs.writeFileSync(live,before);
  fs.writeFileSync(htmlPath,html);
  throw Error('restore_after_update_failure: '+e.message);
 }
 git(dir,'add','--',FILE,'index.html');
 git(dir,'commit','-m','Improve variable Stars amount and purchase history user experience');
 git(dir,'push','origin','main');
 console.log('PASS: Safe Stars UI refresh pushed to existing GitHub Pages.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 try{main();}catch(e){console.error('STARS UI UPDATE BLOCKED:',e.message);process.exitCode=1;}
