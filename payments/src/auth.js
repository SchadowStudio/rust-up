// Telegram Mini App HMAC verification. Client-supplied player IDs are never authoritative.
const bytes=s=>new TextEncoder().encode(s);
async function mac(key,text){
 const k=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return new Uint8Array(await crypto.subtle.sign('HMAC',k,bytes(text)));
}
const hex=a=>[...a].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function verifiedTelegramId(initData,botToken,now=Date.now()){
 if(!botToken||typeof initData!=='string'||initData.length>8192)throw new Error('unauthorized');
 const p=new URLSearchParams(initData),hash=p.get('hash');
 if(!hash||!/^[0-9a-f]{64}$/i.test(hash))throw new Error('unauthorized');
 const entries=[...p.entries()];
 if(entries.length!==new Set(entries.map(([k])=>k)).size)throw new Error('unauthorized');
 const check=entries.filter(([k])=>k!=='hash').sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v).join('\n');
 const secret=await mac(bytes('WebAppData'),botToken);
 const signed=hex(await mac(secret,check));
 let diff=0;const target=hash.toLowerCase();
 for(let i=0;i<64;i++)diff|=signed.charCodeAt(i)^target.charCodeAt(i);
 if(diff)throw new Error('unauthorized');
 const authDate=Number(p.get('auth_date'));
 if(!Number.isSafeInteger(authDate)||authDate<1||authDate*1000>now+60000||now-authDate*1000>3600000)throw new Error('expired_auth');
 let user;
 try{user=JSON.parse(p.get('user')||'');}catch{throw new Error('unauthorized');}
 if(!user||!Number.isSafeInteger(user.id)||user.id<=0)throw new Error('unauthorized');
 return String(user.id);
}
