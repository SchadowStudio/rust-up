// Publish the fixed-goods checkout button in the EXISTING Telegram Mini App.
// Only presents native invoices when current Stars backend returns checkoutEnabled.
// No payment flags, blockchain addresses, game credits or worker deployment here.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const FRONT=path.join(ROOT,'frontend','telegram-miniapp');
const SOURCE='js/stars-fixed-market-v3.js';
const CSS='css/stars-fixed-market-v3.css';
const OLD_SCRIPT='src="js/stars-readonly-v2.js?v=20261105s3"';
const NEW_SCRIPT='src="js/stars-fixed-market-v3.js?v=20261105market3"';
const OLD_MOUNT='window.RUSTUP_STARS_READONLY_V2?.render(box)';
const NEW_MOUNT='window.RUSTUP_STARS_FIXED_MARKET_V3?.render(box)';
const NEW_CSS='<link rel="stylesheet" href="css/stars-fixed-market-v3.css?v=20261105market3">';
function once(source,oldText,newText){
 const i=source.indexOf(oldText);
 if(i<0||source.indexOf(oldText,i+oldText.length)>=0)
   throw Error('website_version_mismatch_refuse_to_publish');
 return source.slice(0,i)+newText+source.slice(i+oldText.length);
}
export function patchFrontendApp(source){
 if(source.includes(NEW_MOUNT))return source;
 if(!source.includes('RUSTUP_STARS_READONLY_V2_MOUNT'))
   throw Error('current_wallet_mount_missing');
 return once(source,OLD_MOUNT,NEW_MOUNT);
}
export function patchFrontendHtml(source){
 if(source.includes(NEW_SCRIPT))return source;
 if(!source.includes('telegram-web-app.js')||!source.includes('css/stars-readonly-v2.css'))
   throw Error('current_telegram_miniapp_html_missing');
 let result=once(source,OLD_SCRIPT,NEW_SCRIPT);
 const style=/<link rel="stylesheet" href="css\/stars-readonly-v2\.css\?v=[^"]+">/.exec(result);
 if(!style)throw Error('current_stars_styles_missing');
 result=once(result,style[0],style[0]+'\n  '+NEW_CSS);
 const script=/<script src="js\/app\.js\?v=([^"]+)"><\/script>/.exec(result);
 if(!script)throw Error('current_app_script_missing');
 result=once(result,script[0],script[0].replace(script[1],script[1]+'-market3'));
 return result;
}
function git(cwd,...args){
 return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
}
function main(){
 const websiteArg=process.argv[2],mode=process.argv[3]||'--check';
 if(!websiteArg||!['--check','--publish'].includes(mode))
   throw Error('Usage: node payments/scripts/publish-stars-fixed-market-v3.mjs "<clean RUST-UP Website clone>" --check|--publish');
 const dir=fs.realpathSync(path.resolve(websiteArg));
 if(!fs.existsSync(path.join(dir,'.git')))
   throw Error('website_is_not_a_git_checkout');
 if(!/^(?:https:\/\/github\.com\/|git@github\.com:)ttzoomrust-hub\/rust-up(?:\.git)?\/?$/.test(git(dir,'remote','get-url','origin')))
   throw Error('wrong_github_repository');
 if(git(dir,'branch','--show-current')!=='main')throw Error('website_branch_not_main');
 if(git(dir,'status','--porcelain'))throw Error('website_has_local_changes');
 if(mode==='--publish')git(dir,'pull','--ff-only','origin','main');
 const appFile=path.join(dir,'js','app.js');
 const htmlFile=path.join(dir,'index.html');
 const oldApp=fs.readFileSync(appFile,'utf8');
 const oldHtml=fs.readFileSync(htmlFile,'utf8');
 const app=patchFrontendApp(oldApp);
 const html=patchFrontendHtml(oldHtml);
 const js=fs.readFileSync(path.join(FRONT,'stars-fixed-market-v3.js'),'utf8');
 const css=fs.readFileSync(path.join(FRONT,'stars-fixed-market-v3.css'),'utf8');
 if(!js.includes("data.checkoutEnabled===true")||
    !js.includes("openInvoice")||
    !js.includes("data.creditToGame!==false")||
    !css.includes('.rustup-stars-buy'))
   throw Error('checkout_ui_hard_gates_missing');
 new Function(app);
 new Function(js);
 if(html.includes('src="js/stars-readonly-v2.js?v='))
   throw Error('old_stars_script_not_removed');
 for(const [rel,source] of [[SOURCE,js],[CSS,css]]){
   const filepath=path.join(dir,rel);
   if(fs.existsSync(filepath)&&fs.readFileSync(filepath,'utf8')!==source)
     throw Error('preexisting_asset_conflict_'+rel);
 }
 console.log('PASS: Existing RUST UP Telegram Mini App compatible with fixed-goods market.');
 if(mode==='--check'){console.log('NO DEPLOYMENT. No payment gate enabled.');return;}
 if(app===oldApp&&html===oldHtml){
   console.log('Already published. No changes.');return;
 }
 const added=[];
 try{
   for(const [rel,source] of [[SOURCE,js],[CSS,css]]){
     const file=path.join(dir,rel);
     if(!fs.existsSync(file)){fs.writeFileSync(file,source);added.push(file);}
   }
   fs.writeFileSync(appFile,app);
   fs.writeFileSync(htmlFile,html);
   execFileSync(process.execPath,['--check',appFile],{stdio:'pipe'});
   execFileSync(process.execPath,['--check',path.join(dir,SOURCE)],{stdio:'pipe'});
 }catch(error){
   fs.writeFileSync(appFile,oldApp);
   fs.writeFileSync(htmlFile,oldHtml);
   for(const file of added)fs.rmSync(file,{force:true});
   throw Error('checkout_ui_patch_failed_original_files_restored: '+error.message);
 }
 git(dir,'add','--','js/app.js','index.html',SOURCE,CSS);
 git(dir,'commit','-m','Prepare native fixed digital goods Stars purchase in existing Telegram wallet');
 git(dir,'push','origin','main');
 console.log('PASS: Native Telegram Stars fixed-goods frontend published; payment switches unchanged.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 try{main();}catch(error){console.error('FIXED MARKET RELEASE BLOCKED:',error.message);process.exitCode=1;}
