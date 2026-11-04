import {requireProjectId} from './identity.js';
const encode=text=>new TextEncoder().encode(text);
export const digestHex=async text=>{
 const d=new Uint8Array(await crypto.subtle.digest('SHA-256',encode(text)));
 return [...d].map(x=>x.toString(16).padStart(2,'0')).join('');
};
export function safeEqual(a,b){
 if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
}
export function newSecret(){
 const raw=crypto.getRandomValues(new Uint8Array(32));
 return 'rup2_'+[...raw].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function authenticateProject(db,request){
 const id=requireProjectId(request.headers.get('x-project-id'));
 const authorization=request.headers.get('authorization')||'';
 if(!/^Bearer rup2_[0-9a-f]{64}$/.test(authorization))
  throw Error('unauthorized_project');
 const keyHash=await digestHex(authorization.slice(7));
 const rows=await db.prepare(`SELECT p.id,p.status,p.webhook_url,k.secret_sha256
  FROM v2_projects p JOIN v2_api_keys k ON k.project_id=p.id
  WHERE p.id=? AND k.status='active'`).bind(id).all();
 let matched=null;
 for(const row of rows.results||[])
  if(safeEqual(row.secret_sha256,keyHash))matched=row;
 if(!matched)throw Error('unauthorized_project');
 if(matched.status!=='active')throw Error('project_not_active');
 return {id:matched.id,webhookUrl:matched.webhook_url};
}
export async function projectWebhookKey(master,projectId){
 // Derived HMAC key is unique per tenant; no plaintext secrets stored in D1.
 if(typeof master!=='string'||master.length<40)throw Error('webhook_key_missing');
 const key=await crypto.subtle.importKey('raw',encode(master),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('HMAC',key,encode('rustup-payments-v2:'+requireProjectId(projectId)));
 return [...new Uint8Array(signature)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
