// Publish a clearly DISABLED Stars deposit/status panel into the CURRENT
// RUST UP Telegram-only Mini App without changing game/withdrawal logic.
// Never enables live charges. Only the exact inspected public Git blobs pass.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyDepositAssets} from './publish-rustup-deposit-wallet.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SITE='https://github.com/ttzoomrust-hub/rust-up.git';
const APP_SHA='751d5ca4f989632a075b3585945e35737ef528f6';
const INDEX_SHA='3f4a38cd633c6f5b1daf139400d7ec586c2674f7';
const JS='js/stars-deposit-v5.js';
const CSS='css/stars-deposit-v5.css';
const NEW_SCRIPT='<script src="js/stars-deposit-v5.js?v=20261106depositstatus1"></script>';
const NEW_STYLE='<link rel="stylesheet" href="css/stars-deposit-v5.css?v=20261106depositstatus1">';
const METHOD_OLD="['gifts', 'Telegram и CS2', 10, 7, ['star', 'gift'], 'Звёзды, подарки, скины', ['Звёзды Telegram', 'Подарки и NFT', 'Скины CS2']]";
const METHOD_NEW="['gifts', 'Telegram Stars', 10, 0, ['star'], 'Пополнение через Telegram Stars', ['Статус оплаты и зачисления', 'Пока недоступно для реальных денег']]";
const APP_ANCHOR="    box.innerHTML = WF.tab === 'withdraw' ? walletWithdraw() : WF.tab === 'history' ? walletHistory() : walletDeposit();";
const INDEX_STYLE='<link rel="stylesheet" href="css/style.css?v=20261106i">';
const INDEX_APP='<script src="js/app.js?v=20261106i"></script>';
const NEW_GUARD='RUSTUP_STARS_VARIABLE_V4.render(box)';

function one(source,oldValue,newValue){
 if(typeof source!=='string'||source.split(oldValue).length!==2||
  source.includes(newValue))
  throw Error('current_site_version_changed_or_patch_already_applied');
 return source.replace(oldValue,newValue);
}
export function patchCurrentWalletApp(source){
 if(typeof source!=='string'||source.length<30000||
    !source.includes('function renderWallet()')||
    !source.includes('function walletDeposit()')||
    !source.includes("if ('wpay' in d || 'wsend' in d)"))
  throw Error('unrecognized_current_wallet_app');
 const nl=source.includes('\r\n')?'\r\n':'\n';
 const injected=[
  '    // Isolated Stars receipt/credit status; demo deposit and withdrawal',
  '    // buttons elsewhere stay unchanged. No optimistic game credits.',
  "    if (WF.tab === 'deposit' && WF.dep === 'gifts' &&",
  '        window.RUSTUP_STARS_VARIABLE_V4) {',
  "      const demoForm = box.querySelector('.w-glass');",
  '      if (demoForm) demoForm.remove();',
  "      const bonusCards = box.querySelector('#wBonuses');",
  '      if (bonusCards) bonusCards.remove();',
  "      const bonusHeading = box.querySelector('.row-head');",
  '      if (bonusHeading) bonusHeading.remove();',
  "      const panel = document.createElement('section');",
  "      panel.className = 'w-glass w-panel';",
  "      panel.setAttribute('role','status');",
  '      box.append(panel);',
  '      window.RUSTUP_STARS_VARIABLE_V4.render(box);',
  '    }'
 ].join(nl);
 const updated=one(source,APP_ANCHOR,APP_ANCHOR+nl+injected);
 return one(updated,METHOD_OLD,METHOD_NEW);
}
export function patchCurrentWalletHtml(source){
 if(typeof source!=='string'||source.length<4000||
    !source.includes('Демо-режим · виртуальный баланс'))
  throw Error('unrecognized_current_demo_index');
 const nl=source.includes('\r\n')?'\r\n':'\n';
 let changed=one(source,INDEX_STYLE,INDEX_STYLE+nl+'  '+NEW_STYLE);
 changed=one(changed,INDEX_APP,'  '+NEW_SCRIPT+nl+'  '+INDEX_APP);
 if(changed.indexOf(NEW_SCRIPT)>changed.indexOf(INDEX_APP)||
    !changed.includes(NEW_STYLE))
  throw Error('unsafe_script_order');
 return changed;
}
function git(directory,...args){
 return execFileSync('git',args,{cwd:directory,encoding:'utf8',
  stdio:['ignore','pipe','pipe'],timeout:120000}).trim();
}
function main(){
 const mode=process.argv[2]||'--check';
 if(!['--check','--publish'].includes(mode)||process.argv.length>3)
  throw Error('Usage: node payments/scripts/prepare-current-deposit-wallet.mjs --check|--publish');
 const js=fs.readFileSync(path.join(ROOT,'frontend/telegram-miniapp/stars-deposit-v5.js'),'utf8');
 const css=fs.readFileSync(path.join(ROOT,'frontend/telegram-miniapp/stars-deposit-v5.css'),'utf8');
 verifyDepositAssets(js,css);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rustup-current-deposit-'));
 try{
  const site=path.join(dir,'site');
  execFileSync('git',['clone','--depth','1','--branch','main',SITE,site],{
   stdio:['ignore','pipe','pipe'],timeout:120000
  });
  if(git(site,'branch','--show-current')!=='main'||git(site,'status','--porcelain')||
     !/^(?:https:\/\/github\.com\/|git@github\.com:)ttzoomrust-hub\/rust-up(?:\.git)?\/?$/
      .test(git(site,'remote','get-url','origin')))
   throw Error('unsafe_website_git_worktree');
  if(git(site,'rev-parse','HEAD:js/app.js')!==APP_SHA||
     git(site,'rev-parse','HEAD:index.html')!==INDEX_SHA)
   throw Error('public_site_modified_since_review_stop');
  const appFile=path.join(site,'js/app.js');
  const htmlFile=path.join(site,'index.html');
  const patchedApp=patchCurrentWalletApp(fs.readFileSync(appFile,'utf8'));
  const patchedHtml=patchCurrentWalletHtml(fs.readFileSync(htmlFile,'utf8'));
  new Function(patchedApp);
  for(const file of [JS,CSS])if(fs.existsSync(path.join(site,file)))
   throw Error('deposit_asset_exists_manual_review');
  if(mode==='--check'){
   console.log('PASS: Latest website version supports a Stars deposit/status panel.');
   console.log('NOT PUBLISHED. Payment and game-credit release gates unchanged.');
   return;
  }
  fs.writeFileSync(appFile,patchedApp);
  fs.writeFileSync(htmlFile,patchedHtml);
  fs.writeFileSync(path.join(site,JS),js);
  fs.writeFileSync(path.join(site,CSS),css);
  git(site,'add','--','js/app.js','index.html',JS,CSS);
  const changed=git(site,'diff','--cached','--name-only').split(/\r?\n/).sort();
  if(JSON.stringify(changed)!==
     JSON.stringify(['js/app.js','index.html',JS,CSS].sort()))
   throw Error('unexpected_website_file_change');
  git(site,'diff','--cached','--check');
  git(site,'commit','-m','Add Telegram Stars deposit/status panel to existing wallet in disabled-money mode');
  git(site,'push','origin','main');
  console.log('PASS: Stars deposit UI published; live payment acceptance NOT enabled.');
 }finally{
  fs.rmSync(dir,{recursive:true,force:true});
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main();}catch(error){
  console.error('RUST UP DEPOSIT PUBLISH SAFETY STOP:',
   String(error?.message||'unknown').slice(0,300));
  process.exitCode=1;
 }
}
