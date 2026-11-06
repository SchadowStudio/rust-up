// Server-side Telegram Mini App auth. Never use initDataUnsafe for identity.
const text = value => new TextEncoder().encode(value);
const hex = bytes => Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
async function hmac(key,data) {
  const imported=await crypto.subtle.importKey('raw',key,
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',imported,text(data)));
}
function constantEqual(a,b) {
  if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
  let mismatch=0;
  for(let i=0;i<a.length;i++)mismatch |= a.charCodeAt(i)^b.charCodeAt(i);
  return mismatch===0;
}
export async function verifiedTelegramInitData(raw,botToken,now=Date.now(),maxAgeSeconds=600) {
  // Short-lived by default for payment-sensitive callers. Explicit 24h maximum
  // is allowed ONLY for a separate read-only endpoint with checkout disabled.
  if(!Number.isSafeInteger(maxAgeSeconds)||maxAgeSeconds<60||
     maxAgeSeconds>86400)
    throw Error('invalid_telegram_auth_max_age');
  if(typeof raw!=='string'||raw.length>4096||raw.length<20||
     typeof botToken!=='string'||botToken.length<25)
    throw Error('invalid_telegram_auth');
  const pairs=new URLSearchParams(raw);
  const entries=[...pairs.entries()];
  if(entries.length>30||new Set(entries.map(([key])=>key)).size!==entries.length)
    throw Error('invalid_telegram_auth');
  const provided=pairs.get('hash');
  if(!/^[a-f0-9]{64}$/i.test(provided||''))
    throw Error('invalid_telegram_auth');
  const authDate=Number(pairs.get('auth_date'));
  const current=Math.floor(now/1000);
  if(!Number.isSafeInteger(authDate)||authDate>current+60||
    authDate<current-maxAgeSeconds) throw Error('expired_telegram_auth');
  // Telegram bot-token HMAC includes 'signature' when present. Only 'hash' is excluded.
  // Excluding 'signature' is valid for THIRD-PARTY Ed25519 verification, not this path.
  const check=entries.filter(([key])=>key!=='hash')
    .sort(([a],[b])=>a.localeCompare(b))
    .map(([key,value])=>key+'='+value).join('\n');
  const secret=await hmac(text('WebAppData'),botToken);
  const signature=hex(await hmac(secret,check));
  if(!constantEqual(signature,provided.toLowerCase()))
    throw Error('invalid_telegram_auth');
  let user;
  try {user=JSON.parse(pairs.get('user')||'null');}
  catch {throw Error('invalid_telegram_user');}
  if(!user||!Number.isSafeInteger(user.id)||user.id<1)
    throw Error('invalid_telegram_user');
  return {userId:user.id,authDate};
}
