import test from 'node:test';
import assert from 'node:assert/strict';
import {patchAdminSource} from './patch-recovered-admin-panel.mjs';
const sample=`
export async function onAdminUpdate(){}
async function adminApi(req, env, path, h) {
  const body = await req.json().catch(() => ({}));
  const user = await h.verifyInitData(String(body.initData || ""), env.ADMIN_BOT_TOKEN);
  if (!user || !user.id) return h.json({ ok: false, error: "auth" }, 401);
  if (!await h.isAdmin(env, user)) return h.json({ ok: false, error: "forbidden" }, 403);
  switch (path) {
    case "stats":
      return h.json({ok:true});
  }
  return h.json({ ok: false, error: "path" }, 404);
}`;
test('injects payment routes only after established authentication checks',()=>{
 const v=patchAdminSource(sample);
 assert.match(v,/import \{handleAdminPaymentPanelApi\}/);
 assert.match(v,/RUSTUP_PAYMENT_MINI_APP/);
 assert.ok(v.indexOf('await h.isAdmin(env, user)')<v.indexOf('case "payments"'));
 assert.ok(v.indexOf('case "payments"')<v.indexOf('case "stats"'));
 assert.throws(()=>patchAdminSource(v),/already_patched/);
});
test('refuses replacing admin handlers without checks',()=>{
 assert.throws(()=>patchAdminSource(sample.replace('await h.isAdmin(env, user)','Promise.resolve(true)')),/auth/);
 assert.throws(()=>patchAdminSource('function adminApi(){return true;}'),/authenticated_admin_endpoint_missing/);
});

test('accepts CRLF and alternate default-error quotes without relaxing auth checks',()=>{
 const variant=sample.replaceAll('\n','\r\n').replace(
  '  return h.json({ ok: false, error: "path" }, 404);',
  "  return h.json({ ok: false, error: 'path' }, 404);"
 );
 const result=patchAdminSource(variant);
 assert.match(result,/case "payments-set"/);
 assert.ok(result.indexOf('await h.isAdmin(env, user)')<result.indexOf('case "payments-set"'));
});
test('rejects missing denial returns despite matching authentication function names',()=>{
 assert.throws(()=>patchAdminSource(sample.replace(
  'if (!await h.isAdmin(env, user)) return h.json({ ok: false, error: "forbidden" }, 403);',
  'if (!await h.isAdmin(env, user)) console.warn("unauthorized");'
 )),/admin_endpoint_authentication_not_verified/);
 assert.throws(()=>patchAdminSource(sample.replace(
  'if (!user || !user.id) return h.json({ ok: false, error: "auth" }, 401);',
  'if (!user || !user.id) console.warn("bad identity");'
 )),/admin_endpoint_authentication_not_verified/);
});
