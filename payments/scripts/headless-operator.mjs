// Headless operator CLI: no dashboard, no provider website, no token on argv.
// Credentials are read from PAYMENTS_ADMIN_URL and PAYMENTS_ADMIN_KEY in memory.
// Outputs project API credentials only once, when explicitly creating projects
// or rotating a key. Never redirects or follows gateway-supplied URLs.
import {pathToFileURL} from 'node:url';

const HELP=`RUST UP / Multi-project crypto payments - headless operator CLI

Requirements:
  PAYMENTS_ADMIN_URL=https://your-private-worker.example.com
  PAYMENTS_ADMIN_KEY=(the operator secret from your Cloudflare Worker)

Commands:
  status
  projects
  project-create <name> <https-webhook> --confirm
  project-enable <project-uuid> --confirm
  project-disable <project-uuid> --confirm
  project-config <project-uuid>
  project-profile <project-uuid> <display-name> <invoices:true|false> <deposits:true|false> <products:true|false> <minutes:5-20> --confirm
  project-fiat <project-uuid> <RUB|EUR|USD> <enabled:true|false> <min-minor> <max-minor> --confirm
  project-crypto <project-uuid> <BTC|ETH|TRX|USDT_ERC20|USDT_TRC20> <enabled:true|false> --confirm
  project-summary <project-uuid>
  project-payments <project-uuid> [all|awaiting_payment|verified|expired|manual_review]
  project-keys <project-uuid>
  project-key-create <project-uuid> --confirm
  project-key-revoke <project-uuid> <key-uuid> --confirm
  project-webhook <project-uuid> <https-webhook> --confirm
  address-list
  address-add <bitcoin|ethereum|tron> <public-address> --confirm
  address-enable <bitcoin|ethereum|tron> <public-address> --confirm
  address-disable <bitcoin|ethereum|tron> <public-address> --confirm
  rates
  reviews [project-uuid]
  review-close <review-uuid> --confirm

For mutations, --confirm is required. No private key, wallet seed, password,
Telegram ID or sensitive customer information belongs in CLI arguments.
`;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSETS=['BTC','ETH','TRX','USDT_ERC20','USDT_TRC20'];
function fail(msg){throw Error(msg)}
function id(value,label='ID'){
 if(!uuid.test(value||''))fail('invalid_'+label.toLowerCase().replaceAll(' ','_'));
 return value.toLowerCase();
}
function bool(value){
 if(value==='true')return true;
 if(value==='false')return false;
 fail('expected_true_or_false');
}
function integer(value,min,max){
 if(!/^[0-9]+$/.test(value||''))fail('expected_integer');
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<min||n>max)fail('integer_out_of_range');
 return n;
}
function endpoint(){
 const url=process.env.PAYMENTS_ADMIN_URL||'';
 let u;
 try{u=new URL(url)}catch{fail('PAYMENTS_ADMIN_URL_is_missing_or_invalid')}
 if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search||
    u.pathname!=='/'||u.port&&u.port!=='443')
  fail('PAYMENTS_ADMIN_URL_must_be_HTTPS_origin');
 return u.origin;
}
function credentials(){
 const secret=process.env.PAYMENTS_ADMIN_KEY||'';
 if(typeof secret!=='string'||secret.length<48)
  fail('PAYMENTS_ADMIN_KEY_missing_or_too_short');
 return secret;
}
function mustConfirm(flag){
 if(!flag)fail('operator_change_requires_--confirm');
}
function operation(argv){
 const filtered=argv.filter(x=>x!=='--confirm');
 const confirmed=filtered.length!==argv.length;
 const [cmd,...args]=filtered;
 const path=id=>encodeURIComponent(id);
 switch(cmd){
  case 'status':return ['GET','/v2/admin/status'];
  case 'projects':return ['GET','/v2/admin/projects'];
  case 'project-create':
   mustConfirm(confirmed);
   if(args.length!==2)fail('usage:_project-create_name_webhook_--confirm');
   return ['POST','/v2/admin/projects',{label:args[0],webhookUrl:args[1]}];
  case 'project-enable':
  case 'project-disable':
   mustConfirm(confirmed);
   if(args.length!==1)fail('usage:_project-enable_or_disable_id_--confirm');
   return ['POST','/v2/admin/projects/'+(cmd==='project-enable'?'enable':'disable'),
    {projectId:id(args[0]),confirmation:'CONFIRM_OPERATOR_CHANGE'}];
  case 'project-config':
   if(args.length!==1)fail('usage:_project-config_id');
   return ['GET','/v2/admin/projects/'+path(id(args[0]))+'/payment-config'];
  case 'project-profile':
   mustConfirm(confirmed);
   if(args.length!==6)fail('usage:_project-profile_id_name_invoices_deposits_products_minutes_--confirm');
   return ['POST','/v2/admin/projects/'+path(id(args[0]))+'/payment-config',{
    displayName:args[1],invoicesEnabled:bool(args[2]),depositsEnabled:bool(args[3]),
    productsEnabled:bool(args[4]),invoiceLifetimeMinutes:integer(args[5],5,20),
    confirmation:'CONFIRM_PROJECT_PAYMENT_SETTINGS'}];
  case 'project-fiat':
   mustConfirm(confirmed);
   if(args.length!==5||!['RUB','EUR','USD'].includes(args[1]))fail('invalid_project_fiat_arguments');
   return ['POST','/v2/admin/projects/'+path(id(args[0]))+'/fiat-method',{
    currency:args[1],enabled:bool(args[2]),minMinor:integer(args[3],1,100000000000),
    maxMinor:integer(args[4],1,100000000000),confirmation:'CONFIRM_PROJECT_PAYMENT_SETTINGS'}];
  case 'project-crypto':
   mustConfirm(confirmed);
   if(args.length!==3||!ASSETS.includes(args[1]))fail('invalid_project_crypto_arguments');
   return ['POST','/v2/admin/projects/'+path(id(args[0]))+'/crypto-method',{
    asset:args[1],enabled:bool(args[2]),confirmation:'CONFIRM_PROJECT_PAYMENT_SETTINGS'}];
  case 'project-summary':
   if(args.length!==1)fail('usage:_project-summary_id');
   return ['GET','/v2/admin/projects/'+path(id(args[0]))+'/summary'];
  case 'project-payments':
   if(args.length<1||args.length>2||
      !['all','awaiting_payment','verified','expired','manual_review'].includes(args[1]||'all'))
    fail('invalid_project_payment_filter');
   return ['GET','/v2/admin/projects/'+path(id(args[0]))+'/payments?'+
    new URLSearchParams({status:args[1]||'all',limit:'50'})];
  case 'project-keys':
   if(args.length!==1)fail('usage:_project-keys_id');
   return ['GET','/v2/admin/projects/'+path(id(args[0]))+'/keys'];
  case 'project-key-create':
   mustConfirm(confirmed);
   if(args.length!==1)fail('usage:_project-key-create_id_--confirm');
   return ['POST','/v2/admin/keys',{projectId:id(args[0])}];
  case 'project-key-revoke':
   mustConfirm(confirmed);
   if(args.length!==2)fail('usage:_project-key-revoke_id_keyid_--confirm');
   return ['POST','/v2/admin/keys/revoke',{projectId:id(args[0]),keyId:id(args[1]),
    confirmation:'CONFIRM_KEY_REVOCATION'}];
  case 'project-webhook':
   mustConfirm(confirmed);
   if(args.length!==2)fail('usage:_project-webhook_id_url_--confirm');
   return ['POST','/v2/admin/projects/webhook',{projectId:id(args[0]),webhookUrl:args[1],
    confirmation:'CONFIRM_WEBHOOK_UPDATE'}];
  case 'address-list':return ['GET','/v2/admin/receivers'];
  case 'address-add':
   mustConfirm(confirmed);
   if(args.length!==2||!['bitcoin','ethereum','tron'].includes(args[0]))
    fail('invalid_receive_address_args');
   return ['POST','/v2/admin/receivers',{chain:args[0],address:args[1]}];
  case 'address-enable':
  case 'address-disable':
   mustConfirm(confirmed);
   if(args.length!==2||!['bitcoin','ethereum','tron'].includes(args[0]))
    fail('invalid_receive_address_args');
   return ['POST','/v2/admin/receivers/'+(cmd==='address-enable'?'enable':'disable'),{
    chain:args[0],address:args[1],confirmation:'CONFIRM_OPERATOR_CHANGE'}];
  case 'rates':return ['GET','/v2/admin/rates'];
  case 'reviews':
   if(args.length>1)fail('usage:_reviews_optional_project_id');
   return ['GET','/v2/admin/reviews'+(args.length?'?'+new URLSearchParams({projectId:id(args[0])}):'')];
  case 'review-close':
   mustConfirm(confirmed);
   if(args.length!==1)fail('usage:_review-close_reviewid_--confirm');
   return ['POST','/v2/admin/reviews/'+path(id(args[0]))+'/close',{
    confirmation:'I_HAVE_REVIEWED_PAYMENT',resolutionCode:'operator_reviewed'}];
  default:fail('unknown_command');
 }
}
export function parseOperatorCommand(args){
 return operation(args);
}
export async function executeOperator(args,{adminUrl=endpoint(),adminKey=credentials(),fetchFn=fetch}={}){
 const [method,route,body]=operation(args);
 const response=await fetchFn(adminUrl+route,{
  method,redirect:'error',cache:'no-store',
  headers:{authorization:'Bearer '+adminKey,
   ...(body?{'content-type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{}),
  signal:AbortSignal.timeout(15000)
 });
 let data;
 try{data=await response.json()}catch{fail('invalid_gateway_response')}
 if(!response.ok||data.ok!==true)
  fail('gateway_'+(String(data.error||response.status).slice(0,90)));
 return data;
}
async function main(){
 const args=process.argv.slice(2);
 if(args.length===0||args.includes('--help')||args.includes('-h')){
  process.stdout.write(HELP);return;
 }
 try{
  const result=await executeOperator(args);
  if(result.apiKey||result.webhookSigningSecret)
   process.stderr.write('WARNING: credentials shown ONCE; store in secure password manager, never in chat, logs or shell history.\n');
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
 }catch(error){
  process.stderr.write('Operator action failed: '+error.message+'\n');
  process.exitCode=1;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 await main();
