// Read-only, tenant-scoped financial overview for the platform operator.
// Project invoices are separate; no customer names, IPs or Telegram IDs.
import {isUuid,requireProjectId} from './identity.js';
const reply=(data,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const error=(name,status=400)=>reply({ok:false,error:name},status);
const route=/^\/v2\/admin\/projects\/([0-9a-f-]{36})\/(payments|summary|keys)$/i;
export async function projectReport(request,env,url){
 const hit=route.exec(url.pathname);
 if(!hit||!isUuid(hit[1]))return error('invalid_project_id');
 if(request.method!=='GET')return error('method_not_allowed',405);
 const projectId=requireProjectId(hit[1]),resource=hit[2],db=env.DB;
 const project=await db.prepare('SELECT id FROM v2_projects WHERE id=?')
  .bind(projectId).first();
 if(!project)return error('project_not_found',404);
 if(resource==='keys'){
  const keys=await db.prepare(`SELECT id,status,created_at_ms,revoked_at_ms
    FROM v2_api_keys WHERE project_id=? ORDER BY created_at_ms DESC LIMIT 100`)
   .bind(projectId).all();
  return reply({ok:true,projectId,keys:keys.results||[]});
 }
 if(resource==='summary'){
  const [invoices,delivery]=await Promise.all([
   db.prepare(`SELECT fiat,status,COUNT(*) AS invoice_count
    FROM v2_invoices WHERE project_id=? GROUP BY fiat,status`)
    .bind(projectId).all(),
   db.prepare(`SELECT COUNT(*) AS pending FROM v2_delivery_outbox
     WHERE project_id=? AND delivered_at_ms IS NULL`)
    .bind(projectId).first()
  ]);
  return reply({ok:true,projectId,invoiceCounts:invoices.results||[],
   undeliveredEvents:delivery?.pending||0});
 }
 const status=url.searchParams.get('status')||'all';
 if(!['all','awaiting_payment','verified','expired','manual_review'].includes(status))
  return error('invalid_status_filter');
 const max=Number(url.searchParams.get('limit')||50);
 if(!Number.isInteger(max)||max<1||max>100)return error('invalid_page_size');
 const before=Number(url.searchParams.get('before')||Date.now()+60000);
 if(!Number.isSafeInteger(before)||before<=0)return error('invalid_page_cursor');
 const rows=await db.prepare(`SELECT i.id,i.project_order_ref,i.fiat,
    i.amount_minor,i.asset,i.chain,i.amount_atomic,i.status,
    i.tx_hash,i.created_at_ms,i.expires_at_ms,i.verified_at_ms,
    o.delivered_at_ms
   FROM v2_invoices i
   LEFT JOIN v2_delivery_outbox o ON o.invoice_id=i.id
   WHERE i.project_id=? AND i.created_at_ms<?
     AND (?='all' OR i.status=?)
   ORDER BY i.created_at_ms DESC,i.id DESC LIMIT ?`)
  .bind(projectId,before,status,status,max).all();
 const payments=(rows.results||[]).map(row=>({
  invoiceId:row.id,projectOrderRef:row.project_order_ref,
  fiat:row.fiat,amountMinor:row.amount_minor,
  asset:row.asset,chain:row.chain,amountAtomic:row.amount_atomic,
  status:row.status,transactionHash:row.tx_hash,
  createdAt:row.created_at_ms,expiresAt:row.expires_at_ms,
  verifiedAt:row.verified_at_ms,webhookDelivered:row.delivered_at_ms!==null
 }));
 return reply({ok:true,projectId,payments,
  nextBefore:payments.length?payments.at(-1).createdAt:null,
  note:'Pagination uses createdAt; use smaller before value for older pages.'});
}
