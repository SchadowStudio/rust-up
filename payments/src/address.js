// Strict Bitcoin mainnet and TRON receiving-address validation.
// All checks happen without private keys.
import {evm,tronHex} from './assets.js';
import {tonCanonicalAddress} from './ton.js';
const B58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BECH32='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
async function checkBase58(address,version,expectedLength){
 let n=0n;
 for(const c of address){const d=B58.indexOf(c);if(d<0)return false;n=n*58n+BigInt(d);}
 const bytes=[];
 while(n>0n){bytes.push(Number(n&255n));n>>=8n;}
 bytes.reverse();
 for(const c of address){if(c==='1')bytes.unshift(0);else break;}
 if(bytes.length!==expectedLength||!version.includes(bytes[0]))return false;
 const raw=new Uint8Array(bytes);
 const a=await crypto.subtle.digest('SHA-256',raw.slice(0,-4));
 const b=new Uint8Array(await crypto.subtle.digest('SHA-256',a));
 return raw.slice(-4).every((x,i)=>x===b[i]);
}
function poly(values){
 let chk=1;
 const GEN=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
 for(const v of values){
  const top=chk>>>25;
  chk=((chk&0x1ffffff)<<5)^v;
  for(let i=0;i<5;i++)if((top>>>i)&1)chk^=GEN[i];
 }
 return chk;
}
function bech32Validate(address){
 if(address!==address.toLowerCase()&&address!==address.toUpperCase())return false;
 const s=address.toLowerCase(),sep=s.lastIndexOf('1');
 if(sep<1||sep+7>s.length||s.length>90)return false;
 const hrp=s.slice(0,sep);
 if(hrp!=='bc')return false;
 const data=[];
 for(const c of s.slice(sep+1)){
  const idx=BECH32.indexOf(c);
  if(idx<0)return false;
  data.push(idx);
 }
 const check=poly([...hrp].map(x=>x.charCodeAt(0)>>>5).concat([0], [...hrp].map(x=>x.charCodeAt(0)&31),data));
 const witness=data.slice(0,-6),version=witness[0];
 if(!Number.isInteger(version)||version>16)return false;
 if(version===0&&check!==1)return false;
 if(version!==0&&check!==0x2bc830a3)return false;
 let acc=0,bits=0,bytes=[];
 for(const v of witness.slice(1)){
  acc=(acc<<5)|v;bits+=5;
  if(bits>=8){bits-=8;bytes.push((acc>>>bits)&255)}
 }
 if(bits>=5||((acc<<(8-bits))&255)!==0)return false;
 if(bytes.length<2||bytes.length>40)return false;
 return version!==0||[20,32].includes(bytes.length);
}
export async function validateReceivingAddress(chain,address){
 if(typeof address!=='string'||address.length>128)return false;
 if(chain==='ethereum'){try{evm(address);return true}catch{return false}}
 if(chain==='tron'){try{await tronHex(address);return true}catch{return false}}
 if(chain==='ton'){try{tonCanonicalAddress(address);return true}catch{return false}}
 if(chain==='bitcoin'){
  if(/^bc1/i.test(address))return bech32Validate(address);
  if(/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(address))
   return checkBase58(address,[0,5],25);
 }
 return false;
}
