// Adds /stars/ to existing ttzoomrust-hub/rust-up GitHub Pages checkout.
// No existing website files are modified. No GitHub push is performed.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const src=path.join(root,'payments','frontend','stars-shop');
const files=['index.html','app.js','styles.css','config.js'];
async function main(){
 const arg=process.argv[2];
 if(!arg)throw Error('Usage: node payments/scripts/install-stars-shop.mjs "<RUST-UP-Website-checkout>"');
 const website=await fs.realpath(path.resolve(arg));
 if(website.startsWith(root+path.sep))throw Error('website_checkout_must_be_separate');
 await fs.access(path.join(website,'.git'));
 await fs.access(path.join(website,'admin','index.html'));
 const target=path.join(website,'stars');
 try{await fs.access(target);throw Error('stars_folder_already_exists_refuse_overwrite');}
 catch(e){if(e.code!=='ENOENT')throw e;}
 await fs.mkdir(target,{recursive:false});
 for(const name of files)
  await fs.copyFile(path.join(src,name),path.join(target,name),fs.constants.COPYFILE_EXCL);
 console.log('PASS: Existing GitHub Pages admin/game files unchanged.');
 console.log('PASS: New /rust-up/stars/ Telegram Mini App files copied.');
 console.log('NOT DEPLOYED: review files and commit/push website only AFTER backend is ready.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error('Stars shop install blocked:',e.message);process.exitCode=1;});
