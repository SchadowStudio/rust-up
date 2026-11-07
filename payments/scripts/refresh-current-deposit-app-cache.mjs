// RUST UP public site: invalidate stale cached app.js after the
// disabled Telegram Stars deposit/status panel was published.
// Only changes the HTML cache-busting query. Does not deploy any Worker,
// alter payment flags, touch balances or modify game logic.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const SITE='https://github.com/ttzoomrust-hub/rust-up.git';
const PINNED_INDEX='e302945a4aecf7d415f6b42f869847db29035dfb';
const PINNED_APP='e54b134ce14b7dc5165ba435b720a8501bf91cbd';
const PINNED_STARS_JS='0a9193e545c810e4c319045e2c7d987df8358bdc';
const PINNED_STARS_CSS='dccf3011db15115f9d5cbd0611b4a76669c0828e';
const OLD='<script src="js/app.js?v=20261106i"></script>';
const NEXT='<script src="js/app.js?v=20261106depositstatus2"></script>';
const STARS='<script src="js/stars-deposit-v5.js?v=20261106depositstatus1"></script>';
const STYLE='<link rel="stylesheet" href="css/stars-deposit-v5.css?v=20261106depositstatus1">';

export function patchDepositAppCache(source){
 if(typeof source!=='string'||source.length<4000)
  throw Error('unrecognized_site_index');
 if(source.includes(NEXT))
  throw Error('deposit_app_cache_already_refreshed');
 if(source.split(OLD).length!==2||source.split(STARS).length!==2||
    source.split(STYLE).length!==2||source.indexOf(STARS)>source.indexOf(OLD))
  throw Error('deposit_app_cache_html_changed_manual_review');
 return source.replace(OLD,NEXT);
}
function git(directory,...args){
 return execFileSync('git',args,{cwd:directory,encoding:'utf8',
  stdio:['ignore','pipe','pipe'],timeout:120000}).trim();
}
function main(){
 const mode=process.argv[2]||'--check';
 if(!['--check','--publish'].includes(mode)||process.argv.length>3)
  throw Error('Usage: node payments/scripts/refresh-current-deposit-app-cache.mjs --check|--publish');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rustup-site-cache-fix-'));
 try{
  const site=path.join(dir,'site');
  execFileSync('git',['clone','--depth','1','--branch','main',SITE,site],{
   stdio:['ignore','pipe','pipe'],timeout:120000
  });
  if(git(site,'branch','--show-current')!=='main'||
     git(site,'status','--porcelain')||
     !/^(?:https:\/\/github\.com\/|git@github\.com:)ttzoomrust-hub\/rust-up(?:\.git)?\/?$/.test(
      git(site,'remote','get-url','origin')))
   throw Error('unsafe_public_site_git_worktree');
  for(const [file,expected] of [
   ['index.html',PINNED_INDEX],
   ['js/app.js',PINNED_APP],
   ['js/stars-deposit-v5.js',PINNED_STARS_JS],
   ['css/stars-deposit-v5.css',PINNED_STARS_CSS]
  ]){
   if(git(site,'rev-parse','HEAD:'+file)!==expected)
    throw Error('public_site_file_changed_manual_review_'+file.replace(/[^a-z0-9]/gi,'_'));
  }
  const app=fs.readFileSync(path.join(site,'js/app.js'),'utf8');
  if(!app.includes('window.RUSTUP_STARS_VARIABLE_V4.render(box)')||
     !app.includes("['gifts', 'Telegram Stars'"))
   throw Error('public_site_missing_stars_wallet_hook');
  const htmlFile=path.join(site,'index.html');
  const revised=patchDepositAppCache(fs.readFileSync(htmlFile,'utf8'));
  if(mode==='--check'){
   console.log('PASS: Public website has the latest Stars panel but still references cached old app.js URL.');
   console.log('READY: Only app.js cache-busting query will change. No money gates touched.');
   return;
  }
  fs.writeFileSync(htmlFile,revised);
  git(site,'add','--','index.html');
  if(git(site,'diff','--cached','--name-only')!=='index.html')
   throw Error('unexpected_public_site_file_change');
  git(site,'-c','core.whitespace=cr-at-eol','diff','--cached','--check');
  git(site,'commit','-m','Refresh cached wallet app.js after disabled Stars deposit panel release');
  git(site,'push','origin','main');
  console.log('PASS: Website app.js cache version refreshed; live payments are NOT enabled.');
 }finally{
  fs.rmSync(dir,{recursive:true,force:true});
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main();}catch(error){
  console.error('RUST UP SITE CACHE REFRESH SAFETY STOP:',
   String(error?.message||'unknown').slice(0,300));
  process.exitCode=1;
 }
}
