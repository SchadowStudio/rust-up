// RUST UP: publish the read-only Supporter badge in the EXISTING Mini App.
// This tool never touches the game wallet, checkout, BotFather title or Worker.
// Requires local git PUSH access to ttzoomrust-hub/rust-up; GitHub connector
// used for development may not have that separate account's write permission.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SRC=path.join(ROOT,'frontend','telegram-miniapp');
const PUBLIC='https://github.com/ttzoomrust-hub/rust-up.git';
const JS='js/stars-variable-wallet-v4.js';
const CSS='css/stars-variable-wallet-v4.css';
const HTML='index.html';
const BEFORE=Object.freeze({
 [JS]:'9b239ca4ccf23df27d7dd1e05bc015c5ded6a924',
 [CSS]:'dccf3011db15115f9d5cbd0611b4a76669c0828e',
 [HTML]:'4b89602080049342f4d21e7276ef660830f1c7fd'
});
const OLD_JS='src="js/stars-variable-wallet-v4.js?v=20261105variable4h"';
const NEW_JS='src="js/stars-variable-wallet-v4.js?v=20261105supporter1"';
const OLD_CSS='href="css/stars-variable-wallet-v4.css?v=20261105variable4"';
const NEW_CSS='href="css/stars-variable-wallet-v4.css?v=20261105supporter1"';
const normal=x=>x.replace(/\r\n/g,'\n');
function git(cwd,...args){
 return execFileSync('git',args,{cwd,encoding:'utf8',
  stdio:['ignore','pipe','pipe'],timeout:60000}).trim();
}
function once(raw,oldValue,newValue){
 if(raw.includes(newValue)&&!raw.includes(oldValue))return raw;
 if(raw.split(oldValue).length!==2||raw.includes(newValue))
  throw Error('unexpected_live_miniapp_cache_tag');
 return raw.replace(oldValue,newValue);
}
export function updateSupporterHtml(html){
 if(typeof html!=='string')throw Error('invalid_live_html');
 const updated=once(once(html,OLD_CSS,NEW_CSS),OLD_JS,NEW_JS);
 if(updated===html){
  if(!html.includes(NEW_JS)||!html.includes(NEW_CSS))
   throw Error('supporter_cache_not_ready');
 }
 return updated;
}
export function verifySupporterAssets(js,css){
 if(typeof js!=='string'||typeof css!=='string'||js.length<8500||
    css.length<650)throw Error('invalid_supporter_asset_size');
 new Function(js);
 for(const keyword of [
  "window.RUSTUP_STARS_VARIABLE_V4=Object.freeze",
  "/api/stars/variable/",
  "/api/stars/supporter-badge",
  "credentials:'omit'",
  "transferable!==false",
  "usableForWagers!==false",
  "Не удалось подтвердить вход через Telegram",
  "payButton.disabled=data.checkoutEnabled!==true"
 ])if(!js.includes(keyword))throw Error('supporter_asset_feature_missing');
 if(!css.includes('.rustup-supporter-status')||
    !css.includes('.rustup-amount-input'))
  throw Error('supporter_style_missing');
 if(/innerHTML\s*=|eval\s*\(|(?:state|balance)\s*\.\s*balance\s*(?:=|\+=)/.test(js))
  throw Error('unsafe_stars_ui_source');
 return true;
}
export function verifyPublicState(files,hashes,newFiles){
 if(!files||!hashes||!newFiles)throw Error('missing_website_snapshot');
 const identical=Object.keys(BEFORE).every(p=>
  normal(files[p]||'')===normal(newFiles[p]||''));
 if(identical)return 'already_published';
 for(const [p,sha] of Object.entries(BEFORE))
  if(hashes[p]!==sha)
   throw Error('public_website_source_changed_'+p);
 return 'publish';
}
function main(){
 const mode=process.argv[2]||'--check';
 if(!['--check','--publish'].includes(mode)||process.argv.length>3)
  throw Error('Usage: node payments/scripts/publish-supporter-badge-ui.mjs --check|--publish');
 const js=fs.readFileSync(path.join(SRC,'stars-variable-wallet-v4.js'),'utf8');
 const css=fs.readFileSync(path.join(SRC,'stars-variable-wallet-v4.css'),'utf8');
 verifySupporterAssets(js,css);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rustup-supporter-publish-'));
 try{
  const dest=path.join(temp,'site');
  execFileSync('git',['clone','--depth','1','--branch','main',PUBLIC,dest],{
   stdio:['ignore','pipe','pipe'],timeout:120000
  });
  if(git(dest,'branch','--show-current')!=='main'||
     git(dest,'status','--porcelain')!=='')
   throw Error('website_not_clean_main');
  const remote=git(dest,'remote','get-url','origin');
  if(!/^(?:https:\/\/github\.com\/|git@github\.com:)ttzoomrust-hub\/rust-up(?:\.git)?\/?$/.test(remote))
   throw Error('unexpected_website_remote');
  const beforeFiles={
   [JS]:fs.readFileSync(path.join(dest,JS),'utf8'),
   [CSS]:fs.readFileSync(path.join(dest,CSS),'utf8'),
   [HTML]:fs.readFileSync(path.join(dest,HTML),'utf8')
  };
  const nextFiles={
   [JS]:js,[CSS]:css,[HTML]:updateSupporterHtml(beforeFiles[HTML])
  };
  const hashes=Object.fromEntries(Object.keys(BEFORE)
   .map(p=>[p,git(dest,'rev-parse','HEAD:'+p)]));
  const state=verifyPublicState(beforeFiles,hashes,nextFiles);
  if(state==='already_published'){
   console.log('PASS: Supporter UI is already present; no changes made.');
   return;
  }
  if(mode==='--check'){
   console.log('PASS: Only Supporter UI JS, CSS, and cache keys need publishing.');
   console.log('NOT PUBLISHED. Run --publish to update GitHub Pages.');
   return;
  }
  for(const p of Object.keys(BEFORE))
   fs.writeFileSync(path.join(dest,p),nextFiles[p],'utf8');
  git(dest,'add','--',JS,CSS,HTML);
  const changed=git(dest,'diff','--cached','--name-only').split(/\r?\n/).sort();
  if(JSON.stringify(changed)!==JSON.stringify(Object.keys(BEFORE).sort()))
   throw Error('unrelated_website_files_changed');
  git(dest,'diff','--cached','--check');
  git(dest,'commit','-m',
   'Show read-only supporter badge and clarify Telegram session recovery');
  git(dest,'push','origin','main');
  console.log('PASS: Existing RUST UP Telegram Mini App badge UI published.');
  console.log('Game UI, BotFather app title, prices and payment flags unchanged.');
 }finally{
  fs.rmSync(temp,{recursive:true,force:true});
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 try{main();}catch(e){
  console.error('SUPPORTER MINI APP UPDATE BLOCKED: '+String(e?.message||e));
  process.exitCode=1;
 }
