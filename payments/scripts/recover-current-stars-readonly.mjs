// Recover the EXACT CURRENT RUST UP Worker, which already contains the Stars
// read-only wrapper. Legacy recover-live-bot-source.mjs expects only 9 modules,
// while the current Cloudflare source map contains 12 modules.
// Keeps ALL recovered sources PRIVATE. Does not modify or deploy the live Worker.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const EXPECTED=[
  'money.js','broadcast.js','creator.js','gamedata.js','modes.js',
  'game.js','support.js','admin.js','worker.js',
  'telegram-initdata.mjs','stars-readonly-live.mjs','worker.stars-readonly-entry.mjs'
];
const digest=s=>createHash('sha256').update(s).digest('hex');

export function parseReadonlyWorkerSourceMap(body,contentType=''){
 if(typeof body!=='string'||body.length<1000||body.length>18_000_000)
   throw Error('invalid_worker_source_response');
 const boundary=contentType.match(/boundary="?([^";\s]+)"?/i)?.[1];
 const initial=body.slice(0,body.indexOf('\n')).trim().replace(/\r$/,'');
 const marker=boundary?'--'+boundary:initial;
 if(!marker.startsWith('--')||marker.length>200||marker.length<15)
   throw Error('unexpected_worker_multipart_boundary');
 const sections=body.split(marker);
 if(sections.length<3||sections.length>10)
   throw Error('unexpected_worker_multipart_sections');
 let data=null;
 for(const section of sections){
   const headerEnd=section.indexOf('\r\n\r\n');
   if(headerEnd<0)continue;
   const headers=section.slice(0,headerEnd);
   const name=headers.match(/filename="([^"]+)"/)?.[1];
   if(!name||!name.endsWith('.js.map'))continue;
   if(data)throw Error('multiple_worker_source_maps');
   try{data=JSON.parse(section.slice(headerEnd+4).replace(/\r\n$/,''));}
   catch{throw Error('invalid_worker_source_map_json');}
 }
 if(data?.version!==3||!Array.isArray(data.sources)||
    !Array.isArray(data.sourcesContent)||data.sources.length!==EXPECTED.length||
    data.sourcesContent.length!==EXPECTED.length||
    data.sources.some((name,i)=>name!==EXPECTED[i]))
   throw Error('unexpected_latest_worker_source_map_layout');
 const files=new Map();
 for(let i=0;i<EXPECTED.length;i++){
   const src=data.sourcesContent[i];
   if(typeof src!=='string'||src.length<20||src.length>2_000_000)
     throw Error('invalid_worker_module_'+EXPECTED[i]);
   files.set(EXPECTED[i],src);
 }
 if(!files.get('worker.js').includes('async function onUpdate(upd, env)')||
    !files.get('worker.stars-readonly-entry.mjs').includes('handleStarsReadOnly')||
    !files.get('stars-readonly-live.mjs').includes('rustup-stars-readonly')||
    !files.get('stars-readonly-live.mjs').includes('stars_checkout_disabled')||
    !(files.get('telegram-initdata.mjs').includes('authDate<current-600')||
      (files.get('telegram-initdata.mjs').includes('authDate<current-maxAgeSeconds')&&
       files.get('stars-readonly-live.mjs').includes('Date.now(),86400'))))
   throw Error('not_exact_expected_readonly_worker');
 return files;
}

export async function recoverReadonlySource(token){
 const url='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+
   '/workers/scripts/rustup-bot/content/v2';
 const response=await fetch(url,{
   headers:{authorization:'Bearer '+token},redirect:'error',
   signal:AbortSignal.timeout(25000)
 });
 if(!response.ok)throw Error('cloudflare_source_read_http_'+response.status);
 const raw=await response.text();
 return {source:parseReadonlyWorkerSourceMap(raw,response.headers.get('content-type')||''),
   bodyHash:digest(raw)};
}

export function verifyReadonlySnapshot(live,manifest){
 if(manifest.worker!=='rustup-bot'||manifest.layout!=='stars-readonly-v1'||
    !Array.isArray(manifest.files)||manifest.files.length!==EXPECTED.length)
   throw Error('bad_readonly_snapshot_manifest');
 for(let i=0;i<EXPECTED.length;i++){
   const expected=manifest.files[i],src=live.get(EXPECTED[i]);
   if(expected?.name!==EXPECTED[i]||typeof src!=='string'||
      digest(src)!==expected.sha256||Buffer.byteLength(src)!==expected.bytes)
     throw Error('live_readonly_worker_changed_'+EXPECTED[i]);
 }
 return true;
}

async function main(){
 const token=process.env.CLOUDFLARE_API_TOKEN;
 if(typeof token!=='string'||token.length<15)
   throw Error('Cloudflare authentication is required locally, never paste token');
 const {source,bodyHash}=await recoverReadonlySource(token);
 const dir=path.join(ROOT,'.private','rustup-bot-recovered',
   new Date().toISOString().replace(/[^0-9TZ]/g,'-')+'-readonly-'+bodyHash.slice(0,12));
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 const entries=[];
 for(const [name,value] of source){
   await fs.writeFile(path.join(dir,name),value,{flag:'wx',mode:0o600});
   entries.push({name,sha256:digest(value),bytes:Buffer.byteLength(value)});
 }
 await fs.writeFile(path.join(dir,'RECOVERY-MANIFEST.json'),
   JSON.stringify({worker:'rustup-bot',layout:'stars-readonly-v1',files:entries},null,2)+'\n',
   {flag:'wx',mode:0o600});
 console.log('PASS: Exact 12-module CURRENT RUST UP Worker backed up privately.');
 console.log('Location: '+dir);
 console.log('No changes deployed; credentials and private sources remain local.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error('READONLY RECOVERY BLOCKED:',e.message);process.exitCode=1;});
