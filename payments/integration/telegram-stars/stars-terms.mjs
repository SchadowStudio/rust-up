// Telegram Stars checkout: explicit terms acceptance for deterministic, non-wagerable goods.
// Version and HTTPS URL must be configured by the operator. No default legal text.
const VERSION=/^[a-z0-9][a-z0-9._-]{2,39}$/i;
const validId=x=>Number.isSafeInteger(x)&&x>0;

export function publishedStarsTerms(env){
  if(!VERSION.test(env?.STARS_TERMS_VERSION||''))return null;
  if(typeof env?.STARS_TERMS_URL!=='string')return null;
  let parsed;
  try{parsed=new URL(env.STARS_TERMS_URL);}catch{return null;}
  if(parsed.protocol!=='https:'||!parsed.hostname||parsed.username||parsed.password||
     parsed.port||parsed.hash||parsed.search)return null;
  return Object.freeze({version:env.STARS_TERMS_VERSION,url:parsed.href});
}
export async function starsTermsAccepted(db,userId,terms){
  if(!db?.prepare||!validId(userId)||!terms?.version)
    throw Error('stars_terms_unavailable');
  const record=await db.prepare(
    'SELECT accepted_at_ms FROM rustup_stars_terms_acceptances '+
    'WHERE telegram_user_id=? AND terms_version=?'
  ).bind(userId,terms.version).first();
  return Number.isSafeInteger(record?.accepted_at_ms)&&record.accepted_at_ms>0;
}
export async function recordStarsTermsAcceptance(db,userId,terms,now=Date.now()){
  if(!db?.prepare||!validId(userId)||!terms?.version||!VERSION.test(terms.version)||
     !Number.isSafeInteger(now)||now<1)
    throw Error('stars_terms_acceptance_invalid');
  const result=await db.prepare(
    'INSERT OR IGNORE INTO rustup_stars_terms_acceptances '+
    '(telegram_user_id,terms_version,accepted_at_ms) VALUES(?,?,?)'
  ).bind(userId,terms.version,now).run();
  if(result?.meta?.changes!==0&&result?.meta?.changes!==1)
    throw Error('stars_terms_acceptance_persist_failed');
  if(!await starsTermsAccepted(db,userId,terms))
    throw Error('stars_terms_acceptance_not_durable');
  return {accepted:true,version:terms.version,alreadyAccepted:result.meta.changes===0};
}
