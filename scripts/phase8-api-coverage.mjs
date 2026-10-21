import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inventoryMountedRoutes} from './lib/api-route-inventory.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dir=resolve(root,'artifacts/api-server/archive/vernatun/server');
const app=await readFile(resolve(dir,'app.ts'),'utf8');
const yaml=await readFile(resolve(root,'lib/api-spec/openapi.yaml'),'utf8');
const documented=new Set();let path='';
for(const line of yaml.split('\n')){
 const p=line.match(/^  (\/[^:]+):$/);if(p){path=p[1];continue}
 const method=line.match(/^    (get|post|put|patch|delete):$/);
 if(method&&path)documented.add(method[1].toUpperCase()+' '+path);
}
const sources=new Map();
for(const name of await readdir(dir)){
 if(!name.endsWith('.ts'))continue;
 sources.set(name,await readFile(resolve(dir,name),'utf8'));
}
const {routes,unresolved}=inventoryMountedRoutes(app,sources);
const missing=routes.filter(r=>!documented.has(r.key));
const result={generatedAt:new Date().toISOString(),staticMountedOperations:routes.length,documentedMountedOperations:routes.length-missing.length,missing,unresolved,limitations:['Static route inventory, not proof of schemas or authorization coverage. Unresolved dynamic registrations and externally configured routes require manual review.']};
await mkdir(resolve(root,'.local/qa'),{recursive:true});
await writeFile(resolve(root,'.local/qa/phase8-api-coverage.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({staticMountedOperations:result.staticMountedOperations,documentedMountedOperations:result.documentedMountedOperations,missing:missing.length,unresolved:unresolved.length}));
