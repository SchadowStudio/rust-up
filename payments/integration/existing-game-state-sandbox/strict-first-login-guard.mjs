// RUST UP payment integrity: block UNTRUSTED first-login device balances
// once the operator enables a real monetary wallet. Existing accounts remain
// unchanged. The legacy virtual-only game behavior stays the default.
// This file is a patcher/test helper, NOT a deployment or payment activation.
const TARGET='      const s = await importState(body.local, user);';
const REPLACEMENT=[
  '      // RUSTUP_STRICT_ACCOUNT_IMPORT_V1: client local storage is not a payment receipt.',
  '      // Preserve cosmetic profile only; game value must come from server entries.',
  "      const strictPaidAccount = env.PAYMENT_WALLET_STRICT_MODE === 'true';",
  '      const safeLocal = strictPaidAccount ? { user: body.local?.user } : body.local;',
  '      const s = await importState(safeLocal, user);'
].join('\n');
export function patchGameInitialImport(source){
  if(typeof source!=='string'||source.length<5000||source.length>500000||
     !source.includes('async function importState(local, tgUser)')||
     !source.includes('INSERT OR IGNORE INTO accounts (id, state, v, created, updated)'))
    throw Error('unexpected_rustup_game_source');
  if(source.includes('RUSTUP_STRICT_ACCOUNT_IMPORT_V1'))return source;
  const text=source.replace(/\r\n/g,'\n');
  const count=text.split(TARGET).length-1;
  if(count!==1)throw Error('unsafe_game_source_drift');
  const fixed=text.replace(TARGET,REPLACEMENT);
  if(fixed.split('RUSTUP_STRICT_ACCOUNT_IMPORT_V1').length!==2||
     !fixed.includes('await importState(safeLocal, user)'))
    throw Error('game_import_guard_failed');
  return source.includes('\r\n')?fixed.replace(/\n/g,'\r\n'):fixed;
}
export function sanitizedNewAccountImport(local,strict){
  return strict ? {user:local&&typeof local==='object'?local.user:undefined} : local;
}
