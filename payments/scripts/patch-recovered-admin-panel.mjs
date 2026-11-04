// Patches only a locally recovered RUST UP admin.js module, never the live bot.
// Existing /api/adm/* already validates ADMIN_BOT_TOKEN initData and isAdmin.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const bridge=path.join(root,'payments','integration','telegram-stars');
const IMPORT="import {handleAdminPaymentPanelApi} from './admin-panel-api.mjs';\n";
const MARK='  // RUSTUP_PAYMENT_MINI_APP: adminApi has verified initData and isAdmin.\n';
const CASE=MARK+
  '    case "payments":\n'+
  '    case "payments-set":\n'+
  '      return h.json(await handleAdminPaymentPanelApi(path, body, env, user));\n';
export function patchAdminSource(source){
  const fn='async function adminApi(req, env, path, h) {';
  if(typeof source!=='string'||source.split(fn).length!==2)
    throw Error('authenticated_admin_endpoint_missing');
  if(source.includes('RUSTUP_PAYMENT_MINI_APP')||source.includes('handleAdminPaymentPanelApi'))
    throw Error('admin_payment_panel_already_patched');
  const offset=source.indexOf(fn);
  // Source maps can contain CRLF, different whitespace and single-quoted
  // responses. Do not require a particular default 404 string/indentation:
  // require the authenticated adminApi function and both guards instead.
  const local=source.slice(offset,offset+12000);
  const matches=[...local.matchAll(/^([ \\t]*)switch\\s*\\(\\s*path\\s*\\)\\s*\\{/gm)];
  const mark=matches.length===1?matches[0]:null;
  const sw=mark?offset+mark.index:-1;
  const pre=sw>=0?source.slice(offset,sw):'';
  const auth=pre.indexOf('await h.verifyInitData(');
  const token=pre.indexOf('env.ADMIN_BOT_TOKEN');
  const guard=pre.indexOf('await h.isAdmin(env, user)');
  const idReject=/if\\s*\\(\\s*!user\\s*\\|\\|\\s*!user\\.id\\s*\\)\\s*return\\s+h\\.json\\s*\\(/.test(pre);
  const adminReject=/if\\s*\\(\\s*!\\s*(?:\\(\\s*)?await\\s+h\\.isAdmin\\s*\\(\\s*env\\s*,\\s*user\\s*\\)\\s*\\)?\\s*\\)\\s*return\\s+h\\.json\\s*\\(/.test(pre);
  if(sw<0||sw-offset>6000||auth<0||token<auth||guard<token||!idReject||!adminReject)
    throw Error('admin_endpoint_authentication_not_verified ('+
      'switch='+Boolean(mark)+',signed_initData='+(auth>=0&&token>auth)+
      ',admin_check='+(guard>token)+',reject_invalid_user='+idReject+
      ',reject_non_admin='+adminReject+')');
  const begin=mark[0];
  const insertion=begin+'\n'+CASE;
  return IMPORT+source.slice(0,sw)+source.slice(sw).replace(begin,insertion);
}
async function main(){
  const target=process.argv[2];
  if(!target)throw Error('Usage: node payments/scripts/patch-recovered-admin-panel.mjs "<recovered-directory>"');
  const directory=await fs.realpath(path.resolve(target));
  const allowed=path.join(root,'.private','rustup-bot-recovered')+path.sep;
  if(!directory.startsWith(allowed))throw Error('not_a_private_recovery_directory');
  const worker=await fs.readFile(path.join(directory,'worker.js'),'utf8');
  if(!worker.includes('RUSTUP_PAYMENT_ADMIN_HOOK'))
    throw Error('existing_bot_payment_hook_missing');
  const admin=path.join(directory,'admin.js');
  const source=await fs.readFile(admin,'utf8');
  const result=patchAdminSource(source);
  const savedBundle=path.join(directory,'worker.payment-admin.bundle.js');
  const baseline=path.join(directory,'worker.before-payment-panel.bundle.js');
  // Preserve the exact previously live-deployed bundle for later fingerprint checks.
  await fs.copyFile(savedBundle,baseline,fs.constants.COPYFILE_EXCL);
  await fs.copyFile(path.join(bridge,'admin-panel-api.mjs'),path.join(directory,'admin-panel-api.mjs'),fs.constants.COPYFILE_EXCL);
  await fs.writeFile(path.join(directory,'admin.before-payment-panel.js'),source,{flag:'wx',mode:0o600});
  await fs.writeFile(admin,result,{mode:0o600});
  console.log('PASS: Original admin.js authentication and authorization preserved.');
  console.log('PASS: payments and payments-set endpoints integrated into /api/adm/.');
  console.log('PASS: original live bundle saved for comparison.');
  console.log('NOT DEPLOYED. Rebuild worker.payment-admin.bundle.js, verify version and dry-run.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('Admin panel patch failed:',e.message);process.exitCode=1;});
