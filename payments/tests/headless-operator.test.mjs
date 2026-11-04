import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOperatorCommand,executeOperator} from '../scripts/headless-operator.mjs';

const P='34301b80-18f9-4a69-a5a5-58df9a617817';
const KEY='93fa597d-1766-419b-9b5c-e704ad907157';
const WALLET='TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
test('headless CLI can read and configure independent project payment modes',()=>{
 assert.deepEqual(parseOperatorCommand(['project-config',P]),
  ['GET','/v2/admin/projects/'+P+'/payment-config']);
 assert.deepEqual(parseOperatorCommand(['project-profile',P,'Demo', 'true','true','false','15','--confirm']),
  ['POST','/v2/admin/projects/'+P+'/payment-config',{
   displayName:'Demo',invoicesEnabled:true,depositsEnabled:true,
   productsEnabled:false,invoiceLifetimeMinutes:15,
   confirmation:'CONFIRM_PROJECT_PAYMENT_SETTINGS'
  }]);
 assert.deepEqual(parseOperatorCommand(['project-crypto',P,'USDT_TRC20','true','--confirm']),
  ['POST','/v2/admin/projects/'+P+'/crypto-method',{
   asset:'USDT_TRC20',enabled:true,
   confirmation:'CONFIRM_PROJECT_PAYMENT_SETTINGS'}]);
});
test('no Web UI required to create project and manage its webhook and key rotation',()=>{
 assert.deepEqual(parseOperatorCommand(['project-create','Project A','https://example.com/payments','--confirm']),
  ['POST','/v2/admin/projects',{label:'Project A',webhookUrl:'https://example.com/payments'}]);
 assert.equal(parseOperatorCommand(['project-keys',P])[1],
  '/v2/admin/projects/'+P+'/keys');
 assert.equal(parseOperatorCommand(['project-key-revoke',P,KEY,'--confirm'])[2].keyId,KEY);
 assert.equal(parseOperatorCommand(['project-webhook',P,'https://shop.example.com/payment','--confirm'])[2].webhookUrl,
  'https://shop.example.com/payment');
});
test('wallet public addresses are manageable without browser wallet connectivity',()=>{
 const put=parseOperatorCommand(['address-add','tron',WALLET,'--confirm']);
 assert.equal(put[1],'/v2/admin/receivers');
 assert.deepEqual(put[2],{chain:'tron',address:WALLET});
 const enabled=parseOperatorCommand(['address-enable','tron',WALLET,'--confirm']);
 assert.equal(enabled[1],'/v2/admin/receivers/enable');
 assert.equal(enabled[2].confirmation,'CONFIRM_OPERATOR_CHANGE');
 assert.equal(parseOperatorCommand(['address-list'])[1],'/v2/admin/receivers');
});
test('admin write controls require explicit opt-in and strict values',()=>{
 for(const cmd of [
  ['project-create','A','https://example.com'],
  ['project-enable',P],['project-fiat',P,'EUR','true','100','5000'],
  ['project-crypto',P,'BTC','true'],['project-key-revoke',P,KEY],
  ['address-add','tron',WALLET],['review-close',P]
 ])assert.throws(()=>parseOperatorCommand(cmd),/confirm/);
 for(const cmd of [
  ['project-profile',P,'Demo','yes','true','false','15','--confirm'],
  ['project-crypto',P,'DOGE','true','--confirm'],
  ['project-fiat',P,'EUR','true','100.55','5000','--confirm'],
  ['project-profile','malformed-id','Demo','true','true','false','15','--confirm']
 ])assert.throws(()=>parseOperatorCommand(cmd));
});
test('operator CLI talks only to configured HTTPS gateway with auth header',async()=>{
 let called;
 const response=await executeOperator(['project-summary',P],{
  adminUrl:'https://private-gateway.example',
  adminKey:'x'.repeat(60),
  fetchFn:async (url,options)=>{
   called={url,options};
   return {ok:true,json:async()=>({ok:true,projectId:P,
    invoiceCounts:[{fiat:'RUB',status:'verified',invoice_count:4}]})};
  }
 });
 assert.equal(response.projectId,P);
 assert.equal(called.url,'https://private-gateway.example/v2/admin/projects/'+P+'/summary');
 assert.equal(called.options.headers.authorization,'Bearer '+'x'.repeat(60));
 assert.equal(called.options.redirect,'error');
});
test('network failures and non-OK responses do not report success',async()=>{
 await assert.rejects(()=>executeOperator(['projects'],{
  adminUrl:'https://gateway.example',adminKey:'x'.repeat(60),
  fetchFn:async()=>({ok:false,status:503,json:async()=>({ok:false,error:'admin_disabled'})})
 }),/gateway_admin_disabled/);
});
