import {mkdir,copyFile,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
// Publish only the management UI and its address-validation dependencies.
// Never publish Worker source, migrations, .dev.vars or environment secrets.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'dist-admin');
await rm(output,{recursive:true,force:true});
for(const p of ['admin/index.html','admin/app.js','multi-admin/index.html','multi-admin/app.js','src/address.js','src/assets.js']){
 const dest=path.join(output,p);
 await mkdir(path.dirname(dest),{recursive:true});
 await copyFile(path.join(root,p),dest);
}
const secureHeaders=[
 '  Cache-Control: no-store',
 '  X-Content-Type-Options: nosniff',
 '  Referrer-Policy: no-referrer',
 '  X-Frame-Options: DENY',
 "  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src https:; img-src 'self'; base-uri 'none'; form-action 'none'"
].join('\n');
await writeFile(path.join(output,'_headers'),
 ['/admin/*','/multi-admin/*'].map(x=>x+'\n'+secureHeaders).join('\n'));
console.log('Trust Wallet operator consoles generated at payments/dist-admin/admin/ and /multi-admin/.');
