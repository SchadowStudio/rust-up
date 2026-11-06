// Targeted Telegram SDK bootstrap repair: only public index.html changes.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
const REPO='https://github.com/ttzoomrust-hub/rust-up.git';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',
 stdio:['ignore','pipe','pipe'],timeout:120000}).trim();
const mode=process.argv[2]||'--check';
if(!['--check','--publish'].includes(mode)||process.argv.length>3)
 throw Error('usage: --check|--publish');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'rustup-auth-sdk-'));
try{
 const dir=path.join(root,'site');
 execFileSync('git',['clone','--depth','1','--branch','main',REPO,dir],{
  stdio:['ignore','pipe','pipe'],timeout:120000});
 if(git(dir,'branch','--show-current')!=='main'||git(dir,'status','--porcelain'))
  throw Error('unexpected_website_checkout');
 const file=path.join(dir,'index.html');
 const html=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
 const old=[
 '  <script>',
 '    // Telegram Mini App: Telegram passes tgWebAppData in the URL; only then load its SDK (keeps offline/browser use fast)',
 '    (function () {',
 '      var tg = /tgWebApp/.test(location.hash + location.search);',
 "      try { if (tg) sessionStorage.setItem('rustup_tg', '1'); else tg = sessionStorage.getItem('rustup_tg') === '1'; } catch (e) {}",
 "      if (tg) document.write('<script src=\"https://telegram.org/js/telegram-web-app.js\"><\\/script>');",
 '    })();',
 '  </script>'
 ].join('\n');
 const replacement='  <script src="https://telegram.org/js/telegram-web-app.js"></script>';
 if(html.split(old).length!==2)throw Error('unexpected_sdk_bootstrap_layout');
 if(!html.includes('Монеты, скины')||html.includes('stars-diagnostic-temp.js'))
  throw Error('site_utf8_or_diagnostic_not_clean');
 const changed=html.replace(old,replacement);
 if(changed.includes("rustup_tg")||changed.includes('document.write')||
    changed.split(replacement).length!==2)
  throw Error('legacy_sdk_bootstrap_retained');
 console.log('PASS: Direct Telegram SDK bootstrapping ready; only index.html changes.');
 if(mode==='--check'){
  console.log('NOT PUBLISHED.');
 }else{
  fs.writeFileSync(file,changed,'utf8');
  git(dir,'add','--','index.html');
  git(dir,'diff','--cached','--check');
  const files=git(dir,'diff','--cached','--name-only').split(/\r?\n/);
  if(files.length!==1||files[0]!=='index.html')
   throw Error('unexpected_changed_file');
  git(dir,'commit','-m','Fix Telegram SDK bootstrap for authenticated Mini App launches');
  git(dir,'push','origin','main');
  console.log('PASS: Telegram SDK bootstrap published; payments remain OFF.');
 }
}finally{fs.rmSync(root,{recursive:true,force:true});}
