import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';

if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Isolated test database required');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const server=app.listen(0,'127.0.0.1');let base='';
class Client{
 cookie='';csrf='';context='';user='';
 async call(path:string,method='GET',body?:unknown,headers:Record<string,string>={}){
  const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:this.cookie,
   ...(method==='GET'?{}:{'X-CSRF-Token':this.csrf}),...headers},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
  const data=r.status===204?null:await r.json();if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data};
 }
 async login(key:string){
  const a=seeded.accounts[key];await this.call('/auth/session');
  let r=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(r.status,200);
  if(!r.data.contextId){await this.call('/auth/context','POST',{id:r.data.contexts.find((c:any)=>c.role_key===a.role).id});r=await this.call('/auth/session')}
  this.context=r.data.contextId;this.user=r.data.user.id;return this;
 }
 headers(){return {'X-Hayat-User':this.user,'X-Hayat-Context':this.context}}
 async photo(kind:string,id:string,body:Buffer,key:string,version:number,headers={}){
  const r=await fetch(base+`/api/${kind}/${id}/photos`,{method:'POST',headers:{
   Cookie:this.cookie,'X-CSRF-Token':this.csrf,'Content-Type':'application/octet-stream',
   'X-Operation-Key':key,'X-Work-Version':String(version),...this.headers(),...headers},body});
  return {status:r.status,data:await r.json()};
 }
}
let owner:Client,dispatcher:Client,tech:Client,manager:Client,developer:Client,contractor:Client;
before(async()=>{
 await new Promise<void>(r=>server.listening?r():server.on('listening',r));
 base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 await pool.query('DELETE FROM auth_rate_limits');
 owner=await new Client().login('unit_owner');dispatcher=await new Client().login('dispatcher');
 tech=await new Client().login('technician');manager=await new Client().login('manager');
 developer=await new Client().login('developer');contractor=await new Client().login('contractor');
});
after(async()=>{server.close();server.closeAllConnections();await pool.end()});

test('queued request report/photos are replay-safe, versioned, account-bound and revoked access cannot replay',async()=>{
 const created=await owner.call('/requests','POST',{unitId:seeded.fixtures.ua,subject:'Isolated offline request',description:'Offline integration'});
 assert.equal(created.status,201);const id=created.data.id;
 const step=(c:Client,body:unknown,headers=c.headers())=>c.call(`/requests/${id}/transition`,'POST',body,headers);
 assert.equal((await step(dispatcher,{action:'assign',version:1,technicianId:tech.user,checklist:[{text:'Inspect',done:false}]})).status,200);
 const start={key:randomUUID(),action:'start',version:2,note:''};
 assert.equal((await step(tech,start)).status,200);
 assert.equal((await step(tech,start)).status,200);
 const image=await sharp({create:{width:4,height:4,channels:3,background:'#ff680a'}}).png().toBuffer();
 const photoKey=randomUUID();
 const first=await tech.photo('requests',id,image,photoKey,3);
 assert.equal(first.status,201);
 const second=await tech.photo('requests',id,image,photoKey,3);
 assert.equal(second.status,201);assert.equal(second.data.id,first.data.id);
 assert.equal((await tech.photo('requests',id,Buffer.from('different bytes'),photoKey,3)).status,409);
 assert.equal((await tech.photo('requests',id,image,randomUUID(),2)).status,409);
 assert.equal((await tech.photo('requests',id,image,randomUUID(),3,{'X-Hayat-User':owner.user})).status,403);
 assert.equal((await tech.photo('requests',id,image,randomUUID(),3,{'X-Hayat-Context':owner.context})).status,403);
 assert.equal(Number((await pool.query('SELECT count(*) FROM request_photos WHERE request_id=$1',[id])).rows[0].count),1);
 const report={key:randomUUID(),action:'report',version:3,note:'Completed offline repair',checklist:[{text:'Inspect',done:true}]};
 const result=await step(tech,report);assert.equal(result.status,200);
 assert.deepEqual((await step(tech,report)).data,result.data);
 assert.equal((await step(tech,{...report,note:'Changed immutable payload'})).status,409);
 assert.equal((await step(tech,{...report,key:randomUUID()})).data.error,'stale_version');
 assert.equal(Number((await pool.query('SELECT count(*) FROM work_reports WHERE work_order_id=(SELECT id FROM work_orders WHERE request_id=$1)',[id])).rows[0].count),1);
 assert.equal((await step(owner,report,tech.headers())).status,403);
 // A lost response may be retried after another actor has changed the version.
 assert.equal((await step(manager,{action:'reject',version:4,note:'Inspect once more'})).status,200);
 assert.equal((await step(tech,report)).status,200);
 assert.deepEqual((await tech.photo('requests',id,image,photoKey,3)).data,first.data);
 try{
  await pool.query('UPDATE role_assignments SET active=false WHERE id=$1',[tech.context]);
  assert.equal((await step(tech,report)).status,403);
  assert.equal((await tech.photo('requests',id,image,photoKey,3)).status,403);
 }finally{await pool.query('UPDATE role_assignments SET active=true WHERE id=$1',[tech.context])}
});

test('contractor start/report and defect photos reuse receipts without duplicate files/history',async()=>{
 const created=await developer.call('/defects','POST',{unitId:seeded.fixtures.ua,subject:'Isolated offline defect',location:'Hall',description:'Offline test',contractorId:contractor.user,dueOn:'2026-12-01'});
 assert.equal(created.status,201);const id=created.data.id;
 const step=(body:unknown)=>contractor.call(`/defects/${id}/transition`,'POST',body,contractor.headers());
 const start={key:randomUUID(),action:'start',version:1,note:''};
 assert.equal((await step(start)).status,200);assert.equal((await step(start)).status,200);
 const image=await sharp({create:{width:4,height:4,channels:3,background:'#ff680a'}}).png().toBuffer();
 const key=randomUUID(),first=await contractor.photo('defects',id,image,key,2);
 assert.equal(first.status,201);assert.deepEqual((await contractor.photo('defects',id,image,key,2)).data,first.data);
 const report={key:randomUUID(),action:'report',version:2,note:'Defect repaired offline'};
 const result=await step(report);assert.equal(result.status,200);assert.deepEqual((await step(report)).data,result.data);
 assert.equal((await step({...report,key:randomUUID()})).data.error,'stale_version');
 assert.equal(Number((await pool.query('SELECT count(*) FROM defect_history WHERE defect_id=$1',[id])).rows[0].count),2);
 assert.equal(Number((await pool.query('SELECT count(*) FROM file_attachments WHERE defect_id=$1',[id])).rows[0].count),1);
});
