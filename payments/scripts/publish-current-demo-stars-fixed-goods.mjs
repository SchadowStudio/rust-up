// RUST UP 2026-11-06 website: add an isolated fixed/non-wagerable
// Telegram Stars shop inside the EXISTING wallet. Never turn case top-ups
// into real money and never modify the server game balance. This patch is
// for the public website git repository, not the Cloudflare Worker.
// Default is a zero-mutation compatibility check.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const PROJECT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const FRONT=path.join(PROJECT,'frontend','telegram-miniapp');
const WEBSITE='ttzoomrust-hub/rust-up';
const ASSETS=[
 ['js/stars-fixed-market-v3.js','stars-fixed-market-v3.js'],
 ['css/stars-fixed-market-v3.css','stars-fixed-market-v3.css']
];
const APP_ANCHOR="box.innerHTML = WF.tab === 'withdraw' ? walletWithdraw() : WF.tab === 'history' ? walletHistory() : walletDeposit();";
const MODULE_TAG='<script src="js/stars-fixed-market-v3.js?v=20261106fixed1"></script>';
const STYLE_TAG='<link rel="stylesheet" href="css/stars-fixed-market-v3.css?v=20261106fixed1">';
const MOUNT_MARKER='RUSTUP_STARS_FIXED_MARKET_V3.render(box)';
const MOUNT=[
 APP_ANCHOR,
 "    // Fixed nontransferable digital goods only. Gameplay and wallet coins",
 "    // remain controlled by the existing server; there is NO paid case credit.",
 "    if (WF.tab === 'deposit' && window.RUSTUP_STARS_FIXED_MARKET_V3) {",
 "      const safePanel = document.createElement('section');",
 "      safePanel.className = 'w-glass w-panel';",
 "      safePanel.setAttribute('role', 'status');",
 "      safePanel.setAttribute('aria-label', 'Telegram Stars: только цифровые товары, без пополнения игрового баланса');",
 "      box.append(safePanel);",
 "      window.RUSTUP_STARS_FIXED_MARKET_V3.render(box);",
 "    }"
].join('\r\n');
function exactlyOnce(haystack,needle){
 const at=haystack.indexOf(needle);
 if(at<0||haystack.indexOf(needle,at+needle.length)!==-1)
  throw Error('current_demo_wallet_version_mismatch');
 return at;
}
export function patchCurrentWalletApp(source){
 if(typeof source!=='string'||source.length<50000||
    !source.includes("const STORE_KEY = 'rustup_demo_v1';")||
    !source.includes("api('load', { local })")||
    !source.includes('gameReady = true;')||
    !source.includes('RUSTUP_API'))
  throw Error('expected_server_synced_demo_app_missing');
 if(source.includes(MOUNT_MARKER)){
  if(!source.includes("WF.tab === 'deposit'")||
     !source.includes('safePanel')||
     !source.includes('box.append(safePanel)'))
   throw Error('untrusted_existing_stars_wallet_mount');
  return source;
 }
 exactlyOnce(source,APP_ANCHOR);
 if(!source.includes("if ('wpay' in d || 'wsend' in d) { haptic('warning'); return toast(NOT_YET, 'error'); }"))
  throw Error('existing_demo_deposit_safety_guard_changed');
 return source.replace(APP_ANCHOR,MOUNT);
}
export function patchCurrentWalletHtml(source){
 if(typeof source!=='string'||!source.includes('Демо-режим · виртуальный баланс')||
    !source.includes('<script src="js/app.js?v=20261106d"></script>')||
    !source.includes('<link rel="stylesheet" href="css/style.css?v=20261106d">')||
    !source.includes('telegram-web-app.js'))
  throw Error('expected_demo_website_version_changed');
 if(source.includes(MODULE_TAG)&&source.includes(STYLE_TAG))return source;
 if(source.includes('stars-fixed-market-v3.js')||source.includes('stars-fixed-market-v3.css'))
  throw Error('conflicting_stars_website_assets');
 const style='<link rel="stylesheet" href="css/style.css?v=20261106d">';
 const app='<script src="js/app.js?v=20261106d"></script>';
 exactlyOnce(source,style);exactlyOnce(source,app);
 return source.replace(style,style+'\n  '+STYLE_TAG)
  .replace(app,'  '+MODULE_TAG+'\n  '+app);
}
function git(cwd,...args){
 return execFileSync('git',args,{
  cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']
 }).trim();
}
export function validateFixedGoodsModule(js,css){
 if(typeof js!=='string'||typeof css!=='string'||
  !js.includes('data.checkoutEnabled===true')||
  !js.includes('data.creditToGame!==false')||
  !js.includes('api(\'terms/accept\'')||
  !js.includes('openInvoice')||
  !js.includes("wallet?.querySelector('.w-glass.w-panel[role=\"status\"]')")||
  !css.includes('.rustup-stars-buy'))
  throw Error('fixed_goods_checkout_hard_gates_missing');
 new Function(js);
 return true;
}
function run(){
 const arg=process.argv[2],mode=process.argv[3]||'--check';
 if(!arg||!['--check','--publish'].includes(mode))
  throw Error('Usage: node payments/scripts/publish-current-demo-stars-fixed-goods.mjs "<clean website clone>" --check|--publish');
 const dir=fs.realpathSync(path.resolve(arg));
 if(!fs.existsSync(path.join(dir,'.git')))
  throw Error('website_must_be_a_git_checkout');
 const remote=git(dir,'remote','get-url','origin');
 if(!/^(?:https:\/\/github\.com\/|git@github\.com:)ttzoomrust-hub\/rust-up(?:\.git)?\/?$/.test(remote))
  throw Error('not_the_reviewed_RUST_UP_website_repository');
 if(git(dir,'branch','--show-current')!=='main')throw Error('website_branch_must_be_main');
 if(git(dir,'status','--porcelain'))throw Error('website_has_uncommitted_changes');
 if(mode==='--publish')git(dir,'pull','--ff-only','origin','main');
 const appPath=path.join(dir,'js','app.js');
 const htmlPath=path.join(dir,'index.html');
 const beforeApp=fs.readFileSync(appPath,'utf8');
 const beforeHtml=fs.readFileSync(htmlPath,'utf8');
 const patchedApp=patchCurrentWalletApp(beforeApp);
 const patchedHtml=patchCurrentWalletHtml(beforeHtml);
 const moduleJs=fs.readFileSync(path.join(FRONT,ASSETS[0][1]),'utf8');
 const moduleCss=fs.readFileSync(path.join(FRONT,ASSETS[1][1]),'utf8');
 validateFixedGoodsModule(moduleJs,moduleCss);
 new Function(patchedApp);
 for(const [remoteFile,localName] of ASSETS){
  const file=path.join(dir,remoteFile);
  if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')!==
     fs.readFileSync(path.join(FRONT,localName),'utf8'))
   throw Error('existing_website_asset_conflict_'+remoteFile);
 }
 console.log('PASS: current server-synced demo wallet is compatible.');
 console.log('PASS: only fixed digital goods use Stars; game wallet and virtual cases untouched.');
 if(mode==='--check'){console.log('NOT PUBLISHED. No payment gate changed.');return;}
 if(beforeApp===patchedApp&&beforeHtml===patchedHtml){
  console.log('Already published, no new commit.');return;
 }
 const added=[];
 try{
  for(const [relative,local] of ASSETS){
   const dest=path.join(dir,relative);
   if(!fs.existsSync(dest)){
    fs.copyFileSync(path.join(FRONT,local),dest);
    added.push(dest);
   }
  }
  fs.writeFileSync(appPath,patchedApp);
  fs.writeFileSync(htmlPath,patchedHtml);
  execFileSync(process.execPath,['--check',appPath],{stdio:'pipe'});
  execFileSync(process.execPath,['--check',path.join(dir,ASSETS[0][0])],{stdio:'pipe'});
 }catch(error){
  fs.writeFileSync(appPath,beforeApp);
  fs.writeFileSync(htmlPath,beforeHtml);
  for(const file of added)fs.rmSync(file,{force:true});
  throw Error('site_patch_failed_original_restored');
 }
 git(dir,'add','--','index.html','js/app.js',...ASSETS.map(x=>x[0]));
 git(dir,'commit','-m','Prepare nonwagerable fixed Stars goods in existing RUST UP wallet');
 git(dir,'push','origin','main');
 console.log('PASS: fixed-goods panel published; existing case/demo deposits still disabled.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 try{run();}catch(e){console.error('RUST UP WEBSITE STARS PUBLISH BLOCKED:',
  String(e?.message||e));process.exitCode=1;}
