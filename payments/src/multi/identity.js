// Projects supply RANDOM opaque order UUIDs, never user IDs, emails or IPs.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid=s=>typeof s==='string'&&uuid.test(s);
export function requireOrderRef(s){if(!isUuid(s))throw Error('invalid_opaque_order_reference');return s.toLowerCase();}
export function requireIdempotency(s){if(!isUuid(s))throw Error('invalid_idempotency_key');return s.toLowerCase();}
export function requireProjectId(s){if(!isUuid(s))throw Error('invalid_project_id');return s.toLowerCase();}
export function safeWebhookUrl(value){
 if(typeof value!=='string'||value.length>256)throw Error('invalid_webhook_url');
 let url;try{url=new URL(value)}catch{throw Error('invalid_webhook_url')}
 if(url.protocol!=='https:'||url.username||url.password||url.hash||
    url.port||url.search||!url.hostname.includes('.')||
    /(?:^|\.)(localhost|local|internal|test|invalid)$/i.test(url.hostname)||
    /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)||
    /^(?:\[|0x|0\d)/.test(url.hostname))
  throw Error('invalid_webhook_url');
 return url.origin+url.pathname;
}
export function compactError(error){
 const safe=new Set(['invalid_opaque_order_reference','invalid_idempotency_key',
 'invalid_project_id','quote_unavailable','stale_or_invalid_fx_rate',
 'invalid_fiat_minor','invalid_exchange_rate','quote_out_of_bounds',
 'unsupported_asset','no_unused_address','invoice_not_found',
 'invalid_webhook_url','duplicate_idempotency_key','project_not_active',
 'verification_rate_limited','invalid_transaction_id','insufficient_confirmations',
 'recipient_or_amount_mismatch','payment_predates_order']);
 return safe.has(error?.message)?error.message:'service_unavailable';
}
