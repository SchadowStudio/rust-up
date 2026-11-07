import test from 'node:test';
import assert from 'node:assert/strict';
import {patchAdminFrontendIndex,patchAdminFrontendApp,gitBlobHash} from './patch-existing-support-admin-frontend.mjs';
test('existing Support Mini App gets a fifth payment tab and separate script',()=>{
 const html='<link rel="stylesheet" href="style.css?v=20261105d">\n'+
  '<button type="button" data-tab="log">Журнал</button>\n'+
  '<script src="app.js?v=20261105d"></script>';
 const modified=patchAdminFrontendIndex(html);
 assert.match(modified,/data-tab="payments"/);
 assert.match(modified,/payments-tab.js/);
 assert.match(modified,/payments.css/);
 assert.throws(()=>patchAdminFrontendIndex(modified),/payment_panel_already_exists/);
});
test('admin app loads payment tab through existing signed Telegram initData API',()=>{
 const script=`function render(){
    tab === 'users' ? usersPage() : tab === 'log' ? logPage() : tab === 'support' ? supportPage() : statsPage();
  }
  if (['stats', 'users', 'support', 'log'].includes(start)) tab = start;`;
 const result=patchAdminFrontendApp(script);
 assert.match(result,/RustUpPaymentsTab.render/);
 assert.match(result,/payments'\].includes\(start\)/);
 assert.match(result,/usersPage\(\)/);
 assert.throws(()=>patchAdminFrontendApp(result),/website_layout_changed/);
});

test('Windows CRLF is the same tracked Git blob as LF without accepting changed content',()=>{
 const lf='<!doctype html>\n<html>\n<title>RUST UP</title>\n';
 const crlf=lf.replace(/\n/g,'\r\n');
 assert.equal(gitBlobHash(crlf),gitBlobHash(lf));
 assert.notEqual(gitBlobHash(crlf+'tampering'),gitBlobHash(lf));
});
