// Change ONLY the existing Wallet > Deposit "Telegram и CS2" option.
// Keeps the same internal 'gifts' id to preserve existing navigation/state.
// Patches a separate ttzoomrust-hub/rust-up checkout; never deploys or pushes.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const expected='08d498a75221089f054c381de5f2aef494f28077';
const original="['gifts', 'Telegram и CS2', 10, 7, ['star', 'gift'], 'Звёзды, подарки, скины', ['Звёзды Telegram', 'Подарки и NFT', 'Скины CS2']]";
const updated="['gifts', 'Telegram Stars', 10, 7, ['star'], 'Звёзды Telegram', ['Оплата через Telegram Stars']]";

function gitBlob(text){
  const canon=Buffer.from(text);
  return createHash('sha1').update('blob '+canon.length+'\0').update(canon).digest('hex');
}
export function patchWalletMethod(source){
  if(source.includes(updated))throw Error('wallet_stars_already_patched');
  if(source.split(original).length!==2)throw Error('wallet_method_source_changed');
  return source.replace(original,updated);
}
async function main(){
  const input=process.argv[2];
  if(!input)throw Error('Usage: node payments/scripts/wallet-telegram-stars-only.mjs "<RUST-UP-Website-checkout>"');
  const dir=await fs.realpath(path.resolve(input));
  await fs.access(path.join(dir,'.git'));
  const file=path.join(dir,'js','app.js');
  const current=await fs.readFile(file,'utf8');
  const verified=[current,current.replace(/\r\n/g,'\n'),current.replace(/\r?\n/g,'\r\n')]
    .some(version=>gitBlob(version)===expected);
  if(!verified)throw Error('website_js_app_modified_refuse_overwrite');
  await fs.writeFile(file,patchWalletMethod(current));
  console.log('PASS: Existing Telegram и CS2 option renamed to Telegram Stars.');
  console.log('PASS: CS2 and gift icons/descriptions removed from this payment option.');
  console.log('PASS: Existing wallet, payment demo behavior, games and other options unchanged.');
  console.log('NOT PUBLISHED: review git diff, then commit/push site checkout separately.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(e=>{console.error('Website patch blocked:',e.message);process.exitCode=1;});
