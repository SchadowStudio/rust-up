import {mkdir,copyFile,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
// Publish only the management UI and its address-validation dependencies.
// Never publish Worker source, migrations, .dev.vars or environment secrets.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'dist-admin');
await rm(output,{recursive:true,force:true});
for(const p of ['admin/index.html','admin/app.js','src/address.js','src/assets.js']){
 const dest=path.join(output,p);
 await mkdir(path.dirname(dest),{recursive:true});
 await copyFile(path.join(root,p),dest);
}
await writeFile(path.join(output,'_headers'),
 '/admin/*\n  Cache-Control: no-store\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src \'none\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; connect-src https:; img-src \'self\'; base-uri \'none\'; form-action \'none\'\n');
console.log('Trust Wallet operator console generated at payments/dist-admin/admin/');
