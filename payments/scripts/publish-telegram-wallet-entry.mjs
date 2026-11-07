// Patch ONLY the existing Telegram Mini App checkout presentation, fail closed.
// This script does NOT credit users, issue invoices, touch Cloudflare or enable payments.
// Usage: node payments/scripts/publish-telegram-wallet-entry.mjs <website-checkout-path> --check|--apply|--publish
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const MARKER='RUSTUP_TELEGRAM_ONLY_WALLET_NOTICE_V1';
const METHOD_OLD="['gifts', 'Telegram и CS2', 10, 7, ['star', 'gift'], 'Звёзды, подарки, скины', ['Звёзды Telegram', 'Подарки и NFT', 'Скины CS2']]";
const METHOD_NEW="['gifts', 'Telegram и CS2', 0, 0, ['star', 'gift'], 'Telegram Stars', ['Платежи отключены', 'Без игрового пополнения']]";
const ANCHOR="  function walletDeposit() {\n    const m = DEP_METHODS.find(x => x[0] === WF.dep);\n";

const PANEL = String.raw`
    // RUSTUP_TELEGRAM_ONLY_WALLET_NOTICE_V1
    // This is a Telegram-only read-only payment status, never game credit.
    if (WF.dep === 'gifts') {
      const cards = DEP_METHODS.map(([id, title, min, bonus, icons]) =>
        '<button type="button" class="wm' + (WF.dep === id ? ' on' : '') +
        '" data-wdep="' + id + '">' +
        (WF.dep === id ? '<span class="wm-check"></span>' : '') +
        '<span class="wm-icons">' + icons.map(icon => '<i>' + WICO[icon] + '</i>').join('') +
        '</span><b>' + title + '</b><small>' +
        (id === 'gifts' ? 'Telegram Stars' : 'от ' + rubFmt(min)) + '</small></button>'
      ).join('');
      return '<div class="wm-grid">' + cards + '</div>' +
        '<div class="wm-detail"><span class="wm-icons big"><i>' + WICO.star +
        '</i></span><span class="wm-lines"><b>Telegram Stars</b>' +
        '<span>Только внутри Telegram</span></span></div>' +
        '<div class="w-glass w-panel" role="status">' +
        '<h3 class="w-h3">⭐ Telegram Stars</h3>' +
        '<p class="w-note">Платежи пока отключены. Реальные деньги и Stars не принимаются.</p>' +
        '<p class="w-note">Оплаченные Stars не пополняют игровой баланс для кейсов, ставок, апгрейдов или вывода.</p>' +
        '<p class="w-note">Поддержка: <a href="https://t.me/rustuperhelp_bot" data-tg-link>@rustuperhelp_bot</a></p>' +
        '</div>';
    }
`;

function replaceOne(source,oldText,newText){
  const first=source.indexOf(oldText);
  if(first<0||source.indexOf(oldText,first+oldText.length)>=0)
    throw Error('website_version_drift_refuse_to_patch');
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}
export function patchApp(source){
  if(typeof source!=='string'||!source.includes("function walletDeposit()"))
    throw Error('not_expected_rustup_app');
  const crlf=source.includes('\r\n');
  let text=source.replace(/\r\n/g,'\n');
  if(text.includes(MARKER))return source;
  text=replaceOne(text,METHOD_OLD,METHOD_NEW);
  text=replaceOne(text,ANCHOR,ANCHOR+PANEL);
  if(!text.includes('RUSTUP_TELEGRAM_ONLY_WALLET_NOTICE_V1') ||
     !text.includes("if ('wpay' in d || 'wsend' in d)"))
    throw Error('wallet_integrity_check_failed');
  return crlf?text.replace(/\n/g,'\r\n'):text;
}
export function patchIndex(source){
  if(typeof source!=='string'||!source.includes('telegram-web-app.js'))
    throw Error('not_expected_telegram_webapp');
  const match=source.match(/(<script src="js\/app\.js\?v=)([A-Za-z0-9._-]+)("><\/script>)/);
  if(!match)throw Error('app_script_tag_missing');
  if(match[2].endsWith('-tgonly1'))return source;
  return replaceOne(source,match[0],match[1]+match[2]+'-tgonly1'+match[3]);
}
function git(website,...args){
  return execFileSync('git',args,{cwd:website,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
}
function run(){
  const caller=process.argv[1]&&path.resolve(process.argv[1]);
  if(!caller||caller!==fileURLToPath(import.meta.url))return;
  const websiteArg=process.argv[2],mode=process.argv[3]||'--check';
  if(!websiteArg||!['--check','--apply','--publish'].includes(mode))
    throw Error('Usage: node payments/scripts/publish-telegram-wallet-entry.mjs "C:\\Users\\...\\RUST-UP-Website" --check|--apply|--publish');
  const website=fs.realpathSync(path.resolve(websiteArg));
  if(!fs.existsSync(path.join(website,'.git'))||
     !fs.existsSync(path.join(website,'js','config.js')))
    throw Error('not_a_local_website_checkout');
  const origin=git(website,'remote','get-url','origin');
  if(!/^(?:https:\/\/github\.com\/|git@github\.com:)ttzoomrust-hub\/rust-up(?:\.git)?\/?$/.test(origin))
    throw Error('wrong_repository_remote');
  const branch=git(website,'branch','--show-current');
  if(branch!=='main')throw Error('website_must_be_on_main');
  if(git(website,'status','--porcelain'))
    throw Error('website_has_local_changes_refuse_to_overwrite');
  if(mode==='--publish')git(website,'pull','--ff-only','origin','main');
  const appPath=path.join(website,'js','app.js');
  const indexPath=path.join(website,'index.html');
  const beforeApp=fs.readFileSync(appPath,'utf8');
  const beforeIndex=fs.readFileSync(indexPath,'utf8');
  const app=patchApp(beforeApp),index=patchIndex(beforeIndex);
  if(mode==='--check'){
    console.log('PASS: Telegram-only wallet patch compatible with website.');
    console.log('App change:',app!==beforeApp,'Cache-buster change:',index!==beforeIndex);
    console.log('No files changed or payments enabled.');
    return;
  }
  if(app===beforeApp&&index===beforeIndex){
    console.log('PASS: Telegram-only wallet panel already installed; no changes.');
    return;
  }
  try {
    fs.writeFileSync(appPath,app);
    fs.writeFileSync(indexPath,index);
    execFileSync(process.execPath,['--check',appPath],{stdio:'pipe'});
  }catch(e){
    fs.writeFileSync(appPath,beforeApp);
    fs.writeFileSync(indexPath,beforeIndex);
    throw Error('patch_or_syntax_failed_original_files_restored: '+e.message);
  }
  console.log('PASS: Existing Telegram/CS2 wallet entry patched; real payments stay disabled.');
  if(mode==='--publish'){
    git(website,'add','--','js/app.js','index.html');
    git(website,'commit','-m','Show Telegram-only Stars wallet status without game credit');
    git(website,'push','origin','main');
    console.log('PASS: Website source pushed to GitHub main (GitHub Pages publication may lag).');
  }else{
    console.log('NOT PUBLISHED: review diff then commit and push separately.');
  }
}
run();
