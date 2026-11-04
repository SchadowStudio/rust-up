// Export public, secret-free modules for embedding in another project's site.
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {mkdir,copyFile,rm,writeFile} from 'node:fs/promises';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dest=path.join(root,'dist-checkout');
await rm(dest,{recursive:true,force:true});
await mkdir(dest,{recursive:true});
for(const file of ['widget.js','format.js'])
 await copyFile(path.join(root,'checkout',file),path.join(dest,file));
await writeFile(path.join(dest,'README.txt'),
 'Use these modules only from the merchant website.\n' +
 'Payment invoice data must come from the merchant backend.\n' +
 'Never expose the project API key in browser code.\n');
console.log('Public checkout ES modules generated in payments/dist-checkout/');
