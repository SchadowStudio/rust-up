// Rebuild only the public Stars pilot restrictions from the CURRENT Cloudflare Worker.
// Does not issue payments or change approval/settlement flags. --publish uploads a new Worker version.
// Never publish a recovered/old bundle. Guard deployed version before upload.
import {writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const account='af72e32cb9f1ba99dba07df30fe540fe';
const worker='rustup-bot';
const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/'+worker;
const token=process.env.CLOUDFLARE_API_TOKEN;
const publishing=process.argv.includes('--publish');
if(!token||token.length<15)throw Error('Set CLOUDFLARE_API_TOKEN securely in this process');
async function get(path){const r=await fetch(base+path,{headers:{authorization:'Bearer '+token},redirect:'error'});if(!r.ok)throw Error('Cloudflare GET '+path+' '+r.status);return r;}
const dep=await (await get('/deployments')).json();
const version=dep.result?.deployments?.[0]?.versions?.[0]?.version_id;
if(typeof version!=='string')throw Error('Cannot determine deployed version');
const originalVersion=version;
const settings=(await (await get('/settings')).json()).result;
const bindings=settings?.bindings;
if(!Array.isArray(bindings)||bindings.length<25)throw Error('Live bindings unavailable');
for(const name of ['BOT_TOKEN','WEBHOOK_SECRET','DB','PAYMENTS_DB','STARS_GAME_CREDIT_SETTLEMENT_ENABLED','STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED','STARS_VARIABLE_CHECKOUT_RELEASE_APPROVED']){
 if(!bindings.some(b=>b.name===name))throw Error('Missing required binding: '+name);
}
const response=await get('');
const raw=await response.text();
const boundary=raw.split(/\r?\n/,1)[0];
if(!/^--[a-zA-Z0-9-]{20,}$/.test(boundary))throw Error('Unexpected Worker multipart boundary');
const parts=raw.split(boundary).filter(p=>p.includes('Content-Disposition: form-data;'));
if(parts.length!==1)throw Error('Expected exactly one Worker source part');
const part=parts[0],split=part.indexOf('\r\n\r\n');
if(split<0)throw Error('Worker part missing delimiter');
const name=/name="([^"]+\.js)"/.exec(part.slice(0,split))?.[1];
if(!name||name.includes('/')||name.includes('\\'))throw Error('Unexpected module name');
let source=part.slice(split+4).replace(/\r\n$/,'');
if(!source.includes('function pilotStarsUserAllowed(')||!source.includes('function mayAcceptVariable('))
 throw Error('Unexpected current Stars integration');
// Route authenticated Stars deposit history through the actual Stars handler.
// The current live bundle has two wrappers; only the second is active.
const activeStart=source.indexOf('function wrapCurrentStarsWebhook2(');
if(activeStart<0||!source.includes('handleCheckout = variableStarsApi2'))
 throw Error('Active Stars wrapper missing');
const oldRoute='if (url.pathname === "/api/stars/variable/checkout" || url.pathname === "/api/stars/variable/quote") {';
const newRoute='if (url.pathname === "/api/stars/variable/checkout" || url.pathname === "/api/stars/variable/quote" || url.pathname === "/api/stars/variable/history") {';
const active=source.slice(activeStart);
if(active.split(oldRoute).length!==2)throw Error('Active Stars route marker changed or duplicated');
source=source.slice(0,activeStart)+active.replace(oldRoute,newRoute);
const replacements=[oldRoute]; // one precise replacement in active wrapper only

const stage=resolve('.private','stars-public-release-'+originalVersion.slice(0,8));
await mkdir(stage,{recursive:true});
await writeFile(join(stage,name),source);
console.log(JSON.stringify({mode:publishing?'PUBLISH':'PREVIEW',liveVersion:originalVersion,module:name,patchedMarkers:replacements.length,stagedDirectory:stage},null,2));
if(!publishing){console.log('NOT DEPLOYED. Run node --check on staged source, then run with --publish.');process.exit(0);}
const check=(await (await get('/deployments')).json()).result?.deployments?.[0]?.versions?.[0]?.version_id;
if(check!==originalVersion)throw Error('Version changed during staging; abort');
const body=new FormData();
const metadata={main_module:name,compatibility_date:settings.compatibility_date,
 bindings:bindings.map(b=>({name:b.name,type:'inherit'})),
 annotations:{'workers/message':'Remove Stars pilot limits; retain payment settlement and refund gates'}};
body.append('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));
body.append(name,new Blob([source],{type:'application/javascript+module'}),name);
const upload=await fetch(base+'?bindings_inherit=strict',{method:'PUT',headers:{authorization:'Bearer '+token},body,redirect:'error'});
const result=await upload.json();
if(!upload.ok||!result.success)throw Error('Upload failed: '+JSON.stringify(result.errors||[]));
const deployed=await (await get('/deployments')).json();
console.log(JSON.stringify({uploaded:true,uploadId:result.result?.id,deployedVersion:deployed.result?.deployments?.[0]?.versions?.[0]?.version_id,previousVersion:originalVersion},null,2));
