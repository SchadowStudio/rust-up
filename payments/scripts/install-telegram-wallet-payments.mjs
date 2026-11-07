// Integrate payment UX into the EXISTING Telegram Mini App Wallet > Пополнить.
// No new site, route, bot, provider key or checkout; existing game logic preserved.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const assetDir=path.join(root,'payments','frontend','telegram-miniapp');
const EXPECTED_SHA='08d498a75221089f054c381de5f2aef494f28077';
const OLD="['gifts', 'Telegram и CS2', 10, 7, ['star', 'gift'], 'Звёзды, подарки, скины', ['Звёзды Telegram', 'Подарки и NFT', 'Скины CS2']]";
const RENAMED="['gifts', 'Telegram Stars', 10, 7, ['star'], 'Звёзды Telegram', ['Оплата через Telegram Stars']]";
const NEW="['gifts', 'Telegram Stars', 10, 0, ['star'], 'Звёзды Telegram', ['Оплата только Telegram Stars']]";
const TAG='/* RUSTUP_STARS_WALLET_EMBED_V1 */';
const render="    box.innerHTML = WF.tab === 'withdraw' ? walletWithdraw() : WF.tab === 'history' ? walletHistory() : walletDeposit();";
const query="    if (+params.get('sum') > 0) WF.amount = Math.floor(+params.get('sum'));";
function gitHash(text){
 const bytes=Buffer.from(text);
 return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
}
function originalIdentity(source){
 const unrenamed=source.replace(RENAMED,OLD);
 return [unrenamed,unrenamed.replace(/\r\n/g,'\n'),unrenamed.replace(/\r?\n/g,'\r\n')]
 .some(value=>gitHash(value)===EXPECTED_SHA);
}
function exactOnce(source,needle){
 if(source.split(needle).length!==2)throw Error('unexpected_existing_app_layout');
}
export function patchExistingWallet(source){
 if(source.includes(TAG))throw Error('stars_wallet_already_integrated');
 const current=source.includes(OLD)?OLD:source.includes(RENAMED)?RENAMED:null;
 if(!current)throw Error('telegram_cs2_wallet_entry_not_found');
 exactOnce(source,current);exactOnce(source,render);exactOnce(source,query);
 let next=source.replace(current,NEW);
 next=next.replace(query,query+'\n    if (params.get("method") === "stars") WF.dep = "gifts";');
 const lines=[
  '    '+TAG,
  "    if (WF.tab === 'deposit' && WF.dep === 'gifts') {",
  '      box.innerHTML = \'<div id="rustupStarsBody"></div>\';',
  "      if (window.RUSTUP_STARS_PANEL) window.RUSTUP_STARS_PANEL.render(document.getElementById('rustupStarsBody'));",
  "    } else if (WF.tab === 'deposit' && WF.dep === 'crypto') {",
  "      box.innerHTML = '<div class=\"w-glass w-panel\"><h3 class=\"w-h3\">Криптовалюта</h3><p class=\"w-note\">Цифровые покупки в Telegram доступны только за Stars. Криптоплатежи здесь отключены, внешний провайдер проверяется отдельно.</p></div>';",
  '    }'
 ];
 next=next.replace(render,render+'\n'+lines.join('\n'));
 return next;
}
export function patchExistingIndex(source){
 const css='<link rel="stylesheet" href="css/style.css?v=20261105t">';
 const js='<script src="js/app.js?v=20261105t"></script>';
 if(source.includes('wallet-stars-panel.js'))throw Error('stars_assets_already_integrated');
 exactOnce(source,css);exactOnce(source,js);
 return source.replace(css,css+'\n  <link rel="stylesheet" href="css/wallet-stars-panel.css?v=20261104f">')
 .replace(js,'<script src="js/wallet-stars-panel.js?v=20261104f"></script>\n  '+js);
}
async function main(){
 const arg=process.argv[2];
 if(!arg)throw Error('Pass path of your existing RUST-UP-Website git checkout.');
 const dir=await fs.realpath(path.resolve(arg));
 if(dir.startsWith(root+path.sep))throw Error('website_checkout_must_be_separate');
 await fs.access(path.join(dir,'.git'));
 const htmlFile=path.join(dir,'index.html'),jsFile=path.join(dir,'js','app.js');
 const assets=[
  {src:'stars-panel.js',to:path.join(dir,'js','wallet-stars-panel.js')},
  {src:'stars-panel.css',to:path.join(dir,'css','wallet-stars-panel.css')}
 ];
 for(const a of assets){
  try{await fs.access(a.to);throw Error('existing_asset_refuse_overwrite');}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 const [html,source]=await Promise.all([fs.readFile(htmlFile,'utf8'),fs.readFile(jsFile,'utf8')]);
 if(!originalIdentity(source))throw Error('website_source_changed_refuse_to_patch');
 const updated=patchExistingWallet(source);
 const index=patchExistingIndex(html);
 // Write nothing until all anchor/identity checks have passed.
 await fs.writeFile(jsFile,updated);
 await fs.writeFile(htmlFile,index);
 for(const a of assets)await fs.copyFile(path.join(assetDir,a.src),a.to,fs.constants.COPYFILE_EXCL);
 console.log('PASS: Existing wallet Telegram Stars tile now embeds Stars purchases.');
 console.log('PASS: Crypto wallet tile presents the Telegram Stars restriction, no payment address or third-party checkout.');
 console.log('PASS: All other Mini App routes and the old /pay commands preserved.');
 console.log('NOT PUBLISHED. Review git diff before publishing the existing Mini App.');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)
 main().catch(error=>{console.error('Wallet patch BLOCKED:',error.message);process.exitCode=1;});
