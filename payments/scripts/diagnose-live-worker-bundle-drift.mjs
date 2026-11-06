// Read-only, secret-safe comparison of the exact current Cloudflare Worker JS
// and the previously postverified local release. Never deploys or prints code.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const local=path.join(root,'.private','rustup-bot-recovered',
 'targeted-6b8b2704-45002eba4f','worker.stars-auth-reason.bundle.js');
const sha=s=>createHash('sha256').update(s).digest('hex');
function liveModule(raw) {
 const boundary=raw.split(/\r?\n/,1)[0];
 if(!/^--[a-zA-Z0-9_=-]{8,200}$/.test(boundary))throw Error('unexpected_multipart');
 const start=raw.indexOf('\r\n\r\n');
 const end=raw.indexOf('\r\n'+boundary,start+4);
 if(start<0||end<0)throw Error('unexpected_multipart_parts');
 const header=raw.slice(0,start);
 if(!header.includes('application/javascript+module'))throw Error('unexpected_content_type');
 return raw.slice(start+4,end);
}
function gitSecret(){
 if(process.env.CLOUDFLARE_API_TOKEN)return process.env.CLOUDFLARE_API_TOKEN;
 // Node 24 on Windows cannot spawn .cmd files directly via execFileSync.
 // Run this fixed, non-user-controlled command through cmd.exe instead.
 const isWindows=process.platform==='win32';
 const command=isWindows?(process.env.ComSpec||'cmd.exe'):'npx';
 const args=isWindows?
  ['/d','/s','/c','npx --yes wrangler auth token --json']:
  ['--yes','wrangler','auth','token','--json'];
 const raw=execFileSync(command,args,{
  cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:60000});
 const token=JSON.parse(raw).token;
 if(typeof token!=='string'||token.length<15)throw Error('wrangler_login_required');
 return token;
}
const scrub=s=>s.replace(/\r\n/g,'\n')
 .replace(/^\/\/# sourceMappingURL=.*(?:\n|$)/gm,'')
 .trimEnd();
const token=gitSecret();
const res=await fetch('https://api.cloudflare.com/client/v4/accounts/'+
 'af72e32cb9f1ba99dba07df30fe540fe/workers/scripts/rustup-bot/content/v2',{
 headers:{authorization:'Bearer '+token},redirect:'manual',
 signal:AbortSignal.timeout(25000)});
if(!res.ok)throw Error('cloudflare_read_http_'+res.status);
const remote=liveModule(await res.text());
const reference=fs.readFileSync(local,'utf8');
const a=scrub(remote),b=scrub(reference);
let prefix=0,suffix=0;
while(prefix<Math.min(a.length,b.length)&&a[prefix]===b[prefix])prefix++;
while(suffix<Math.min(a.length,b.length)-prefix&&
 a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
const rawEqual=remote===reference,normalizedEqual=a===b;
const estimate=a.length&&b.length?(Math.max(a.length,b.length)-prefix-suffix):0;
console.log(JSON.stringify({
 referenceAvailable:true,
 raw:{equal:rawEqual,liveLength:remote.length,referenceLength:reference.length,
  liveHash:sha(remote).slice(0,16),referenceHash:sha(reference).slice(0,16)},
 normalized:{equal:normalizedEqual,liveLength:a.length,referenceLength:b.length,
  commonPrefixChars:prefix,commonSuffixChars:suffix,
  differingSpanApproxChars:estimate},
 sourceMapOnlyDifference:!rawEqual&&normalizedEqual,
 candidateCause:normalizedEqual?'source_map_or_line_endings':
  prefix<100?'bundle_wrapper_or_recompile':'code_or_build_difference',
 safeToDeploy:false
},null,2));
