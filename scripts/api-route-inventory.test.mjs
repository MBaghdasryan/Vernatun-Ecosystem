import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inventoryMountedRoutes} from './lib/api-route-inventory.mjs';

test('mounts resolve module symbols and aliases, not same-named locals in unrelated files',()=>{
 const result=inventoryMountedRoutes(`
 import {router as auth} from './auth.js';
 import {router as records} from './records.js';
 app.use('/api/auth', auth); app.use('/api', records);
 app.get('/api/health', handler);
 `,new Map([
  ['auth.ts',`export const router=Router();router.get('/sessions',handler);`],
  ['records.ts',`export const router=Router();router.get('/units/:id',handler); // router.post('/fake',handler);
 const comment="router.delete('/also-fake',handler)";`],
 ]));
 assert.deepEqual(result.routes.map(r=>r.key),['GET /auth/sessions','GET /health','GET /units/{id}']);
 assert.deepEqual(result.unresolved,[]);
});
test('literal loops, concatenation and template paths expand without a fake GET /',()=>{
 const result=inventoryMountedRoutes(`import {r} from './routes.js';app.use('/api',r)`,new Map([
  ['routes.ts',`export const r=Router();
 for(const resource of ['organizations','units'])r.get('/'+resource,handler);
 for(const action of ['enable','disable'])r.post(\`/mfa/\${action}\`,handler);
 r.get('/'+unknownResource,handler);`],
 ]));
 assert.deepEqual(result.routes.map(r=>r.key),['GET /organizations','GET /units','POST /mfa/disable','POST /mfa/enable']);
 assert.equal(result.unresolved.length,1);
 assert.match(result.unresolved[0].expression,/unknownResource/);
});
test('duplicate registrations preserve both sources; non-API mounts are excluded',()=>{
 const result=inventoryMountedRoutes(`import {a} from './a.js';import {b} from './b.js';
 app.use('/api',a);app.use('/api',b);app.use('/public',a);`,new Map([
  ['a.ts',`export const a=Router();a.get('/units/',handler)`],
  ['b.ts',`export const b=Router();b.get('/units',handler)`],
 ]));
 assert.deepEqual(result.routes,[{key:'GET /units',sources:['a.ts','b.ts']}]);
});
