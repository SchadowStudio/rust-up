// All supported assets and their networks are centrally reviewed in one manifest.
import {ASSETS} from './asset-registry.js';
import {tonHashHex} from './ton.js';
export {ASSETS};
export const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export function decimalToAtomic(amount, decimals) {
 if(typeof amount!=='string'||!/^(0|[1-9][0-9]{0,24})(\.[0-9]{1,18})?$/.test(amount)) throw new Error('invalid_amount');
 const [whole,fraction='']=amount.split('.');
 if(fraction.length>decimals) throw new Error('invalid_precision');
 const result=BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0')||'0');
 if(result<=0n) throw new Error('invalid_amount');
 return result.toString();
}
export function formatAtomic(atomic,decimals) {
 if(!/^[0-9]+$/.test(String(atomic))) throw new Error('invalid_amount');
 const n=BigInt(atomic),d=10n**BigInt(decimals);
 const fractional=(n%d).toString().padStart(decimals,'0').replace(/0+$/,'');
 return (n/d).toString()+(fractional?'.'+fractional:'');
}
export function txId(asset,hash) {
 if(!ASSETS[asset]) throw new Error('unsupported_asset');
 const h=ASSETS[asset].chain==='ton'?tonHashHex(hash):String(hash||'').trim().toLowerCase();
 const re=ASSETS[asset].chain==='ethereum'?/^0x[a-f0-9]{64}$/:/^[a-f0-9]{64}$/;
 if(!re.test(h)) throw new Error('invalid_transaction_id');
 return h;
}
export function validAddress(chain,addr) {
 if(typeof addr!=='string') return false;
 if(chain==='ethereum') return /^0x[a-f0-9]{40}$/i.test(addr);
 if(chain==='tron') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr);
 if(chain==='ton')return /^[EU][Qf][a-zA-Z0-9_-]{46}$/.test(addr);
 if(chain==='bitcoin') return /^(bc1[ac-hj-np-z02-9]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/i.test(addr);
 return false;
}
export function evm(addr) {if(!validAddress('ethereum',addr))throw new Error('invalid_evm_address');return addr.toLowerCase();}
export function hexBig(value) {if(!/^0x[0-9a-f]+$/i.test(String(value)))throw new Error('invalid_hex');return BigInt(value);}
export async function tronHex(base58) {
 if(!validAddress('tron',base58))throw new Error('invalid_tron_address');
 const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
 let num=0n;
 for(const c of base58){const d=alphabet.indexOf(c);if(d<0)throw new Error('invalid_tron_address');num=num*58n+BigInt(d);}
 const bytes=new Uint8Array(25);
 for(let i=24;i>=0;i--){bytes[i]=Number(num&255n);num>>=8n;}
 if(num!==0n||bytes[0]!==65)throw new Error('invalid_tron_address');
 const one=await crypto.subtle.digest('SHA-256',bytes.slice(0,21));
 const two=new Uint8Array(await crypto.subtle.digest('SHA-256',one));
 for(let i=0;i<4;i++)if(two[i]!==bytes[21+i])throw new Error('invalid_tron_checksum');
 return [...bytes.slice(0,21)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
