// Watch-only wallet onboarding; deliberately NO mnemonic, xprv, private key,
// signing API, wallet hot-key generation, or automatic spend permission.
import {validateReceivingAddress} from '../address.js';
import {RECEIVER_NETWORKS} from '../asset-registry.js';
const chainSet=new Set(Object.keys(RECEIVER_NETWORKS));
const own=(obj,k)=>Object.prototype.hasOwnProperty.call(obj,k);
const allowedTop=new Set(['walletLabel','addresses']);
const allowedItem=new Set(['chain','address']);
export function canonicalPublicAddress(chain,address){
 if(!chainSet.has(chain)||typeof address!=='string')throw Error('invalid_public_receiver');
 return chain==='ethereum'?address.toLowerCase():address;
}
export async function validatePublicWalletImport(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>!allowedTop.has(k))||
    typeof input.walletLabel!=='string'||!/^[a-zA-Z0-9 ._-]{3,40}$/.test(input.walletLabel)||
    !Array.isArray(input.addresses)||input.addresses.length<1||
    input.addresses.length>25)
  throw Error('invalid_public_wallet_manifest');
 const seen=new Set(),addresses=[];
 for(const item of input.addresses){
  if(!item||typeof item!=='object'||Array.isArray(item)||
     Object.keys(item).some(k=>!allowedItem.has(k))||
     !own(item,'chain')||!own(item,'address'))
   throw Error('public_addresses_only');
  const {chain}=item,address=canonicalPublicAddress(chain,item.address);
  if(!await validateReceivingAddress(chain,address))
   throw Error('invalid_public_receiver');
  const key=chain+':'+address;
  if(seen.has(key))throw Error('duplicate_public_receiver');
  seen.add(key);
  addresses.push({chain,address});
 }
 return {walletLabel:input.walletLabel,addresses};
}
export async function importPublicWalletReceivers(db,input,now=Date.now()){
 const validated=await validatePublicWalletImport(input);
 // Preflight for clean operator feedback. Database UNIQUE constraints provide
 // the ultimate concurrency guarantee in the atomic D1 batch.
 for(const item of validated.addresses){
  const query=item.chain==='ethereum'
   ?'SELECT address FROM deposit_addresses WHERE chain=? AND address=? COLLATE NOCASE LIMIT 1'
   :'SELECT address FROM deposit_addresses WHERE chain=? AND address=? LIMIT 1';
  const conflict=await db.prepare(query).bind(item.chain,item.address).first();
  if(conflict)throw Error('receiver_already_registered');
 }
 const stmts=validated.addresses.map(item=>db.prepare(`INSERT INTO deposit_addresses
   (chain,address,assigned_intent,source,added_at_ms,label,enabled)
   VALUES(?,?,NULL,'wallet_public_import',?,'multi_project_pool',0)`)
   .bind(item.chain,item.address,now));
 const counts={};
 for(const item of validated.addresses)
  counts[item.chain]=(counts[item.chain]||0)+1;
 stmts.push(db.prepare(`INSERT INTO v2_operator_audit
   (id,action,project_id,details,created_at_ms)
   VALUES(?,'import_public_wallet_addresses',NULL,?,?)`)
  .bind(crypto.randomUUID(),JSON.stringify({count:validated.addresses.length,chains:counts}),now));
 await db.batch(stmts);
 return {count:validated.addresses.length,addresses:validated.addresses,
  activated:false,requiresOnChainOwnershipChecks:true};
}
