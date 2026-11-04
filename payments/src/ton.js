// Strict TON mainnet user-friendly address handling (TEP-0002).
// Only public wallet addresses. No mnemonic, xprv or signing authority.
const ADDRESS_RE=/^[A-Za-z0-9_-]{48}$/;
const HEX=/^[0-9a-f]{64}$/i;
function crc16(bytes){
 let crc=0;
 for(const n of bytes){
  crc^=n<<8;
  for(let i=0;i<8;i++)
   crc=((crc&0x8000)?(crc<<1)^0x1021:crc<<1)&0xffff;
 }
 return crc;
}
function b64Decode(s){
 if(typeof s!=='string'||!/^[A-Za-z0-9+/_-]+={0,2}$/.test(s))
  throw Error('invalid_ton_encoding');
 const normalized=s.replace(/-/g,'+').replace(/_/g,'/');
 const padded=normalized.padEnd(Math.ceil(normalized.length/4)*4,'=');
 let raw;
 try{raw=atob(padded)}catch{throw Error('invalid_ton_encoding')}
 return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
function b64Url(bytes){
 return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-')
  .replace(/\//g,'_').replace(/=+$/,'');
}
function bytesHex(bytes){
 return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function tonAddressInfo(address){
 if(typeof address!=='string'||!ADDRESS_RE.test(address))
  throw Error('ton_user_friendly_address_required');
 const data=b64Decode(address);
 if(data.length!==36)throw Error('invalid_ton_address_size');
 if(data[0]!==0x11&&data[0]!==0x51)
  throw Error('invalid_or_testnet_ton_address');
 // For payments we support standard basechain wallets only, not masterchain.
 if(data[1]!==0x00)throw Error('unsupported_ton_workchain');
 const checksum=crc16(data.slice(0,34));
 if(data[34]!==checksum>>8||data[35]!== (checksum&255))
  throw Error('invalid_ton_address_checksum');
 const raw='0:'+bytesHex(data.slice(2,34));
 // Normalize to non-bounceable for wallet deposit invoices; this is
 // the same on-chain account as the bounceable EQ... address.
 const normalized=new Uint8Array(data);
 normalized[0]=0x51;
 const sum=crc16(normalized.slice(0,34));
 normalized[34]=sum>>8;normalized[35]=sum&255;
 return {raw,receiveAddress:b64Url(normalized)};
}
export function tonCanonicalAddress(address){
 return tonAddressInfo(address).receiveAddress;
}
export function tonRawAddress(address){
 if(typeof address==='string'&&/^0:[a-f0-9]{64}$/i.test(address))
  return '0:'+address.slice(2).toLowerCase();
 return tonAddressInfo(address).raw;
}
export function tonHashHex(hash){
 if(typeof hash!=='string')throw Error('invalid_ton_hash');
 if(HEX.test(hash))return hash.toLowerCase();
 if(!/^[A-Za-z0-9+/_-]{43}=?$/.test(hash))
  throw Error('invalid_ton_hash');
 const decoded=b64Decode(hash);
 if(decoded.length!==32)throw Error('invalid_ton_hash');
 return bytesHex(decoded);
}
