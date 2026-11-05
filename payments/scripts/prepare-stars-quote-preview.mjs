// Prepare a read-only Telegram Stars quote preview config for the existing bot.
// Does NOT enable payments or credit game/wager balances; no real invoices.
// Merchant sets the RUB minor-unit ratio explicitly; NO assumed market rate.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {quoteVariableStars} from '../integration/telegram-stars/variable-stars.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.private','rustup-bot-recovered')+path.sep;
const CONFIG='wrangler.stars-variable.toml';
const PREVIEW='wrangler.stars-quote-preview.toml';
const PRICE_VARS=['STARS_MIN_RUB_MINOR','STARS_MAX_RUB_MINOR',
 'STARS_RUB_MINOR_PER_STAR_NUM','STARS_RUB_MINOR_PER_STAR_DEN'];
const PAYMENT_FLAGS=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'];
const DECIMAL=/^[1-9]\d{0,14}$/;

export function buildStarsQuotePreviewConfig(base,settings){
 if(typeof base!=='string'||base.length<300||base.length>20000)
  throw Error('unrecognized_worker_config');
 if(!settings||typeof settings!=='object')throw Error('missing_owner_pricing');
 const vals=PRICE_VARS.map(name=>settings[name]);
 if(!vals.every(value=>typeof value==='string'&&DECIMAL.test(value)))
  throw Error('invalid_owner_rate_integer');
 const [min,max,num,den]=vals.map(value=>BigInt(value));
 if(min>max||max>100000000n)throw Error('quote_amount_bounds_invalid');
 const env=Object.fromEntries(PRICE_VARS.map((name,i)=>[name,vals[i]]));
 // Both ends must stay within Telegram's 1 to 1,000,000 Stars amount range.
 quoteVariableStars(Number(min),env);
 quoteVariableStars(Number(max),env);
 if(!base.includes('name = "rustup-bot"')||
    !base.includes('main = "./worker.stars-variable.bundle.js"')||
    !base.includes('keep_vars = true')||
    !base.includes('upload_source_maps = true')||
    !base.includes('binding = "DB"')||
    !base.includes('binding = "PAYMENTS_DB"')||
    !base.includes('crons = ["* * * * *"]'))
  throw Error('current_worker_baseline_changed');
 for(const name of PAYMENT_FLAGS){
  const text=name+' = "false"';
  if(base.split(text).length!==2)throw Error('payment_gate_not_safely_off_'+name);
 }
 for(const name of PRICE_VARS){
  if(new RegExp('^'+name+'\\s*=', 'm').test(base))
   throw Error('quote_rate_already_present_in_baseline');
 }
 const delimiter='\n[secrets]';
 if(base.split(delimiter).length!==2||base.split('\n[vars]').length!==2)
  throw Error('unknown_wrangler_vars_layout');
 const additional=PRICE_VARS.map((name,i)=>name+' = "'+vals[i]+'"').join('\n');
 const patched=base.replace(delimiter,'\n'+additional+delimiter);
 for(const flag of PAYMENT_FLAGS){
  if(patched.split(flag+' = "false"').length!==2)
   throw Error('preview_must_preserve_off_payment_gate');
 }
 return patched;
}
async function main(){
 const dirArg=process.argv[2];
 if(process.argv.length!==7||!dirArg)
  throw Error('Usage: node payments/scripts/prepare-stars-quote-preview.mjs "<private bot recovery>" MIN_RUB_MINOR MAX_RUB_MINOR RUB_MINOR_PER_STAR_NUM RUB_MINOR_PER_STAR_DEN');
 const folder=await fs.realpath(path.resolve(dirArg));
 if(!folder.startsWith(PRIVATE))throw Error('private_bot_snapshot_required');
 const values=process.argv.slice(3);
 const env=Object.fromEntries(PRICE_VARS.map((name,i)=>[name,values[i]]));
 const baseline=await fs.readFile(path.join(folder,CONFIG),'utf8');
 const proposed=buildStarsQuotePreviewConfig(baseline,env);
 const output=path.join(folder,PREVIEW);
 await fs.writeFile(output,proposed,{flag:'wx',mode:0o600});
 const quote=quoteVariableStars(Number(env.STARS_MIN_RUB_MINOR),env);
 console.log('PASS: Read-only Stars price preview config prepared privately.');
 console.log('Minimum amount quote: '+quote.requestedAmountMinor+' RUB minor units -> '+quote.priceStars+' Stars.');
 console.log('All seven hard payment/game-wallet gates OFF. No invoices created.');
 console.log('Private config: '+output);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{
  console.error('STARS QUOTE PREVIEW BLOCKED:',String(e?.message||e));
  process.exitCode=1;
 });
