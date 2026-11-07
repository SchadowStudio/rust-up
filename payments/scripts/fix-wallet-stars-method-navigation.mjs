// Repair navigation in the existing RUST UP Mini App wallet after the Stars embed.
// Earlier code replaced the entire wallet deposit markup, hiding payment choices.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const verifiedSha='ac730f09668dc1896b2e2f97737653840696db02';
const tag='/* RUSTUP_STARS_WALLET_EMBED_V1 */';
const repaired='/* RUSTUP_STARS_KEEP_PAYMENT_CHOICES_V1 */';
const oldStars="      box.innerHTML = '<div id=\"rustupStarsBody\"></div>';";
const oldCrypto="      box.innerHTML = '<div class=\"w-glass w-panel\"><h3 class=\"w-h3\">Криптовалюта</h3><p class=\"w-note\">Цифровые покупки в Telegram доступны только за Stars. Криптоплатежи здесь отключены, внешний провайдер проверяется отдельно.</p></div>';";
function hash(s){const b=Buffer.from(s);return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');}
export function patchPaymentMethodNavigation(text){
 if(text.includes(repaired))throw Error('wallet_choices_already_fixed');
 if(!text.includes(tag)||text.split(oldStars).length!==2||text.split(oldCrypto).length!==2)
  throw Error('unknown_wallet_layout_refuse');
 const patchedStars=[
  '      '+repaired,
  "      const methodChoices = box.querySelector('.wm-grid')?.outerHTML || '';",
  "      box.innerHTML = methodChoices + '<div id=\"rustupStarsBody\"></div>';"
 ].join('\n');
 const patchedCrypto=[
  "      const methodChoices = box.querySelector('.wm-grid')?.outerHTML || '';",
  oldCrypto.replace('box.innerHTML = ', 'box.innerHTML = methodChoices + ')
 ].join('\n');
 return text.replace(oldStars,patchedStars).replace(oldCrypto,patchedCrypto);
}
async function main(){
 if(!process.argv[2])throw Error('Pass existing RUST-UP-Website directory.');
 const dir=await fs.realpath(path.resolve(process.argv[2]));
 await fs.access(path.join(dir,'.git'));
 const file=path.join(dir,'js','app.js');
 const source=await fs.readFile(file,'utf8');
 if(![hash(source),hash(source.replace(/\r\n/g,'\n'))].includes(verifiedSha))
  throw Error('website_source_changed_since_review_refuse');
 await fs.writeFile(file,patchPaymentMethodNavigation(source));
 console.log('PASS: Stars, crypto, and ruble deposit method selectors stay visible.');
 console.log('No payment switch or real game balance changed. NOT PUBLISHED.');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)
 main().catch(e=>{console.error('Wallet navigation patch BLOCKED:',e.message);process.exitCode=1;});
