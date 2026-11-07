// Remove ONLY the temporary Stars-Test overlay from existing RUST UP GitHub Pages.
// Does NOT change checkout, game balances, Worker, pricing, scripts or real payments.
// Published via user's own Git credentials (GitHub connector has no write to Pages repo).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const REPO='https://github.com/ttzoomrust-hub/rust-up.git';
const SCRIPT='  <script src="js/stars-diagnostic-temp.js?v=20261106test3"></script>';
const TEMP='js/stars-diagnostic-temp.js';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',
 stdio:['ignore','pipe','pipe'],timeout:120000}).trim();
function patch(html){
 if(typeof html!=='string'||html.length<3000)throw Error('invalid_site_html');
 const lines=html.split(/\r?\n/);
 const matches=lines.filter(x=>x.trim()===SCRIPT.trim());
 if(matches.length!==1)throw Error('unexpected_stars_diagnostic_layout');
 if(lines.some(x=>x.includes('stars-diagnostic-temp.js')&&
    x.trim()!==SCRIPT.trim()))throw Error('unexpected_diagnostic_reference');
 return lines.filter(x=>x.trim()!==SCRIPT.trim()).join('\n')+'\n';
}
const mode=process.argv[2]||'--check';
if(!['--check','--publish'].includes(mode)||process.argv.length>3)
 throw Error('Usage: node payments/scripts/remove-temporary-stars-diagnostic.mjs --check|--publish');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rustup-remove-stars-diagnostic-'));
try {
 const dir=path.join(tmp,'site');
 execFileSync('git',['clone','--depth','1','--branch','main',REPO,dir],{
  stdio:['ignore','pipe','pipe'],timeout:120000});
 if(git(dir,'branch','--show-current')!=='main'||
    git(dir,'status','--porcelain')!=='')throw Error('unsafe_site_branch_or_dirty_tree');
 const old=fs.readFileSync(path.join(dir,'index.html'),'utf8');
 const file=path.join(dir,TEMP);
 if(!fs.existsSync(file)||fs.statSync(file).size<200)
  throw Error('unexpected_temporary_diagnostic_file');
 const next=patch(old);
 if(next.includes('stars-diagnostic-temp.js'))throw Error('diagnostic_still_referenced');
 console.log('PASS: remove only temporary Stars diagnostic reference and JS file.');
 if(mode==='--check'){
  console.log('NOT PUBLISHED. Worker and money gates unchanged.');
 }else{
  fs.writeFileSync(path.join(dir,'index.html'),next);
  fs.unlinkSync(file);
  git(dir,'add','--','index.html',TEMP);
  const paths=git(dir,'diff','--cached','--name-only').split(/\r?\n/).sort();
  if(JSON.stringify(paths)!==JSON.stringify(['index.html',TEMP].sort()))
   throw Error('unexpected_files_in_commit');
  git(dir,'diff','--cached','--check');
  git(dir,'commit','-m','Remove temporary Stars connection diagnostic overlay');
  git(dir,'push','origin','main');
  console.log('PASS: published removal of temporary Stars diagnostic only.');
  console.log('No real payment was enabled.');
 }
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
