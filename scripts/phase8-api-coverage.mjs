import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dir=resolve(root,'artifacts/api-server/archive/vernatun/server');
const app=await readFile(resolve(dir,'app.ts'),'utf8');
const mounts=new Map();
for(const m of app.matchAll(/app\.use\('([^']+)',(\w+)\)/g)){
 const old=mounts.get(m[2])??[];mounts.set(m[2],[...old,m[1]]);
}
const yaml=await readFile(resolve(root,'lib/api-spec/openapi.yaml'),'utf8');
const documented=new Set();let path='';
for(const line of yaml.split('\n')){
 const p=line.match(/^  (\/[^:]+):$/);if(p){path=p[1];continue}
 const method=line.match(/^    (get|post|put|patch|delete):$/);
 if(method&&path)documented.add(method[1].toUpperCase()+' '+path);
}
const routes=new Map();
for(const name of await readdir(dir)){
 if(!name.endsWith('.ts'))continue;
 const text=await readFile(resolve(dir,name),'utf8');
 for(const m of text.matchAll(/(\w+)\.(get|post|put|patch|delete)\('([^']+)'/g)){
  for(const prefix of mounts.get(m[1])??[]){
   if(!prefix.startsWith('/api'))continue;
   const path=(prefix.slice(4)+m[3]).replace(/:([A-Za-z_]\w*)/g,'{$1}');
   const key=m[2].toUpperCase()+' '+path;routes.set(key,{key,source:name});
  }
 }
}
const missing=[...routes.values()].filter(r=>!documented.has(r.key)).sort((a,b)=>a.key.localeCompare(b.key));
const result={generatedAt:new Date().toISOString(),staticMountedOperations:routes.size,documentedMountedOperations:routes.size-missing.length,missing,limitations:['Static route inventory, not proof of schemas or authorization coverage. Dynamic loops and externally configured routes require manual review.']};
await mkdir(resolve(root,'.local/qa'),{recursive:true});
await writeFile(resolve(root,'.local/qa/phase8-api-coverage.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({staticMountedOperations:result.staticMountedOperations,documentedMountedOperations:result.documentedMountedOperations,missing:missing.length}));
