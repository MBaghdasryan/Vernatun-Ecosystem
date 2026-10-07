import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import sharp from 'sharp';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
import {LocalPrivateStorage,S3CompatibleStorage} from '../storage-providers.js';
import {storedFiles} from '../file-migration.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Isolated database required');
const seed=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const key=(role:string)=>Object.keys(seed.accounts).find(k=>k!=='second_org'&&seed.accounts[k].role===role)!;
const server=app.listen(0,'127.0.0.1');let base:string;
class Client{
 cookie='';csrf='';
 async call(path:string,method='GET',body?:any,binary=false){
  const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':binary?'application/octet-stream':'application/json',Cookie:this.cookie,...(method==='GET'?{}:{'X-CSRF-Token':this.csrf})},...(body===undefined?{}:{body:binary?body:JSON.stringify(body)})});
  if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
  const data=r.headers.get('content-type')?.includes('json')?await r.json():Buffer.from(await r.arrayBuffer());if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data};
 }
 async login(role:string){const a=seed.accounts[key(role)];await this.call('/auth/session');const r=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(r.status,200);if(!r.data.contextId){const c=r.data.contexts.find((c:any)=>c.role_key===role);assert.equal((await this.call('/auth/context','POST',{id:c.id})).status,200)}return this}
}
const clients:Record<string,Client>={};let org:string,bld:string,owner:string,foreign:string,group:any;
before(async()=>{
 if(!server.listening)await new Promise<void>(r=>server.once('listening',r));base='http://127.0.0.1:'+(server.address() as any).port;
 for(const role of ['org_admin','manager','portfolio_owner','unit_owner'])clients[role]=await new Client().login(role);
 const c=(await clients.org_admin.call('/auth/session')).data.contexts.find((c:any)=>c.role_key==='org_admin');org=c.organization_id;
 bld=(await pool.query('SELECT id FROM buildings WHERE organization_id=$1 ORDER BY name LIMIT 1',[org])).rows[0].id;
 owner=seed.accounts[key('unit_owner')].id;
 foreign=(await pool.query('SELECT id FROM buildings WHERE organization_id<>$1 LIMIT 1',[org])).rows[0].id;
});
after(async()=>{await new Promise<void>(r=>server.close(()=>r()));await pool.end()});
test('catalog, preferences CAS, future deliveries, mandatory security and domain hold',async()=>{
 const c=clients.unit_owner,cat=await c.call('/notifications/catalog');assert.equal(cat.status,200);assert.ok(cat.data.events.length>=21);assert.equal(cat.data.channels.email,'pending_domain');
 const p=(await c.call('/notifications/preferences')).data;assert.equal(p.version,0);
 const f={...p,in_app_enabled:false,email_enabled:false,categories:{finance:{email:false}}};
 const saved=await c.call('/notifications/preferences','PUT',f);assert.equal(saved.status,200);assert.equal(saved.data.version,1);
 assert.equal((await c.call('/notifications/preferences','PUT',f)).status,409);
 assert.equal((await c.call('/notifications/preferences','PUT',{...saved.data,categories:{bad:{email:true}}})).status,400);
 await pool.query("SELECT emit_notification($1,$2,'new_charge','invoice',$3,$4)",[owner,org,randomUUID(),'mute-test']);
 let row=(await pool.query('SELECT * FROM notifications WHERE user_id=$1 AND dedupe_key=$2',[owner,'mute-test'])).rows[0];assert.equal(row.in_app_enabled,false);
 assert.equal((await pool.query('SELECT 1 FROM notification_email_outbox WHERE notification_id=$1',[row.id])).rowCount,0);
 await pool.query("SELECT emit_notification($1,$2,'account_security','system',NULL,$3)",[owner,org,'security-test']);
 row=(await pool.query('SELECT * FROM notifications WHERE user_id=$1 AND dedupe_key=$2',[owner,'security-test'])).rows[0];assert.equal(row.in_app_enabled,true);
 assert.equal((await pool.query('SELECT state FROM notification_email_outbox WHERE notification_id=$1',[row.id])).rows[0].state,'pending_domain');
 const list=await c.call('/notifications');assert.ok(list.data.some((n:any)=>n.id===row.id));assert.ok(!list.data.some((n:any)=>n.dedupe_key==='mute-test'));
 assert.equal((await clients.manager.call('/notifications/'+row.id+'/read','POST',{})).status,404);
 assert.equal((await c.call('/notifications/'+row.id+'/read','POST',{})).status,200);
 const dest=await c.call('/notifications/'+row.id+'/destination');assert.equal(dest.status,200);assert.ok(dest.data.destination.endsWith('/settings'));
 assert.equal((await c.call('/notifications/preferences','PUT',{...saved.data,email_enabled:true,in_app_enabled:true,categories:{}})).status,200);
});
test('object CRUD, assignment CAS, foreign-scope rejection, cannot delete populated group',async()=>{
 const a=clients.org_admin;
 assert.equal((await clients.manager.call('/portfolio/objects','POST',{name:'No',kind:'mixed'})).status,403);
 const created=await a.call('/portfolio/objects','POST',{name:'QA complex',kind:'mixed',address:'QA'});assert.equal(created.status,201);group=created.data;
 const bad=await a.call('/portfolio/objects/'+group.id+'/buildings','PUT',{version:group.version,buildingIds:[foreign]});assert.equal(bad.status,404);
 const assigned=await a.call('/portfolio/objects/'+group.id+'/buildings','PUT',{version:group.version,buildingIds:[bld]});assert.equal(assigned.status,200);group=assigned.data;
 assert.equal((await a.call('/portfolio/objects/'+group.id+'/buildings','PUT',{version:1,buildingIds:[]})).status,409);
 assert.equal((await a.call('/portfolio/objects/'+group.id+'?version='+group.version,'DELETE')).status,409);
 const second=await a.call('/portfolio/objects','POST',{name:'QA second',kind:'other'});assert.equal(second.status,201);
 assert.equal((await a.call('/portfolio/objects/'+second.data.id+'/buildings','PUT',{version:1,buildingIds:[bld]})).status,409);
 assert.equal((await a.call('/portfolio/objects/'+second.data.id+'?version=1','DELETE')).status,200);
 const edited=await a.call('/portfolio/objects/'+group.id,'PATCH',{version:group.version,name:'QA renamed',kind:'residential',address:'QA'});assert.equal(edited.status,200);group=edited.data;
 const own=(await clients.portfolio_owner.call('/portfolio/objects')).data.find((g:any)=>g.id===group.id);assert.equal(own.name,'QA renamed');assert.equal(own.buildings[0].id,bld);
});
test('real independent object/building analytics, legacy alias and module gate',async()=>{
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Yerevan'}).format(new Date()),q=`from=${date.slice(0,7)}-01&to=${date}&currency=AMD`;
 const c=clients.portfolio_owner,r=await c.call('/portfolio/analytics?'+q+'&portfolioObjectId='+group.id);assert.equal(r.status,200);
 assert.ok(JSON.stringify(r.data).includes(bld));
 assert.equal((await c.call('/portfolio/analytics?'+q+'&portfolioObjectId='+randomUUID())).status,404);
 assert.equal((await c.call('/portfolio/analytics?'+q+'&propertyId='+bld)).status,200);
 await pool.query("UPDATE module_entitlements SET enabled=false WHERE organization_id=$1 AND module='finance'",[org]);
 assert.equal((await c.call('/portfolio/analytics?'+q+'&portfolioObjectId='+group.id)).status,403);
 await pool.query("UPDATE module_entitlements SET enabled=true WHERE organization_id=$1 AND module='finance'",[org]);
});
test('brand metadata CAS, hostile URLs, sanitized private logo, inventory and remove-reference-only',async()=>{
 const a=clients.org_admin,current=await a.call('/organization/branding');assert.equal(current.status,200);
 assert.equal((await clients.manager.call('/organization/branding','PUT',{version:0,branding:{brand_name:'No'}})).status,403);
 assert.equal((await a.call('/organization/branding','PUT',{version:0,branding:{website_url:'javascript:alert(1)'}})).status,400);
 assert.equal((await a.call('/organization/branding','PUT',{version:0,branding:{logo_key:randomUUID()}})).status,400);
 let r=await a.call('/organization/branding','PUT',{version:0,branding:{brand_name:'QA white label',primary_color:'#123456',privacy_url:'https://example.com/privacy'}});assert.equal(r.status,200);
 assert.equal((await a.call('/organization/branding','PUT',{version:0,branding:{}})).status,409);
 const image=await sharp({create:{width:24,height:24,channels:3,background:'#123456'}}).png().toBuffer();
 r=await a.call('/organization/branding/logo?version='+r.data.version,'POST',image,true);assert.equal(r.status,200);const logo=r.data.branding.logo_key;
 const bytes=await clients.unit_owner.call('/organizations/'+org+'/branding/logo?key='+logo);assert.equal(bytes.status,200);assert.equal((await sharp(bytes.data).metadata()).format,'jpeg');
 assert.ok((await storedFiles()).some(f=>f.kind==='photos'&&f.key===logo));
 assert.equal((await a.call('/organization/branding/logo?version='+r.data.version,'POST',Buffer.from('<svg/>'),true)).status,400);
 assert.equal((await a.call('/organization/branding/logo?version='+r.data.version,'DELETE')).status,200);
 assert.equal((await clients.unit_owner.call('/organizations/'+org+'/branding/logo?key='+logo)).status,404);
 assert.equal((await clients.manager.call('/storage/status')).data.mode,'app_storage');
});
test('community notifications reach unit residents; idempotent emission and denied foreign links',async()=>{
 const m=(await pool.query('INSERT INTO meetings(organization_id,building_id,title,starts_at,ends_at,created_by) VALUES($1,$2,$3,now()+interval \'1 day\',now()+interval \'2 days\',$4) RETURNING id',[org,bld,'QA meeting',seed.accounts[key('manager')].id])).rows[0];
 const unitB=(await pool.query('SELECT building_id FROM role_assignments WHERE user_id=$1 AND role_key=$2 AND organization_id=$3',[owner,'unit_owner',org])).rows[0].building_id;
 await pool.query('SELECT notify_audience($1,$2,NULL,$3,$4,$5,$6,ARRAY[\'meetings.read\'])',[org,unitB,'meeting_created','meeting',m.id,'audience-test']);
 const n=(await pool.query("SELECT * FROM notifications WHERE user_id=$1 AND dedupe_key='audience-test'",[owner])).rows[0];assert.ok(n);
 await pool.query("SELECT emit_notification($1,$2,'meeting_created','meeting',$3,'audience-test')",[owner,org,m.id]);assert.equal((await pool.query("SELECT count(*)::int AS count FROM notifications WHERE user_id=$1 AND dedupe_key='audience-test'",[owner])).rows[0].count,1);
 await pool.query("SELECT emit_notification($1,(SELECT organization_id FROM buildings WHERE id=$2),'meeting_created','meeting',$3,'foreign-link')",[owner,foreign,m.id]);
 const id=(await pool.query("SELECT id FROM notifications WHERE user_id=$1 AND dedupe_key='foreign-link'",[owner])).rows[0].id;
 assert.equal((await clients.unit_owner.call('/notifications/'+id+'/destination')).status,403);
});
test('empty object delete requires explicit unlink and leaves original buildings/units',async()=>{
 const a=clients.org_admin,n=(await pool.query('SELECT count(*)::int n FROM units WHERE building_id=$1',[bld])).rows[0].n;
 const unlinked=await a.call('/portfolio/objects/'+group.id+'/buildings','PUT',{version:group.version,buildingIds:[]});assert.equal(unlinked.status,200);
 assert.equal((await a.call('/portfolio/objects/'+group.id+'?version='+unlinked.data.version,'DELETE')).status,200);
 assert.equal((await pool.query('SELECT count(*)::int n FROM units WHERE building_id=$1',[bld])).rows[0].n,n);
 assert.equal((await pool.query('SELECT portfolio_object_id FROM buildings WHERE id=$1',[bld])).rows[0].portfolio_object_id,null);
});
test('reminder sweep includes overdue onboarding, is idempotent and keeps email on hold',async()=>{
 assert.equal((await clients.unit_owner.call('/notifications/due','POST',{})).status,403);
 await pool.query("UPDATE onboarding_steps SET due_on=now()::date-1,status='pending',completed_at=NULL,assigned_to=$2 WHERE organization_id=$1",[org,seed.accounts[key('org_admin')].id]);
 const a=await clients.org_admin.call('/notifications/due','POST',{});assert.equal(a.status,200);assert.equal(a.data.email,'pending_domain');
 const before=(await pool.query("SELECT count(*)::int n FROM notifications WHERE kind IN ('pass_expiring','lease_expiring','voting_ending','onboarding_task_due')")).rows[0].n;
 assert.equal((await clients.org_admin.call('/notifications/due','POST',{})).status,200);
 assert.equal((await pool.query("SELECT count(*)::int n FROM notifications WHERE kind IN ('pass_expiring','lease_expiring','voting_ending','onboarding_task_due')")).rows[0].n,before);
 assert.ok((await pool.query("SELECT 1 FROM notifications WHERE kind='onboarding_task_due'")).rowCount!>0);
 assert.equal((await pool.query("SELECT notification_event_alias('sla.response.approaching') AS code")).rows[0].code,'SLA_warning');
});
test('Local immutable provider and S3 conditional-write contract without live S3 credentials',async()=>{
 const dir=await mkdtemp(tmpdir()+'/vernatun-local-');try{const p=new LocalPrivateStorage(dir),id=randomUUID(),b=Buffer.from('safe');
 await p.save('documents',id,b,'application/pdf');assert.deepEqual(await p.read('documents',id),b);await assert.rejects(p.save('documents',id,b,'application/pdf'));assert.equal(await p.exists('documents',id),true);
 assert.equal((await p.metadata('documents',id)).size,'4');await assert.rejects(p.read('documents','../escape'));await assert.rejects(p.deleteVersion('documents',id,'x','x'));await p.delete('documents',id);
 const s=new S3CompatibleStorage({endpoint:'https://example.invalid',region:'test',bucket:'test',accessKey:'not-real',secretKey:'not-real',prefix:'qa'});let input:any;
 (s as any).client.send=async(c:any)=>{input=c.input;return {}};
 await s.save('documents',id,b,'application/pdf');assert.equal(input.IfNoneMatch,'*');assert.equal(input.CacheControl,'private, no-store');
 await assert.rejects(s.deleteVersion('documents',id,'x','x'));}finally{await rm(dir,{recursive:true,force:true})}
});
test('service worker ignores all API/private/query URLs, including warm list',async()=>{
 const code=await readFile('../../../vernatun/public/hayat-sw.js','utf8');
 const handlers:Record<string,any>={};
 const env={URL,Response,console,self:{registration:{scope:'https://app.test/'},addEventListener:(n:string,h:any)=>handlers[n]=h}};
 vm.runInNewContext(code,env);
 for(const url of ['/api/auth/session','/api/organization/branding','/api/documents/x','/private-photo/x','/financial.json','/assets/app.js?token=x','https://other.test/assets/app.js']){
  let caught=false;handlers.fetch({request:{method:'GET',url:new URL(url,'https://app.test').href,mode:'cors'},respondWith:()=>caught=true});assert.equal(caught,false,url);
 }
});
