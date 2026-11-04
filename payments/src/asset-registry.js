// Central, reviewed manifest of assets with LIVE verification adapters.
// Never add a symbol here without the independently verified chain adapter,
// scanner, exchange-rate feed, DB migration, and safety tests.
const entries=[
 ['BTC','bitcoin',8,3,'native','BTC','bitcoin-core'],
 ['ETH','ethereum',18,12,'native','ETH','evm-native'],
 ['TRX','tron',6,1,'native','TRX','tron-native'],
 ['USDT_ERC20','ethereum',6,12,'erc20','USDT','evm-erc20'],
 ['USDT_TRC20','tron',6,1,'trc20','USDT','tron-trc20'],
 ['TON','ton',9,1,'native','TON','ton-native']
];
export const ASSET_CATALOG=Object.freeze(Object.fromEntries(entries.map(
 ([asset,chain,decimals,confirmations,standard,marketSymbol,adapter])=>
  [asset,Object.freeze({asset,chain,decimals,confirmations,standard,marketSymbol,adapter})])));
export const ASSETS=Object.freeze(Object.fromEntries(Object.entries(ASSET_CATALOG).map(
 ([asset,entry])=>[asset,Object.freeze({
  chain:entry.chain,decimals:entry.decimals,confirmations:entry.confirmations
 })])));
export const RECEIVER_NETWORKS=Object.freeze({
 bitcoin:Object.freeze({name:'Bitcoin Mainnet',assets:Object.freeze(['BTC']),connection:'public-address',derivation:'watch-only-addresses'}),
 ethereum:Object.freeze({name:'Ethereum Mainnet',assets:Object.freeze(['ETH','USDT_ERC20']),connection:'eip6963',derivation:'public-addresses'}),
 tron:Object.freeze({name:'TRON Mainnet',assets:Object.freeze(['TRX','USDT_TRC20']),connection:'public-address',derivation:'public-addresses'}),
 ton:Object.freeze({name:'The Open Network Mainnet',assets:Object.freeze(['TON']),connection:'public-address',derivation:'watch-only-addresses'})
});
export function walletSetupPlan(){
 return Object.entries(RECEIVER_NETWORKS).map(([chain,item])=>({
  chain,name:item.name,assets:[...item.assets],connection:item.connection,
  needsExplicitOwnerApproval:true,automaticallyDerivesNewAccounts:false,
  requiresUniqueUnusedAddressPerInvoice:true
 }));
}
// Explicit verifier certification is separate from the display catalog.
// New symbols cannot piggyback on USDT Transfer-event logic.
const CERTIFIED_ADAPTERS=Object.freeze({
 BTC:'bitcoin-core',ETH:'evm-native',TRX:'tron-native',
 USDT_ERC20:'evm-erc20',USDT_TRC20:'tron-trc20',TON:'ton-native'
});
export const PINNED_MAINNET_CONTRACTS=Object.freeze({
 USDT_ERC20:Object.freeze({
  envKey:'USDT_ERC20_CONTRACT',
  address:'0xdAC17F958D2ee523a2206206994597C13D831ec7'
 }),
 USDT_TRC20:Object.freeze({
  envKey:'USDT_TRC20_CONTRACT',
  address:'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
 })
});
export function requireCertifiedPaymentAsset(asset,env={}){
 const item=ASSET_CATALOG[asset];
 if(!item||CERTIFIED_ADAPTERS[asset]!==item.adapter)
  throw Error('asset_verifier_not_certified');
 const pinned=PINNED_MAINNET_CONTRACTS[asset];
 if(item.standard!=='native'){
  if(!pinned||String(env[pinned.envKey]||'').toLowerCase()!==
      pinned.address.toLowerCase())
   throw Error('untrusted_token_mainnet_contract');
 }
 return item;
}
export function planCoinExtension({asset,chain,standard,decimals}={}){
 if(typeof asset!=='string'||!/^[A-Z][A-Z0-9_]{1,31}$/.test(asset)||
    typeof chain!=='string'||!/^[a-z][a-z0-9_-]{1,31}$/.test(chain)||
    !['native','erc20','trc20','spl','bep20'].includes(standard)||
    !Number.isInteger(decimals)||decimals<0||decimals>18)
  throw Error('invalid_asset_extension');
 if(standard==='erc20'&&chain!=='ethereum'||
    standard==='trc20'&&chain!=='tron'||
    standard==='spl'&&chain!=='solana'||
    standard==='bep20'&&chain!=='bsc')
  throw Error('invalid_token_chain');
 if(ASSET_CATALOG[asset])throw Error('asset_already_supported');
 return Object.freeze({
  asset,chain,standard,decimals,active:false,
  newNetwork:!Object.hasOwn(RECEIVER_NETWORKS,chain),
  mandatoryChecks:[
   'independently_reviewed_mainnet_contract_or_native_asset_identity',
   'real_receive_address_validation_and_owner_wallet_support',
   'chain_specific_indexer_and_verified_two_of_three_rpc_quorum',
   'on_chain_amount_and_required_confirmations',
   'two_independent_live_fiat_price_sources_and_integer_quoting',
   'explicit_database_schema_migration_and_project_opt_in',
   'unique_receive_address_pool_and_cross_project_transaction_deduplication',
   'testnet_then_real_mainnet_receive_and_reorg_tests',
   'security_review_before_new_asset_can_be_enabled'
  ]
 });
}
