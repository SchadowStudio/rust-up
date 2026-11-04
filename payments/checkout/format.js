// Safe read-only invoice rendering. Merchant server supplies the invoice JSON.
export const ASSET_DIGITS=Object.freeze({BTC:8,ETH:18,TRX:6,USDT_ERC20:6,USDT_TRC20:6,TON:9});
export const NETWORK_NAMES=Object.freeze({
 bitcoin:'Bitcoin Mainnet',ethereum:'Ethereum Mainnet',tron:'TRON Mainnet',ton:'The Open Network Mainnet'
});
export function formatCryptoAtomic(amount,digits){
 if(!Number.isInteger(digits)||digits<0||digits>18||!/^[0-9]+$/.test(String(amount)))
  throw Error('invalid_crypto_amount');
 const atomic=BigInt(amount),divisor=10n**BigInt(digits);
 const whole=(atomic/divisor).toString();
 const decimals=(atomic%divisor).toString().padStart(digits,'0').replace(/0+$/,'');
 return whole+(decimals?'.'+decimals:'');
}
export function validatePublicInvoice(p){
 if(!p||typeof p!=='object'||!ASSET_DIGITS[p.asset]||
    !NETWORK_NAMES[p.chain]||!['awaiting_payment','verified','expired','manual_review'].includes(p.status)||
    typeof p.receiveAddress!=='string'||p.receiveAddress.length>128||
    !Number.isSafeInteger(p.amountMinor)||p.amountMinor<1||
    !['RUB','EUR','USD'].includes(p.fiat)||!Number.isSafeInteger(p.expiresAt)||
    !/^[0-9]+$/.test(String(p.amountAtomic)))
  throw Error('invalid_invoice_response');
 const expected={BTC:'bitcoin',ETH:'ethereum',TRX:'tron',
  USDT_ERC20:'ethereum',USDT_TRC20:'tron',TON:'ton'};
 if(expected[p.asset]!==p.chain)throw Error('wrong_network');
 return {asset:p.asset,chain:p.chain,fiat:p.fiat,
  amountMinor:p.amountMinor,amountAtomic:p.amountAtomic,
  receiveAddress:p.receiveAddress,status:p.status,
  expiresAt:p.expiresAt,invoiceId:String(p.invoiceId||''),
  confirmedOnChain:p.confirmedOnChain===true,
  deliveredToProject:p.deliveredToProject===true};
}
export function displayFiat(amountMinor,currency){
 if(!Number.isSafeInteger(amountMinor)||amountMinor<0||
    !['RUB','EUR','USD'].includes(currency))throw Error('invalid_fiat');
 const whole=Math.floor(amountMinor/100);
 const cents=String(amountMinor%100).padStart(2,'0');
 return whole.toLocaleString('de-DE')+','+cents+' '+({RUB:'₽',EUR:'€',USD:'$'}[currency]);
}
