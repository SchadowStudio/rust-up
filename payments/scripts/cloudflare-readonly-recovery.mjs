// Cloudflare READ-ONLY recovery helper. Cloudflare can occasionally return a
// transient 401 for a previously successful auth token. Retrying ONCE avoids
// losing a safe source-recovery run; a second 401 is always fail closed.
// No token logging, no write HTTP methods, no weakened source-map validation.
const API='https://api.cloudflare.com/client/v4/';
export async function cloudflareReadOnly(url,token,fetchImpl=fetch){
 if(typeof url!=='string'||!url.startsWith(API)||
    !/^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/[a-f0-9]{32}\/(?:workers\/scripts\/rustup-bot\/(?:content\/v2|settings|schedules|deployments))$/.test(url))
   throw Error('cloudflare_unapproved_recovery_endpoint');
 if(typeof token!=='string'||token.length<15)
   throw Error('cloudflare_recovery_auth_required');
 for(let n=0;n<2;n++){
  const res=await fetchImpl(url,{
   method:'GET',headers:{authorization:'Bearer '+token},
   redirect:'error',signal:AbortSignal.timeout(25000)
  });
  if(res.status===401&&n===0){
   // A previously valid Wrangler OAuth token can encounter transient
   // Cloudflare 401; retry exactly once with identical identity and scope.
   continue;
  }
  return res;
 }
 throw Error('cloudflare_recovery_auth_retry_exhausted');
}
