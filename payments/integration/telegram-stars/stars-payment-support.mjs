// Telegram Stars payment support. Records a durable, idempotent support ticket.
// No automatic Star refund, invoice or game balance change is performed here.
import {telegramApi} from './stars.mjs';
const COMMAND=/^\/(paysupport|payissue)(?:@[A-Za-z0-9_]{5,32})?(?:\s|$)/i;
export function isStarsSupportCommand(update){
 const m=update?.message;
 return typeof m?.text==='string'&&COMMAND.test(m.text)&&m.chat?.type==='private';
}
export async function handleStarsSupportCommand(update,env,fetchImpl=fetch){
 const m=update?.message,uid=m?.from?.id,chat=m?.chat?.id;
 if(!isStarsSupportCommand(update))return false;
 if(!Number.isSafeInteger(update?.update_id)||update.update_id<0||
  !Number.isSafeInteger(uid)||uid<1||chat!==uid||
  typeof env?.PAYMENTS_DB?.prepare!=='function'||!env?.BOT_TOKEN)
  throw Error('stars_support_unavailable');
 const message=m.text.replace(COMMAND,'').trim().slice(0,500);
 const created=Number.isSafeInteger(m.date)&&m.date>0?m.date*1000:Date.now();
 await env.PAYMENTS_DB.prepare(
  'INSERT OR IGNORE INTO rustup_stars_support_requests '+
  '(update_id,telegram_user_id,created_at_ms,description,status) '+
  "VALUES (?,?,?,?,'open')"
 ).bind(update.update_id,uid,created,message).run();
 const prior=await env.PAYMENTS_DB.prepare(
  'SELECT telegram_user_id FROM rustup_stars_support_requests WHERE update_id=?'
 ).bind(update.update_id).first();
 if(prior?.telegram_user_id!==uid)throw Error('stars_support_ticket_conflict');
 const msg='RUST UP: Zahlungsanfrage registriert. Ticket #'+update.update_id+
  '. Bitte bewahre deine Telegram-Transaktions-ID auf. '+
  'Für weitere Angaben sende /payissue mit Beschreibung und Ticketnummer. '+
  'Ein Refund wird geprüft, aber nicht automatisch ausgelöst.';
 // Cloudflare Workers supports only redirect: 'follow' or 'manual'.
 // The shared Telegram client uses 'error', which throws before any request
 // in Workers. 'manual' never follows a cross-origin redirect; a 3xx remains
 // non-ok and the shared client rejects it, preserving Telegram retry.
 const fetchNoRedirect=(url,options)=>fetchImpl(url,{...options,redirect:'manual'});
 await telegramApi({TG_STARS_BOT_TOKEN:env.BOT_TOKEN},'sendMessage',
  {chat_id:chat,text:msg},fetchNoRedirect);
 return true;
}
