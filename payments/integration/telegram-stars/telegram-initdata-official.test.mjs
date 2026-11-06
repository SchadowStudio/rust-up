import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifiedTelegramInitData} from './telegram-initdata.mjs';

// Public test vector from Telegram Mini Apps docs; no live secrets.
const token='5768337691:AAH5YkoiEuPk8-FZa32hStHTqXiLPtAEhx8';
const raw='query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A279058397%2C%22first_name%22%3A%22Vladislav%22%2C%22last_name%22%3A%22Kibenko%22%2C%22username%22%3A%22vdkfrost%22%2C%22language_code%22%3A%22ru%22%2C%22is_premium%22%3Atrue%7D&auth_date=1662771648&hash=c501b71e775f74ce10e377dea85a7ea24ecd640b223ea86dfe453e0eaed2e2b2';
const now=1662771648*1000+10000;

test('validates the official Telegram HMAC Mini App example',async()=>{
 const result=await verifiedTelegramInitData(raw,token,now,600);
 assert.deepEqual(result,{userId:279058397,authDate:1662771648});
});
test('validates Telegram bot-token HMAC including its optional signature attribute',async()=>{
 // A third-party Ed25519 signature is an ordinary signed parameter in bot-token HMAC.
 const params=new URLSearchParams(raw);
 params.set('signature','example-ed25519-signature');
 params.delete('hash');
 const check=[...params.entries()].sort(([a],[b])=>a.localeCompare(b))
  .map(([key,value])=>key+'='+value).join('\n');
 const secret=createHmac('sha256','WebAppData').update(token).digest();
 const hash=createHmac('sha256',secret).update(check).digest('hex');
 params.set('hash',hash);
 assert.deepEqual(await verifiedTelegramInitData(params.toString(),token,now,600),
  {userId:279058397,authDate:1662771648});
 // Removing or altering 'signature' must invalidate its hash; never silently omit it.
 params.set('signature','tampered-ed25519-signature');
 await assert.rejects(()=>verifiedTelegramInitData(params.toString(),token,now,600),
  /invalid_telegram_auth/);
});
test('rejects previously accepted injected signature on an unsigned Telegram vector',async()=>{
 await assert.rejects(()=>
  verifiedTelegramInitData(raw+'&signature=irrelevant_for_bot_token_hmac',token,now,600),
  /invalid_telegram_auth/);
});
test('rejects a wrong bot token while keeping the original signed data',async()=>{
 const wrong='123456789:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';
 await assert.rejects(()=>verifiedTelegramInitData(raw,wrong,now,600),
  /invalid_telegram_auth/);
});
test('rejects genuine but expired sessions without disabling HMAC validation',async()=>{
 await assert.rejects(()=>verifiedTelegramInitData(raw,token,now+86401*1000,86400),
  /expired_telegram_auth/);
});
test('rejects tampering and does not trust user data without HMAC',async()=>{
 const data=new URLSearchParams(raw);
 data.set('user',JSON.stringify({id:999999}));
 await assert.rejects(()=>verifiedTelegramInitData(data.toString(),token,now,600),
  /invalid_telegram_auth/);
});
