import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import {patchCurrentWalletApp,patchCurrentWalletHtml}
 from './prepare-current-deposit-wallet.mjs';

const oldMethod="['gifts', 'Telegram и CS2', 10, 7, ['star', 'gift'], 'Звёзды, подарки, скины', ['Звёзды Telegram', 'Подарки и NFT', 'Скины CS2']]";
const oldRender="    box.innerHTML = WF.tab === 'withdraw' ? walletWithdraw() : WF.tab === 'history' ? walletHistory() : walletDeposit();";
const app=()=>['function renderWallet() {',oldRender,'}',
 'function walletDeposit() {}',
 "if ('wpay' in d || 'wsend' in d) {}",
 oldMethod,' '.repeat(31000)].join('\r\n');
const html=()=>['<html><head>',
 '<link rel="stylesheet" href="css/style.css?v=20261106i">',
 '</head><body>Демо-режим · виртуальный баланс',
 '<script src="js/app.js?v=20261106i"></script>',
 '</body></html>',' '.repeat(4100)].join('\n');

test('current wallet gains one Telegram Stars-only readout without changing withdrawals',()=>{
 const patched=patchCurrentWalletApp(app());
 assert.match(patched,/RUSTUP_STARS_VARIABLE_V4\.render\(box\)/);
 assert.match(patched,/WF\.tab === 'deposit' && WF\.dep === 'gifts'/);
 assert.match(patched,/const demoForm = box\.querySelector/);
 assert.match(patched,/Telegram Stars/);
 assert.doesNotMatch(patched,/Telegram и CS2/);
 assert.match(patched,/if \('wpay' in d \|\| 'wsend' in d\)/);
 assert.equal(patched.split('function walletDeposit()').length,2);
 assert.equal(patched.includes('\r\n'),true);
 assert.throws(()=>patchCurrentWalletApp(patched),/already_applied|changed/);
});

test('version-guarded site patch loads deposit CSS and JS before current app',()=>{
 const patched=patchCurrentWalletHtml(html());
 const script='js/stars-deposit-v5.js?v=20261106depositstatus1';
 const css='css/stars-deposit-v5.css?v=20261106depositstatus1';
 assert.ok(patched.includes(script));
 assert.ok(patched.includes(css));
 assert.ok(patched.indexOf(script)<patched.indexOf('js/app.js?v=20261106i'));
 assert.throws(()=>patchCurrentWalletHtml(patched),/already_applied|changed/);
});

test('site version or wallet design drift fails closed',()=>{
 assert.throws(()=>patchCurrentWalletApp(app().replace(oldMethod,'unknown method')),
  /changed|unrecognized/);
 assert.throws(()=>patchCurrentWalletHtml(html().replace('20261106i','later')),
  /changed|unrecognized/);
 assert.throws(()=>patchCurrentWalletApp(app().replace('function walletDeposit()','function replacedWallet()')),
  /unrecognized/);
});

test('publisher accepts staged CRLF but still rejects real trailing whitespace',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rustup-deposit-eol-'));
 const git=(...args)=>execFileSync('git',args,{cwd:dir,stdio:'pipe'});
 const check=(...args)=>spawnSync('git',args,{cwd:dir,encoding:'utf8'});
 try{
  git('init','--quiet');
  git('config','core.autocrlf','false');
  git('config','user.name','Offline Test');
  git('config','user.email','test@example.invalid');
  const target=join(dir,'existing-app.js');
  writeFileSync(target,'old line\r\n');
  git('add','existing-app.js');
  git('commit','--quiet','-m','original CRLF app');
  writeFileSync(target,'old line\r\nnew line\r\n');
  git('add','existing-app.js');
  const gitDefault=check('diff','--cached','--check');
  assert.notEqual(gitDefault.status,0);
  assert.match(gitDefault.stdout+gitDefault.stderr,/trailing whitespace/i);
  const safe=check('-c','core.whitespace=cr-at-eol','diff','--cached','--check');
  assert.equal(safe.status,0,safe.stdout+safe.stderr);
  writeFileSync(target,'old line\r\nnew line \r\n');
  git('add','existing-app.js');
  const bad=check('-c','core.whitespace=cr-at-eol','diff','--cached','--check');
  assert.notEqual(bad.status,0);
  assert.match(bad.stdout+bad.stderr,/trailing whitespace/i);
 }finally{
  rmSync(dir,{recursive:true,force:true});
 }
});
