import test from 'node:test';
import assert from 'node:assert/strict';
import {issueFixedStarsRefund,handleRefundCommand} from './refunds.mjs';

test('refund flow is disabled unless explicitly enabled and operator-approved',async()=>{
 await assert.rejects(
  ()=>issueFixedStarsRefund({},{adminId:1,orderId:'00000000-0000-4000-8000-000000000001'}),
  /refunds_not_enabled/
 );
 await assert.rejects(
  ()=>issueFixedStarsRefund({STARS_REFUNDS_ENABLED:'true'},{adminId:1,orderId:'00000000-0000-4000-8000-000000000001'}),
  /finance_admin_required/
 );
});
test('ordinary and group messages never trigger Stars refund command',async()=>{
 assert.equal(await handleRefundCommand({message:{text:'/start'}},{}),false);
 assert.equal(await handleRefundCommand({message:{text:'/pay refundstars 00000000-0000-4000-8000-000000000001 CONFIRM',from:{id:1},chat:{id:-1,type:'group'}}},{}),false);
});
