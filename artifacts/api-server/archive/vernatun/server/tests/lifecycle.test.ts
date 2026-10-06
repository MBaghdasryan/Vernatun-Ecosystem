import sharp from 'sharp';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Tests require isolated vernatun_test database');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
let base='';const server=app.listen(0,'127.0.0.1');
class Client{cookie='';csrf='';async call(path:string,method='GET',body?:unknown,csrf=true){const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(this.cookie?{Cookie:this.cookie}:{}),...(csrf&&method!=='GET'?{'X-CSRF-Token':this.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const cookies=r.headers.getSetCookie();if(cookies.length)this.cookie=cookies.map(x=>x.split(';')[0]).join('; ');const data=r.status===204?null:await r.json();if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data}}async login(key:string){const a=seeded.accounts[key];await this.call('/auth/session');const r=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(r.status,200);if(!r.data.contextId){const id=r.data.contexts.find((x:any)=>x.role_key===a.role).id;assert.equal((await this.call('/auth/context','POST',{id})).status,200)}return this}}

let developer:Client,contractor:Client,other:Client,owner:Client;
before(async()=>{await pool.query('DELETE FROM auth_rate_limits');await new Promise<void>(r=>server.listening?r():server.on('listening',r));base='http://127.0.0.1:'+(server.address() as {port:number}).port;developer=await new Client().login('developer');contractor=await new Client().login('contractor');other=await new Client().login('second_org');owner=await new Client().login('unit_owner')});
after(async()=>{server.close();server.closeAllConnections();await pool.end()});
test('Defect photos are decoded, private and restricted to the assigned contractor scope',async()=>{
 const d=await developer.call('/defects','POST',{unitId:seeded.fixtures.ua,subject:'Photo access test',location:'Window',contractorId:seeded.accounts.contractor.id,dueOn:'2026-10-15'});assert.equal(d.status,201);
 const photo=await sharp({create:{width:8,height:8,channels:3,background:'#ffffff'}}).png().toBuffer();
 const upload=await fetch(base+'/api/defects/'+d.data.id+'/photos',{method:'POST',headers:{Cookie:contractor.cookie,'X-CSRF-Token':contractor.csrf,'Content-Type':'application/octet-stream'},body:photo});assert.equal(upload.status,201);const id=(await upload.json()).id;
 const download=(c?:Client)=>fetch(base+'/api/defect-photos/'+id,{headers:c?{Cookie:c.cookie}:{}});
 const allowed=await download(developer);assert.equal(allowed.status,200);assert.equal(allowed.headers.get('content-type'),'image/jpeg');assert.equal(allowed.headers.get('cache-control'),'private, no-store');
 assert.equal((await download()).status,401);assert.ok([403,404].includes((await download(other)).status));assert.ok([403,404].includes((await download(owner)).status));
 const invalid=await fetch(base+'/api/defects/'+d.data.id+'/photos',{method:'POST',headers:{Cookie:contractor.cookie,'X-CSRF-Token':contractor.csrf,'Content-Type':'application/octet-stream'},body:'<svg></svg>'});assert.equal(invalid.status,400);
});
test('Handover requires a complete inspection and rejects foreign organization access',async()=>{
 const unit=(await pool.query('INSERT INTO units(organization_id,building_id,number,area) VALUES($1,$2,$3,56.4) RETURNING id',[seeded.fixtures.orgA,seeded.fixtures.ba,'H-'+randomBytes(5).toString('hex')])).rows[0];
 const h=await developer.call('/handovers','POST',{unitId:unit.id});assert.equal(h.status,201);const path='/handovers/'+h.data.id;
 assert.equal((await developer.call(path+'/transition','POST',{status:'ready'})).status,409);
 assert.ok([403,404].includes((await other.call(path+'/transition','POST',{status:'ready'})).status));
 const i=await developer.call(path+'/inspect','POST',{scheduledAt:new Date().toISOString(),checklist:['Check window','Check door']});assert.equal(i.status,201);
 assert.equal((await developer.call('/inspections/'+i.data.id+'/complete','POST',{report:'Inspection complete',checked:[0]})).status,409);
 assert.equal((await developer.call('/inspections/'+i.data.id+'/complete','POST',{report:'Inspection complete',checked:[0,1]})).status,200);
 assert.equal((await developer.call(path+'/transition','POST',{status:'ready'})).status,200);
 assert.equal((await developer.call(path+'/transition','POST',{status:'operational'})).status,200);
 assert.equal((await developer.call(path+'/inspect','POST',{scheduledAt:new Date().toISOString(),checklist:['New inspection']})).status,409);
});
