// Replace fixed Stars product catalogue with USER-ENTERED RUB amount in RUST UP.
// Existing Telegram Mini App, game and admin routes are left untouched.
// - check reads only; -publish commits to website/main using local Git credentials.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const FRONT=path.join(ROOT,'frontend','telegram-miniapp');
const SRC='js/stars-variable-wallet-v4.js',CSS='css/stars-variable-wallet-v4.css';
const OLD_MOUNT='window.RUSTUP_STARS_FIXED_MARKET_V3?.render(box)';
const NEW_MOUNT='window.RUSTUP_STARS_VARIABLE_V4?.render(box)';
const OLD_SCRIPT='<script src="js/stars-fixed-market-v3.js?v=20261105market3"></script>';
const NEW_SCRIPT='<script src="js/stars-variable-wallet-v4.js?v=20261105variable4"></script>';
const NEW_STYLE='<link rel="stylesheet" href="css/stars-variable-wallet-v4.css?v=20261105variable4">';
function once(src,oldText,newText){
 const i=src.indexOf(oldText);
 if(i<0||src.indexOf(oldText,i+oldText.length)!==-1)
   throw Error('website_source_changed_refuse_to_patch');
 return src.slice(0,i)+newText+src.slice(i+oldText.length);
}
export function patchVariableWalletApp(src){
 if(src.includes(NEW_MOUNT))return src;
 if(!src.includes('RUSTUP_STARS_READONLY_V2_MOUNT'))
   throw Error('existing_wallet_mount_missing');
 return once(src,OLD_MOUNT,NEW_MOUNT);
}
export function patchVariableWalletHtml(src){
 if(src.includes(NEW_SCRIPT))return src;
 if(!src.includes('telegram-web-app.js')||!src.includes('css/stars-fixed-market-v3.css'))
   throw Error('existing_telegram_mini_app_missing');
 let html=once(src,OLD_SCRIPT,NEW_SCRIPT);
 const app=/<script src="js\/app\.js\?v=([^"]+)"><\/script>/.exec(html);
 if(!app||!app[1].endsWith('-market3'))throw Error('unexpected_existing_miniapp_script');
 html=once(html,app[0],app[0].replace(app[1],app[1]+'-variable4'));
 // Remove the old fixed-product button CSS; use the existing shared classes
 // and our small amount-entry override. Do not alter other wallet styles.
 html=once(html,
  '<link rel="stylesheet" href="css/stars-fixed-market-v3.css?v=20261105market3">',
  NEW_STYLE);
 return html;
}
export function sameAssetContents(existing,expected){
 if(typeof existing!=='string'||typeof expected!=='string')
  throw Error('invalid_asset_type');
 return existing.replace(/\r\n/g,'\n')===expected.replace(/\r\n/g,'\n');
}
function git(cwd,...args){
 return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
}
function main(){
 const arg=process.argv[2],mode=process.argv[3]||'--check';
 if(!arg||!['--check','--publish'].includes(mode))
  throw Error('Usage: node payments/scripts/publish-variable-stars-wallet.mjs "<clean RUST-UP Website clone>" --check|--publish');
 const dir=fs.realpathSync(path.resolve(arg));
 if(!fs.existsSync(path.join(dir,'.git')))throw Error('not_git_checkout');
 if(!/^(?:https:\/\/github\.com\/|git@github\.com:)ttzoomrust-hub\/rust-up(?:\.git)?\/?$/.test(git(dir,'remote','get-url','origin')))
  throw Error('wrong_website_remote');
 if(git(dir,'branch','--show-current')!=='main')throw Error('website_not_on_main');
 if(git(dir,'status','--porcelain'))throw Error('website_contains_local_changes');
 if(mode==='--publish')git(dir,'pull','--ff-only','origin','main');
 const appFile=path.join(dir,'js','app.js'),htmlFile=path.join(dir,'index.html');
 const beforeApp=fs.readFileSync(appFile,'utf8'),beforeHtml=fs.readFileSync(htmlFile,'utf8');
 const app=patchVariableWalletApp(beforeApp),html=patchVariableWalletHtml(beforeHtml);
 const source=fs.readFileSync(path.join(FRONT,'stars-variable-wallet-v4.js'),'utf8');
 const style=fs.readFileSync(path.join(FRONT,'stars-variable-wallet-v4.css'),'utf8');
 new Function(source);new Function(app);
 if(!source.includes('parseAmountMinor')||!source.includes('/api/stars/variable/')||
    !source.includes('input.addEventListener')||!style.includes('.rustup-amount-input'))
  throw Error('variable_wallet_source_validation_failed');
 for(const [rel,data] of [[SRC,source],[CSS,style]]){
  const out=path.join(dir,rel);
  // Existing GitHub Pages asset may be CRLF on Windows.
  if(fs.existsSync(out)&&!sameAssetContents(fs.readFileSync(out,'utf8'),data))
   throw Error('existing_asset_conflict_'+rel);
 }
 console.log('PASS: User-selected deposit amount, current wallet and cache key verified.');
 if(mode==='--check'){console.log('NOT PUBLISHED.');return;}
 if(app===beforeApp&&html===beforeHtml){console.log('Already installed.');return;}
 const created=[];
 try{
  for(const [rel,data] of [[SRC,source],[CSS,style]]){
   const out=path.join(dir,rel);
   if(!fs.existsSync(out)){fs.writeFileSync(out,data);created.push(out);}
  }
  fs.writeFileSync(appFile,app);
  fs.writeFileSync(htmlFile,html);
  execFileSync(process.execPath,['--check',appFile],{stdio:'pipe'});
  execFileSync(process.execPath,['--check',path.join(dir,SRC)],{stdio:'pipe'});
 }catch(error){
  fs.writeFileSync(appFile,beforeApp);fs.writeFileSync(htmlFile,beforeHtml);
  for(const out of created)fs.rmSync(out,{force:true});
  throw Error('patch_failed_originals_restored: '+error.message);
 }
 git(dir,'add','--','js/app.js','index.html',SRC,CSS);
 git(dir,'commit','-m','Replace fixed Stars products with custom RUB deposit amount');
 git(dir,'push','origin','main');
 console.log('PASS: Variable-amount Telegram wallet pushed to GitHub Pages main.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 try{main();}catch(e){console.error('VARIABLE WALLET RELEASE BLOCKED:',e.message);process.exitCode=1;}
