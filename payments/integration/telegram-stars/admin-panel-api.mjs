// Admin Mini App payment-settings API for @rustuperhelp_bot.
// Called only AFTER existing /api/adm/* Telegram initData signature verification
// (ADMIN_BOT_TOKEN) AND existing isAdmin(env, user) permission check.
// It never creates invoices, credits players, or enables hard production gates.
import {readPaymentSwitches,hardPaymentGate} from './payment-controls.mjs';
const CHANNELS=new Set(['master','stars','crypto']);
const SAFE_ID=/^[1-9][0-9]{0,15}$/;
const ERROR=(error)=>({ok:false,error});

export function publicPaymentPanelState(switches,env,rows=[],audit=[]){
  return {
    ok:true,
    controls:{master:!!switches.master,stars:!!switches.stars,crypto:!!switches.crypto},
    effective:{
      stars:!!(switches.master&&switches.stars&&hardPaymentGate(env,'stars')),
      crypto:!!(switches.master&&switches.crypto&&hardPaymentGate(env,'crypto'))
    },
    productionEnabled:env?.PAYMENT_PRODUCTION_ENABLED==='true',
    channels:rows.map(r=>({
      channel:r.channel,
      enabled:r.enabled===1,
      updatedAt:Number(r.updated_at_ms)||0,
      updatedBy:Number(r.updated_by)||0
    })),
    history:audit.map(r=>({
      channel:r.channel,from:r.old_enabled===1,to:r.new_enabled===1,
      adminId:Number(r.telegram_admin_id),at:Number(r.occurred_at_ms)
    }))
  };
}
export async function handleAdminPaymentPanelApi(path,body,env,user){
  // Defense in depth: the caller MUST already authenticate and authorize via
  // Telegram admin Mini App. Reject missing, invalid, or non-integer identity.
  if(!SAFE_ID.test(String(user?.id||''))||!Number.isSafeInteger(Number(user.id)))
    return ERROR('admin_identity_required');
  if(path!=='payments'&&path!=='payments-set')return ERROR('unknown_payment_action');
  const db=env?.PAYMENTS_DB;
  if(!db||typeof db.prepare!=='function')return ERROR('payment_controls_unavailable');
  const who=Number(user.id);
  try{
    const old=await readPaymentSwitches(db);
    if(path==='payments-set'){
      const channel=body?.channel;
      if(typeof channel!=='string'||!CHANNELS.has(channel)||
         typeof body?.enabled!=='boolean'||
         typeof body?.expected!=='boolean'||
         body?.confirmation!=='CONFIRM_PAYMENT_SWITCH')
        return ERROR('invalid_payment_control_request');

      // CAS prevents stale UI from overwriting another admin's changes.
      // Explicit emergency stop is still possible with expected=true.
      if(old[channel]!==body.expected)return ERROR('stale_payment_control_state');
      if(old[channel]!==body.enabled){
        const r=await db.prepare(
          'UPDATE rustup_payment_settings SET enabled=?,updated_at_ms=?,updated_by=? '+
          'WHERE channel=? AND enabled=?'
        ).bind(body.enabled?1:0,Date.now(),who,channel,old[channel]?1:0).run();
        if(r?.meta?.changes!==1)return ERROR('stale_payment_control_state');
      }
    }
    const now=await readPaymentSwitches(db);
    const [rowResult,auditResult]=await Promise.all([
      db.prepare('SELECT channel,enabled,updated_at_ms,updated_by FROM rustup_payment_settings ORDER BY channel').all(),
      db.prepare('SELECT channel,old_enabled,new_enabled,telegram_admin_id,occurred_at_ms FROM rustup_payment_settings_audit ORDER BY id DESC LIMIT 15').all()
    ]);
    return publicPaymentPanelState(now,env,rowResult?.results||[],auditResult?.results||[]);
  }catch(e){
    // Never leak SQL, access tokens or environment data to the Mini App.
    return ERROR('payment_controls_unavailable');
  }
}
