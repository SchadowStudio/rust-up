// RUST UP payment administration. No payment creation or game-wallet credit.
// Runtime switches are stored in D1; hard production gates remain in environment.
// Intended for the EXISTING authenticated /tg handler, without replacing it.
const CHANNELS=new Set(['master','stars','crypto']);
const SAFE_ID=/^[1-9][0-9]{0,15}$/;

function adminIds(env){
  const raw=env?.PAYMENT_ADMIN_IDS;
  if(typeof raw!=='string'||raw.length>500)return new Set();
  return new Set(raw.split(',').map(x=>x.trim())
    .filter(x=>SAFE_ID.test(x)&&Number.isSafeInteger(Number(x))));
}
export function isPaymentAdmin(id,env){
  return Number.isSafeInteger(id)&&id>0&&adminIds(env).has(String(id));
}
export async function readPaymentSwitches(db){
  if(!db||typeof db.prepare!=='function')throw Error('payment_controls_db_missing');
  const result=await db.prepare(
    'SELECT channel,enabled FROM rustup_payment_settings WHERE channel IN (?,?,?)'
  ).bind('master','stars','crypto').all();
  const rows=result?.results;
  if(!Array.isArray(rows)||rows.length!==3)
    throw Error('payment_controls_not_migrated');
  const controls=Object.create(null);
  for(const row of rows){
    if(!CHANNELS.has(row.channel)||!(row.enabled===0||row.enabled===1)||
       Object.hasOwn(controls,row.channel))
      throw Error('payment_controls_invalid');
    controls[row.channel]=row.enabled===1;
  }
  if(Object.keys(controls).length!==3)throw Error('payment_controls_invalid');
  return controls;
}
export function hardPaymentGate(env,channel){
  if(!CHANNELS.has(channel)||channel==='master')return false;
  if(env?.PAYMENT_PRODUCTION_ENABLED!=='true')return false;
  if(channel==='stars')
    return env.STARS_PAYMENT_ENABLED==='true';
  return env.EXTERNAL_VARIABLE_CRYPTO_CHECKOUT_ENABLED==='true';
}
export async function isPaymentEnabled(env,channel){
  // Fail closed on missing migration, DB failure or unset hard gates.
  if(!hardPaymentGate(env,channel))return false;
  try{
    const s=await readPaymentSwitches(env.DB);
    return s.master&&s[channel];
  }catch{return false;}
}
function parseCommand(s,env){
  if(typeof s!=='string'||s.length>120)return null;
  const match=/^\/(pay|payments)(?:@([A-Za-z0-9_]{5,32}))?(?:\s+(.*))?$/i.exec(s.trim());
  if(!match)return null;
  const username=match[2];
  const bot=env?.PAYMENT_BOT_USERNAME||env?.BOT_USERNAME;
  if(username&&(!bot||username.toLowerCase()!==String(bot).replace(/^@/,'').toLowerCase()))
    return null;
  const args=(match[3]||'status').trim().toLowerCase().split(/\s+/);
  if(args.length===1&&args[0]==='status')return {type:'status'};
  if(args.length===1&&args[0]==='off')return {type:'set',channel:'master',enabled:false};
  if(args.length===3&&args[0]==='set'&&CHANNELS.has(args[1])&&
     (args[2]==='on'||args[2]==='off'))
    return {type:'set',channel:args[1],enabled:args[2]==='on'};
  if(args.length===2&&CHANNELS.has(args[0])&&
     (args[1]==='on'||args[1]==='off'))
    return {type:'set',channel:args[0],enabled:args[1]==='on'};
  return {type:'help'};
}
function statusMessage(s,env){
  const on=k=>s[k]?'ON':'OFF';
  const effective=k=>(s.master&&s[k]&&hardPaymentGate(env,k))?'YES':'NO';
  return [
    'RUST UP — payment controls',
    'Master: '+on('master'),
    'Stars: '+on('stars'),
    'Crypto: '+on('crypto'),
    'Stars accepting payments: '+effective('stars'),
    'Crypto accepting payments: '+effective('crypto'),
    'Production gate: '+(env.PAYMENT_PRODUCTION_ENABLED==='true'?'ON':'OFF'),
    'Commands: /pay stars on|off; /pay crypto on|off; /pay master on|off; /pay off',
    'Changes are audit-logged. Existing receipts still require reconciliation.'
  ].join('\n');
}
/**
 * Must be called ONLY after Telegram's webhook secret is verified.
 * Uses an injected send function so the existing bot's Telegram API client
 * is reused: sendMessage(chatId, plainText) => Promise<void>.
 */
export async function handlePaymentAdminCommand(update,env,{sendMessage}={}){
  const msg=update?.message;
  const command=parseCommand(msg?.text,env);
  if(!command)return {handled:false};
  const userId=msg?.from?.id;
  // Admin commands are accepted in a private chat, not a forwarded message,
  // a group, or a user-controlled API request.
  if(!isPaymentAdmin(userId,env)||msg?.chat?.type!=='private'||
     msg.chat.id!==userId||msg.forward_origin||msg.sender_chat)
    return {handled:true,authorized:false};
  if(typeof sendMessage!=='function')throw Error('payment_admin_sender_missing');
  let switches;
  try{switches=await readPaymentSwitches(env.DB);}
  catch{
    await sendMessage(userId,'Payments unavailable: settings database missing. No changes made.');
    return {handled:true,authorized:true,ok:false};
  }
  if(command.type==='help'){
    await sendMessage(userId,'Usage: /pay status | /pay stars on|off | /pay crypto on|off | /pay master on|off | /pay off');
    return {handled:true,authorized:true,ok:true};
  }
  if(command.type==='status'){
    await sendMessage(userId,statusMessage(switches,env));
    return {handled:true,authorized:true,ok:true,settings:switches};
  }
  const next=command.enabled?1:0;
  if(switches[command.channel]!==command.enabled){
    const result=await env.DB.prepare(
      'UPDATE rustup_payment_settings SET enabled=?,updated_at_ms=?,updated_by=? WHERE channel=? AND enabled<>?'
    ).bind(next,Date.now(),userId,command.channel,next).run();
    if(result?.meta?.changes!==1)
      throw Error('payment_control_concurrent_change');
  }
  switches=await readPaymentSwitches(env.DB);
  await sendMessage(userId,statusMessage(switches,env));
  return {handled:true,authorized:true,ok:true,updated:command.channel,
    enabled:switches[command.channel]};
}
