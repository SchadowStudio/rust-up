import test from 'node:test';
import assert from 'node:assert/strict';
import {ASSET_DIGITS,formatCryptoAtomic,validatePublicInvoice,
 displayFiat} from '../checkout/format.js';

const base={
 invoiceId:'12ace54d-3137-4dcf-9111-e0de257c56de',
 fiat:'RUB',amountMinor:5000,asset:'USDT_TRC20',chain:'tron',
 amountAtomic:'1000000',receiveAddress:'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
 status:'awaiting_payment',expiresAt:1762400000000
};
test('checkout parses RUB, EUR and USD without rounding money',()=>{
 assert.equal(displayFiat(5000,'RUB'),'50,00 ₽');
 assert.equal(displayFiat(5000,'EUR'),'50,00 €');
 assert.equal(displayFiat(5000,'USD'),'50,00 $');
 assert.equal(displayFiat(1,'EUR'),'0,01 €');
});
test('currency denomination and native atomic formatting are exact',()=>{
 assert.equal(formatCryptoAtomic('1000000',6),'1');
 assert.equal(formatCryptoAtomic('1',8),'0.00000001');
 assert.equal(formatCryptoAtomic('1000000000000000001',18),'1.000000000000000001');
 assert.equal(ASSET_DIGITS.USDT_ERC20,6);
});
test('checkout rejects wrong cryptocurrency networks',()=>{
 assert.throws(()=>validatePublicInvoice({...base,chain:'ethereum'}));
 assert.throws(()=>validatePublicInvoice({...base,fiat:'GBP'}));
 assert.throws(()=>validatePublicInvoice({...base,asset:'DOGE'}));
});
test('checkout never receives or reveals private wallet or merchant credentials',()=>{
 const parsed=validatePublicInvoice({...base,
  privateKey:'secret',projectApiKey:'secret',email:'person@example.com'});
 assert.equal(parsed.projectApiKey,undefined);
 assert.equal(parsed.privateKey,undefined);
 assert.equal(parsed.email,undefined);
 assert.equal(parsed.status,'awaiting_payment');
});
test('invalid invoice status and numeric amounts fail closed',()=>{
 assert.throws(()=>validatePublicInvoice({...base,status:'paid_unverified'}));
 assert.throws(()=>validatePublicInvoice({...base,amountMinor:-1}));
 assert.throws(()=>validatePublicInvoice({...base,amountAtomic:'not_a_number'}));
});
