// Bridge for the EXISTING RUST UP bot's authenticated /tg update dispatcher.
// This file is pure glue. It does NOT send payments, create invoices,
// modify player balance, reconfigure Telegram webhooks or assume a new bot.
import {handlePaymentAdminCommand} from './payment-controls.mjs';

export async function handleExistingBotPaymentCommands(update, env, {
  isAdmin, telegramApi
} = {}) {
  if (typeof update?.message?.text !== 'string') return false;
  if (!/^\/(?:pay|payments)(?:@[A-Za-z0-9_]{5,32})?(?:\s|$)/i.test(update.message.text.trim()))
    return false;
  if (typeof isAdmin !== 'function' || typeof telegramApi !== 'function')
    throw Error('existing_bot_dependencies_missing');

  // Existing bot already verifies X-Telegram-Bot-Api-Secret-Token
  // before calling its onUpdate dispatcher.
  const result=await handlePaymentAdminCommand(update,env,{
    authorize:(user)=>isAdmin(env,user),
    sendMessage:async(chat,text)=>{
      const result=await telegramApi(env,'sendMessage',{
        chat_id:chat,text,disable_web_page_preview:true
      });
      if(result?.ok===false)throw Error('telegram_admin_reply_rejected');
    }
  });
  return result.handled;
}
