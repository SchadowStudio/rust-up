// Publish read-only Stars catalogue+purchase history in existing Telegram Mini App.
// No bot deploy, D1 mutations, payment flags or payable checkout.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const FRONT=path.join(ROOT,'frontend','telegram-miniapp');
const BRIDGE='js/stars-readonly-v2.js',STYLE='css/stars-readonly-v2.css';
const MARKER='RUSTUP_STARS_READONLY_V2_MOUNT';
const ORIGINAL="    box.innerHTML = WF.tab === 'withdraw' ? walletWithdraw() : WF.tab === 'history' ? walletHistory() : walletDeposit();";
const MOUNT=[
 '',
 '    // RUSTUP_STARS_READONLY_V2_MOUNT: read-only, no purchases or credits.',
 "    if (WF.tab === 'deposit' && WF.dep === 'gifts')",
 '      window.RUSTUP_STARS_READONLY_V2?.render(box);'
].join('\n');
function one(source,needle,replacement){
 const i=source.indexOf(needle);
 if(i===-1||source.indexOf(needle,i+needle.length)!==-1)throw Error('website_version_drift');
 return source.slice(0,i)+replacement+source.slice(i+needle.length);
}
export function patchApp(source){
 if(!source.includes('RUSTUP_TELEGRAM_ONLY_WALLET_NOTICE_V1'))throw Error('stars_wallet_tile_missing');
 if(source.includes(MARKER))return source;
 const crlf=source.includes('\r\n'),text=source.replace(/\r\n/g,'\n');
 const output=one(text,ORIGINAL,ORIGINAL+MOUNT);
 return crlf?output.replace(/\n/g,'\r\n'):output;
}
export function patchIndex(source){
 if(!source.includes('telegram-web-app.js'))throw Error('not_telegram_miniapp');
 if(source.includes('js/stars-readonly-v2.js'))return source;
 const style=source.match(/<link rel="stylesheet" href="css\/style\.css\?v=[^"]+">/);
 if(!style)throw Error('style_sheet_missing');
 const script=source.match(/<script src="js\/app\.js\?v=([^"]+)"><\/script>/);
 if(!script)throw Error('app_script_missing');
 let next=one(source,style[0],style[0]+
   '\n  <link rel="stylesheet" href="css/stars-readonly-v2.css?v=20261105s2">');
 next=one(next,script[0],
   '<script src="js/stars-readonly-v2.js?v=20261105s2"></script>\n  '+
   '<script src="js/app.js?v='+script[1]+'-starsv2"></script>');
 return next;
}
function git(cwd,...args) {
 return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
}
function run() {
 const supplied=process.argv[2],mode=process.argv[3]||'--check';
 if(!supplied||!['--check','--publish'].includes(mode))
  throw Error('Usage: node payments/scripts/publish-telegram-stars-readonly-v2.mjs "<local website checkout>" --check|--publish');
 const website=fs.realpathSync(path.resolve(supplied));
 if(!fs.existsSync(path.join(website,'.git')))throw Error('git_checkout_missing');
 if(!/^(?:https:\/\/github\.com\/|git@github\.com:)ttzoomrust-hub\/rust-up(?:\.git)?\/?$/.test(git(website,'remote','get-url','origin')))
  throw Error('wrong_website_remote');
 if(git(website,'branch','--show-current')!=='main')throw Error('website_not_on_main');
 if(git(website,'status','--porcelain'))throw Error('website_has_local_changes');
 if(mode==='--publish')git(website,'pull','--ff-only','origin','main');
 const appFile=path.join(website,'js','app.js');
 const indexFile=path.join(website,'index.html');
 const existingApp=fs.readFileSync(appFile,'utf8'),existingIndex=fs.readFileSync(indexFile,'utf8');
 const app=patchApp(existingApp),index=patchIndex(existingIndex);
 const script=fs.readFileSync(path.join(FRONT,'stars-readonly-v2.js'),'utf8');
 const css=fs.readFileSync(path.join(FRONT,'stars-readonly-v2.css'),'utf8');
 // Syntax-check source BEFORE modifying the website.
 new Function(app);
 new Function(script);
 if(!css.includes('.rustup-stars-tabs'))throw Error('style_verification_failed');
 for(const [file,source] of [[BRIDGE,script],[STYLE,css]]){
   const at=path.join(website,file);
   if(fs.existsSync(at)&&fs.readFileSync(at,'utf8')!==source)
    throw Error('existing_frontend_asset_conflict: '+file);
 }
 console.log('PASS: Stars Mini App compatibility, JS syntax and source checks.');
 if(mode==='--check'){console.log('NOT DEPLOYED. No payment gate enabled.');return;}
 if(app===existingApp&&index===existingIndex){
   console.log('ALREADY PRESENT: no website changes required.');return;
 }
 const added=[];
 try{
   for(const [file,source] of [[BRIDGE,script],[STYLE,css]]){
     const at=path.join(website,file);
     if(!fs.existsSync(at)){fs.writeFileSync(at,source);added.push(at);}
   }
   fs.writeFileSync(appFile,app);
   fs.writeFileSync(indexFile,index);
   execFileSync(process.execPath,['--check',appFile],{stdio:'pipe'});
   execFileSync(process.execPath,['--check',path.join(website,BRIDGE)],{stdio:'pipe'});
 }catch(error){
   fs.writeFileSync(appFile,existingApp);
   fs.writeFileSync(indexFile,existingIndex);
   for(const at of added)fs.rmSync(at,{force:true});
   throw Error('apply_failed_originals_restored: '+error.message);
 }
 git(website,'add','--','js/app.js','index.html',BRIDGE,STYLE);
 git(website,'commit','-m','Add read-only Telegram Stars catalogue and purchase history');
 git(website,'push','origin','main');
 console.log('PASS: Stars read-only frontend pushed to website main. Payments remain OFF.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 try{run();}catch(error){console.error('STARS RELEASE BLOCKED:',error.message);process.exitCode=1;}
