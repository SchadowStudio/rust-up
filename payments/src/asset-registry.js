// Central, reviewed manifest of assets with LIVE verification adapters.
// Never add a symbol here without the independently verified chain adapter,
// scanner, exchange-rate feed, DB migration, and safety tests.
const entries=[
 ['BTC','bitcoin',8,3,'native','BTC','bitcoin-core'],
 ['ETH','ethereum',18,12,'native','ETH','evm-native'],
 ['TRX','tron',6,1,'native','TRX','tron-native'],
 ['USDT_ERC20','ethereum',6,12,'erc20','USDT','evm-erc20'],
 ['USDT_TRC20','tron',6,1,'trc20','USDT','tron-trc20']
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
 tron:Object.freeze({name:'TRON Mainnet',assets:Object.freeze(['TRX','USDT_TRC20']),connection:'public-address',derivation:'public-addresses'})
});
export function walletSetupPlan(){
 return Object.entries(RECEIVER_NETWORKS).map(([chain,item])=>({
  chain,name:item.name,assets:[...item.assets],connection:item.connection,
  needsExplicitOwnerApproval:true,automaticallyDerivesNewAccounts:false,
  requiresUniqueUnusedAddressPerInvoice:true
 }));
}
export function planCoinExtension({asset,chain,standard,decimals}={}){
 if(typeof asset!=='string'||!/^[A-Z][A-Z0-9_]{1,31}$/.test(asset)||
    typeof chain!=='string'||!['bitcoin','ethereum','tron'].includes(chain)||
    !['native','erc20','trc20'].includes(standard)||
    !Number.isInteger(decimals)||decimals<0||decimals>18)
  throw Error('invalid_asset_extension');
 if(standard==='erc20'&&chain!=='ethereum'||standard==='trc20'&&chain!=='tron')
  throw Error('invalid_token_chain');
 if(ASSET_CATALOG[asset])throw Error('asset_already_supported');
 return Object.freeze({
  asset,chain,standard,decimals,active:false,
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
