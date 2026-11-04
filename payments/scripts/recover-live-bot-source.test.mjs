import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRecoveredModules} from './recover-live-bot-source.mjs';
import {patchOriginalBot} from './patch-recovered-live-bot.mjs';

const names=['money.js','broadcast.js','creator.js','gamedata.js','modes.js',
'game.js','support.js','admin.js','worker.js'];
const original=`// RUST UP main bot; keep webhook and all other existing routes
import { adminApi as adminApiImpl } from './admin.js';
async function onUpdate(upd, env) {
  if (upd.message) {
    if (await isAdmin(env, upd.message.from)) return;
  }
}
const isAdmin = async(env,u) => true;
const url = "/tg";
`;
function multipart(overrides={}){
  const map={version:3,sources:names,
    sourcesContent:names.map(n=>n==='worker.js'?original:'// '+n+' original module source code 000000')};
  Object.assign(map,overrides);
  const boundary='test-boundary-98aa';
  return {boundary,raw:[
    '--'+boundary,
    'Content-Disposition: form-data; name="worker.js.map"; filename="worker.js.map"',
    'Content-Type: application/json','',
    JSON.stringify(map),
    '--'+boundary+'--',''
  ].join('\r\n')};
}
test('recovers the nine original Worker sources without leaking/re-uploading credentials',()=>{
  const x=multipart();
  const files=parseRecoveredModules(x.raw,'multipart/form-data; boundary='+x.boundary);
  assert.equal(files.size,9);
  assert.equal(files.get('worker.js'),original);
});
test('missing or unexpected source files are refused',()=>{
  const x=multipart({sources:names.slice(0,-1),sourcesContent:names.slice(0,-1).map(x=>'// '+x+' has content')});
  assert.throws(()=>parseRecoveredModules(x.raw),/incomplete/);
  const y=multipart({sources:names.slice(0,8).concat('../secret.js')});
  assert.throws(()=>parseRecoveredModules(y.raw),/unexpected/);
});
test('patch preserves source and adds exactly one admin hook',()=>{
  const result=patchOriginalBot(original);
  assert.match(result,/RUSTUP_PAYMENT_ADMIN_HOOK/);
  assert.match(result,/handleExistingBotPaymentCommands\(upd, env/);
  assert.match(result,/const url = "\/tg";/);
  assert.equal((result.match(/async function onUpdate/g)||[]).length,1);
  assert.throws(()=>patchOriginalBot(result),/already_present/);
});
test('unsupported code cannot be patched blindly',()=>{
  assert.throws(()=>patchOriginalBot('async function other() {}'),/not_found/);
  assert.throws(()=>patchOriginalBot('async function onUpdate(upd, env) {\n}\n'),/unsupported/);
});
