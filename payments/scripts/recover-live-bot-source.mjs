// Recover the exact original ES module sources embedded in an authenticated
// Cloudflare Worker source map. Never publishes the recovered backend to GitHub.
// Usage (Windows PowerShell):
//   $env:CLOUDFLARE_API_TOKEN = '<private Workers Scripts Read token>'
//   node payments/scripts/recover-live-bot-source.mjs
// The token must never be pasted into GitHub, chat messages or test output.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const TARGET='rustup-bot';
const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const EXPECTED=new Set([
  'money.js','broadcast.js','creator.js','gamedata.js','modes.js',
  'game.js','support.js','admin.js','worker.js'
]);
function sha256(x){return createHash('sha256').update(x).digest('hex');}
export function parseRecoveredModules(raw, contentType=''){
  if(typeof raw!=='string'||raw.length>15_000_000)throw Error('bad_worker_body_size');
  const hinted=contentType.match(/boundary="?([^";\s]+)"?/i)?.[1];
  const first=raw.slice(0,raw.indexOf('\n')).trim().replace(/\r$/,'');
  const marker=hinted?'--'+hinted:first;
  if(!marker.startsWith('--')||marker.length<10||marker.length>200)
    throw Error('bad_multipart_boundary');
  const parts=raw.split(marker);
  let map=null;
  for(const chunk of parts){
    const headerEnd=chunk.indexOf('\r\n\r\n');
    if(headerEnd<0)continue;
    const headers=chunk.slice(0,headerEnd);
    const name=headers.match(/filename="([^"]+)"/i)?.[1];
    if(name==='worker.js.map'){
      const body=chunk.slice(headerEnd+4).replace(/\r\n$/,'');
      map=JSON.parse(body);
      break;
    }
  }
  if(!map||map.version!==3||!Array.isArray(map.sources)||
     !Array.isArray(map.sourcesContent)||
     map.sources.length!==EXPECTED.size||
     map.sources.length!==map.sourcesContent.length)
    throw Error('source_map_missing_or_incomplete');
  const found=new Map();
  for(let i=0;i<map.sources.length;i++){
    const name=map.sources[i];
    const source=map.sourcesContent[i];
    if(!EXPECTED.has(name)||found.has(name)||typeof source!=='string'||
       source.length<20||source.length>3_000_000)
      throw Error('unexpected_or_missing_original_file');
    found.set(name,source);
  }
  if(found.size!==EXPECTED.size||
     !found.get('worker.js').includes('async function onUpdate(upd, env)')||
     !found.get('worker.js').includes("pathname === '/tg'")&&
     !found.get('worker.js').includes('pathname === "/tg"'))
    throw Error('not_expected_rustup_bot_source_map');
  return found;
}
export async function saveRecoveredModules(files,destination){
  await fs.mkdir(destination,{recursive:true,mode:0o700});
  const manifest=[];
  for(const [name,source] of files){
    if(!EXPECTED.has(name))throw Error('unexpected_file_name');
    const location=path.join(destination,name);
    await fs.writeFile(location,source,{flag:'wx',mode:0o600});
    manifest.push({name,sha256:sha256(source),bytes:Buffer.byteLength(source)});
  }
  await fs.writeFile(path.join(destination,'RECOVERY-MANIFEST.json'),
    JSON.stringify({worker:TARGET,recoveredAt:new Date().toISOString(),files:manifest},null,2)+'\n',
    {flag:'wx',mode:0o600});
  return manifest;
}
async function main(){
  const account=process.env.CLOUDFLARE_ACCOUNT_ID||ACCOUNT;
  const token=process.env.CLOUDFLARE_API_TOKEN;
  if(!token||token.length<15)throw Error('Set CLOUDFLARE_API_TOKEN in your local PowerShell environment.');
  const url='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+
    '/workers/scripts/'+TARGET+'/content/v2';
  const result=await fetch(url,{
    method:'GET',headers:{Authorization:'Bearer '+token},redirect:'error',
    signal:AbortSignal.timeout(20000)
  });
  if(!result.ok)throw Error('Cloudflare source read failed with HTTP '+result.status);
  const raw=await result.text();
  const files=parseRecoveredModules(raw,result.headers.get('content-type')||'');
  const snapshot=path.join(root,'.private','rustup-bot-recovered',
    new Date().toISOString().replace(/[^0-9TZ]/g,'-')+'-'+sha256(raw).slice(0,10));
  const manifest=await saveRecoveredModules(files,snapshot);
  console.log('Recovered '+manifest.length+' RUST UP backend modules locally.');
  console.log('Location: '+snapshot);
  console.log('No files were committed or deployed. No payment services were enabled.');
  console.log('Next: node payments/scripts/patch-recovered-live-bot.mjs "'+snapshot+'"');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('Recovery failed:',e.message);process.exitCode=1;});
