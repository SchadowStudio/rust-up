// Generates an OFFLINE, non-executable proposal for a new cryptocurrency.
// Never dynamically load plugins or turn a candidate into live payment support.
import {planCoinExtension} from '../src/asset-registry.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve} from 'node:path';

export function coinScaffold(asset,chain,standard,decimals){
 const proposal=planCoinExtension({asset,chain,standard,decimals});
 const manifest={
  schemaVersion:1,asset:proposal.asset,chain:proposal.chain,
  standard:proposal.standard,decimals:proposal.decimals,
  status:'REVIEW_REQUIRED',
  paymentAcceptanceEnabled:false,
  verificationAdapter:null,
  receivingAddressValidator:null,
  tokenContract:null,
  fiatPriceFeed:null,
  operatorApproved:false,
  checks:proposal.mandatoryChecks
 };
 const checklist=`# ${asset} / ${chain}: Payment Integration Review

**NOT ACTIVE. NO CUSTOMER FUNDS MAY BE ACCEPTED.**

A proposed cryptocurrency cannot become active by adding a symbol.
It needs independently verified mainnet contracts, exchange rates,
public receiving address support and blockchain reconcilers.

## Integration checklist
${proposal.mandatoryChecks.map((x,i)=>`- [ ] ${i+1}. ${x.replaceAll('_',' ')}`).join('\n')}

## Code locations requiring a reviewed implementation

- \`payments/src/asset-registry.js\` (catalog and verifier certification)
- \`payments/src/chains.js\` and \`payments/src/multi/quorum.js\`
- \`payments/src/multi/monitor.js\` (automatic on-chain detection)
- \`payments/src/multi/market.js\` (dual-source fiat pricing)
- \`payments/src/address.js\` (checksum-correct receiver validation)
- \`payments/migrations/\` (future SQLite schema migration)
- \`payments/src/multi/project-config.js\` (per-project opt-in)
- \`payments/tests/\` (mainnet proof, reorg, underpay and fake-token tests)

Do not paste a wallet recovery phrase, private key, xprv, API secrets or
personal information in this folder or any Git repository.

Deployment remains manually disabled until all security tests pass.
`;
 return {proposal,manifest,checklist};
}
export async function writeCoinScaffold(asset,chain,standard,decimals,{
 root=resolve(dirname(fileURLToPath(import.meta.url)),'..','coin-candidates')
}={}){
 const output=coinScaffold(asset,chain,standard,decimals);
 const folder=join(root,asset);
 await mkdir(folder,{recursive:true});
 // Exclusive writes never overwrite existing review or approvals.
 await writeFile(join(folder,'manifest.json'),
  JSON.stringify(output.manifest,null,2)+'\n',{flag:'wx',mode:0o600});
 await writeFile(join(folder,'SECURITY-REVIEW.md'),output.checklist,
  {flag:'wx',mode:0o600});
 return {folder,status:output.manifest.status};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 const [asset,chain,standard,decimals,...extras]=process.argv.slice(2);
 if(extras.length||!asset||!chain||!standard||!/^[0-9]+$/.test(decimals||'')){
  process.stderr.write('Usage: node scripts/scaffold-coin.mjs SYMBOL chain native|erc20|trc20|spl|bep20 decimals\n');
  process.exitCode=1;
 }else{
  try{
   const result=await writeCoinScaffold(asset,chain,standard,Number(decimals));
   process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }catch(error){
   process.stderr.write('Coin candidate not created: '+String(error.message).slice(0,100)+'\n');
   process.exitCode=1;
  }
 }
}
