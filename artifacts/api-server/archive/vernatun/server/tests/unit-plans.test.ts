import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw Error('Isolated database required');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const server=app.listen(0,'127.0.0.1');let base='',dev:Client,contractor:Client,unit:string,defectId:string,plan:any,image:Buffer;
class Client{
 cookie='';csrf='';
 async call(path:string,method='GET',body?:unknown,binary=false){
  const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':binary?'application/octet-stream':'application/json',Cookie:this.cookie,'X-CSRF-Token':this.csrf},
   ...(body===undefined?{}:{body:binary?body as any:JSON.stringify(body)})});
  if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  const data=(r.headers.get('content-type')??'').includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer());
  if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data,headers:r.headers};
 }
 async login(name:string){
  const a=seeded.accounts[name];await this.call('/auth/session');
  const r=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(r.status,200);
  assert.equal((await this.call('/auth/context','POST',{id:r.data.contexts.find((c:any)=>c.role_key===a.role).id})).status,200);return this;
 }
}
const path=()=>'/unit-plans/'+unit;
const upload=(key=randomUUID(),extra:any={})=>path()+'/image?'+new URLSearchParams({key,revision:String(plan?.revision??0),...(plan?{planId:plan.id}:{}),...extra});
const change=(extra:any={})=>({key:randomUUID(),planId:plan.id,revision:plan.revision,action:'mark',defectId,x:.25,y:.75,...extra});
before(async()=>{
 await pool.query('DELETE FROM auth_rate_limits');
 await new Promise<void>(r=>server.listening?r():server.on('listening',r));base='http://127.0.0.1:'+(server.address() as any).port;
 dev=await new Client().login('developer');contractor=await new Client().login('contractor');
 const d=(await dev.call('/defects')).data[0];unit=d.unit_id;defectId=d.id;
 image=await sharp({create:{width:600,height:400,channels:3,background:'#d9e7e9'}}).png().toBuffer();
});
after(async()=>{server.close();server.closeAllConnections();await pool.end()});
test('image upload is sanitized, private, persistent and idempotent',async()=>{
 const initial=await dev.call(path());assert.equal(initial.status,200);assert.equal(initial.data.plan,null);
 const url=upload(),a=await dev.call(url,'POST',image,true);assert.equal(a.status,201);plan=a.data;
 const again=await dev.call(url,'POST',image,true);assert.equal(again.data.id,plan.id);
 assert.equal((await dev.call(path())).data.plan.id,plan.id);
 const bytes=await dev.call(path()+'/'+plan.id+'/image');
 assert.equal(bytes.status,200);assert.equal(bytes.headers.get('content-type'),'image/jpeg');
 assert.equal(bytes.headers.get('cache-control'),'private, no-store');
 assert.equal((await sharp(bytes.data).metadata()).format,'jpeg');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM unit_plans WHERE unit_id=$1',[unit])).rows[0].n,1);
});
test('marker create, move, remove; CAS and idempotency preserve workflow',async()=>{
 const before=(await pool.query('SELECT status,version FROM defects WHERE id=$1',[defectId])).rows[0];
 const b=change(),a=await dev.call(path(),'POST',b);assert.equal(a.status,200);
 assert.equal((await dev.call(path(),'POST',b)).data.revision,a.data.revision);
 assert.equal((await dev.call(path(),'POST',change())).status,409);plan=a.data;
 assert.deepEqual((await dev.call(path())).data.plan.markers,[{defectId,x:.25,y:.75}]);
 const moved=await dev.call(path(),'POST',change({x:0,y:1}));assert.equal(moved.status,200);plan=moved.data;
 const removed=await dev.call(path(),'POST',change({action:'unmark'}));assert.equal(removed.status,200);plan=removed.data;
 assert.equal((await dev.call(path())).data.plan.markers.length,0);
 assert.deepEqual((await pool.query('SELECT status,version FROM defects WHERE id=$1',[defectId])).rows[0],before);
});
test('reject coordinates, foreign defects, invalid files, missing CSRF and unauthorized readers',async()=>{
 assert.equal((await dev.call(path(),'POST',change({x:1.01}))).status,400);
 assert.equal((await dev.call(path(),'POST',change({defectId:randomUUID()}))).status,404);
 assert.equal((await dev.call(upload(),'POST',Buffer.from('%PDF-1.7'),true)).status,400);
 assert.equal((await dev.call(upload(),'POST',Buffer.from('invalid'),true)).status,400);
 const csrf=dev.csrf;dev.csrf='';
 try{assert.equal((await dev.call(path(),'POST',change())).status,403)}finally{dev.csrf=csrf}
 assert.equal((await contractor.call(path())).status,403);
 assert.equal((await contractor.call(path()+'/'+plan.id+'/image')).status,403);
 assert.equal((await contractor.call(path(),'POST',change())).status,403);
 const other=(await pool.query('SELECT id FROM units WHERE organization_id<>(SELECT organization_id FROM units WHERE id=$1) LIMIT 1',[unit])).rows[0];
 assert.ok(other);assert.equal((await dev.call('/unit-plans/'+other.id)).status,404);
});
test('concurrent changes have one winner, replacement retires old markers, removal preserves bytes',async()=>{
 const results=await Promise.all(Array.from({length:4},(_,i)=>dev.call(path(),'POST',change({x:i/4}))));
 assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,3);
 plan=results.find(r=>r.status===200)!.data;const old=plan.id;
 const next=await dev.call(upload(),'POST',image,true);assert.equal(next.status,201);plan=next.data;
 assert.notEqual(plan.id,old);assert.equal((await dev.call(path())).data.plan.markers.length,0);
 assert.equal((await dev.call(path()+'/'+old+'/image')).status,404);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM defect_plan_markers WHERE plan_id=$1',[old])).rows[0].n,1);
 const removed=await dev.call(path(),'POST',change({action:'remove'}));assert.equal(removed.status,200);
 assert.equal((await dev.call(path())).data.plan,null);
 assert.equal((await dev.call(path()+'/'+plan.id+'/image')).status,404);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM unit_plans WHERE unit_id=$1',[unit])).rows[0].n,2);
 const events=(await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'unit_plan.%'")).rows[0].n;
 assert.ok(events>=7);
});
