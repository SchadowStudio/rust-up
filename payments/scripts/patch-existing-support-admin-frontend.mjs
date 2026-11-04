// Safe local patch for the separate, PUBLIC ttzoomrust-hub/rust-up website.
// Does not overwrite files that a teammate has edited since inspection.
// Run on a clean checkout. No GitHub push or Cloudflare deploy is performed.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const assets=path.join(root,'payments','frontend','support-admin');
const EXPECT={
 'index.html':'01fff9db3a155e3d809f92c18fa4864421532b27',
 'app.js':'dbf6b86721616175c4d582ede657d27bd3387f71',
 'style.css':'14b6bea7c51da58b16e3c483dae7444df92ea6e8'
};
function gitBlobHash(text){
 const buf=Buffer.from(text);
 return createHash('sha1').update('blob '+buf.length+'\0').update(buf).digest('hex');
}
function replaceOnce(source,needle,replacement){
 if(source.split(needle).length!==2)throw Error('website_layout_changed');
 return source.replace(needle,replacement);
}
export function patchAdminFrontendIndex(source){
 let out=replaceOnce(source,
  '<button type="button" data-tab="log">Журнал</button>',
  '<button type="button" data-tab="log">Журнал</button>\n    <button type="button" data-tab="payments">Платежи</button>');
 out=replaceOnce(out,'<link rel="stylesheet" href="style.css?v=20261105d">',
  '<link rel="stylesheet" href="style.css?v=20261105d">\n  <link rel="stylesheet" href="payments.css?v=20261104a">');
 out=replaceOnce(out,'<script src="app.js?v=20261105d"></script>',
  '<script src="payments-tab.js?v=20261104a"></script>\n  <script src="app.js?v=20261105d"></script>');
 return out;
}
export function patchAdminFrontendApp(source){
 let out=replaceOnce(source,
  "tab === 'users' ? usersPage() : tab === 'log' ? logPage() : tab === 'support' ? supportPage() : statsPage();",
  "tab === 'payments' ? window.RustUpPaymentsTab.render({page:$('#page'),api,toast,denied}) : tab === 'users' ? usersPage() : tab === 'log' ? logPage() : tab === 'support' ? supportPage() : statsPage();");
 out=replaceOnce(out,"['stats', 'users', 'support', 'log'].includes(start)",
  "['stats', 'users', 'support', 'log', 'payments'].includes(start)");
 return out;
}
async function main(){
 const target=process.argv[2];
 if(!target)throw Error('Usage: node payments/scripts/patch-existing-support-admin-frontend.mjs "<ttzoomrust-hub/rust-up checkout>"');
 const dir=await fs.realpath(path.resolve(target)),admin=path.join(dir,'admin');
 const paths=Object.keys(EXPECT);
 const sources=await Promise.all(paths.map(name=>fs.readFile(path.join(admin,name),'utf8')));
 for(let i=0;i<paths.length;i++){
  const sha=gitBlobHash(sources[i]);
  if(sha!==EXPECT[paths[i]])throw Error('website_file_changed_'+paths[i]+'_'+sha);
 }
 // Prevalidate all changes and destination absence before any writes.
 const nextIndex=patchAdminFrontendIndex(sources[0]);
 const nextApp=patchAdminFrontendApp(sources[1]);
 for(const name of ['payments-tab.js','payments.css']){
  try{await fs.access(path.join(admin,name));throw Error('payment_panel_already_exists_'+name);}
  catch(e){if(e?.code!=='ENOENT')throw e;}
 }
 await fs.writeFile(path.join(admin,'index.html'),nextIndex);
 await fs.writeFile(path.join(admin,'app.js'),nextApp);
 await fs.copyFile(path.join(assets,'payments-tab.js'),path.join(admin,'payments-tab.js'),fs.constants.COPYFILE_EXCL);
 await fs.copyFile(path.join(assets,'payments.css'),path.join(admin,'payments.css'),fs.constants.COPYFILE_EXCL);
 console.log('PASS: Existing RUST UP admin Mini App preserved.');
 console.log('PASS: Russian Payments tab and stylesheet added.');
 console.log('NOT PUBLISHED: commit and push this separate website checkout after API is deployed.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error('Website patch blocked:',e.message);process.exitCode=1;});
