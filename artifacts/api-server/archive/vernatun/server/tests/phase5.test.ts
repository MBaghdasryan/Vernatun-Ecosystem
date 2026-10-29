import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
import {contexts} from '../access.js';
import {sharedDocument} from '../support-conversation.js';
import {transaction} from '../operations.js';
import {privateKeyPattern} from '../private-files.js';
import {assertOpenApiOperation,openApiSpec} from './openapi-contract-assertions.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Isolated database required');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const account=(role:string)=>Object.keys(seeded.accounts).find(k=>k!=='second_org'&&seeded.accounts[k].role===role)!;
const server=app.listen(0,'127.0.0.1');let base:string;
class Client{
 cookie='';csrf='';
 async call(path:string,method='GET',body?:unknown){
  const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:this.cookie,...(method==='GET'?{}:{'X-CSRF-Token':this.csrf})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
  const data=r.status===204?null:await r.json();if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data};
 }
 async login(key:string){
  const a=seeded.accounts[key],initial=await this.call('/auth/session');const r=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(r.status,200,JSON.stringify({response:r.data,initialStatus:initial.status,csrfLength:this.csrf.length,hasCookie:!!this.cookie}));
  if(!r.data.contextId){const c=r.data.contexts.find((c:any)=>c.role_key===a.role);assert.equal((await this.call('/auth/context','POST',{id:c.id})).status,200)}return this;
 }
}
let admin:Client,orgAdmin:Client,support:Client,accountant:Client,owner:Client,foreign:Client,org:string,building:string,caseId:string,unit:string,residentUnit:string;
let ownerAssignment:string;
before(async()=>{
 await pool.query('DELETE FROM auth_rate_limits');
 await new Promise<void>(r=>server.listening?r():server.on('listening',r));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 admin=await new Client().login(account('platform_admin'));orgAdmin=await new Client().login(account('org_admin'));support=await new Client().login(account('support'));
 accountant=await new Client().login('accountant');owner=await new Client().login('unit_owner');foreign=await new Client().login('second_org');
 const fixture=(await pool.query('SELECT organization_id,building_id FROM units WHERE id=$1',[seeded.fixtures.ua])).rows[0];org=fixture.organization_id;building=fixture.building_id;
});
after(async()=>{await new Promise<void>(r=>server.close(()=>r()));await pool.end()});
test('Session, context switching and role editing publish validated contracts',()=>{
 assertOpenApiOperation('/auth/session','get',{responseStatus:'200',responseSchema:'SessionState'});
 assertOpenApiOperation('/auth/login','post',{responseStatus:'200',responseSchema:'SessionState'});
 assertOpenApiOperation('/auth/context','post',{responseStatus:'200'});
 assertOpenApiOperation('/people','get',{responseStatus:'200'});
 assertOpenApiOperation('/roles/{id}','get',{responseStatus:'200'});
 assertOpenApiOperation('/roles/{id}','patch',{requestSchema:'RoleAssignmentUpdate',responseStatus:'200'});
 assertOpenApiOperation('/roles/{id}/options','get',{responseStatus:'200'});
 const loginSchema=openApiSpec().paths['/auth/login'].post.requestBody.content['application/json'].schema;
 assert.deepEqual(loginSchema.required,['email','password']);
 assert.equal(loginSchema.properties.code.minLength,6);assert.equal(loginSchema.properties.code.maxLength,30);
 const assignmentSchema=openApiSpec().paths['/roles/{id}'].get.responses['200'].content['application/json'].schema;
 assert.equal(assignmentSchema.properties.assignment.$ref,'#/components/schemas/RoleAssignmentRecord');
 const contextBody=openApiSpec().paths['/auth/context'].post.requestBody.content['application/json'].schema;
 assert.equal(contextBody.$ref,'#/components/schemas/ContextSwitch');
 const body=openApiSpec().components.schemas.ContextSwitch;
 assert.deepEqual(body.required,['id']);assert.equal(body.properties.id.format,'uuid');
 const versionPattern=new RegExp(openApiSpec().components.schemas.RoleAssignmentUpdate.properties.version.pattern);
 assert.equal(versionPattern.test('42'),true);assert.equal(versionPattern.test('42x'),false);
});
test('Organization card/profile has optimistic concurrency; suspension/archive revoke contexts without deleting history',async()=>{
 const made=await admin.call('/organizations','POST',{name:'Phase5 isolated organization',currency:'AMD'});assert.equal(made.status,201);const id=made.data.id;
 await pool.query('INSERT INTO memberships(user_id,organization_id) VALUES($1,$2)',[seeded.accounts[account('org_admin')].id,id]);
 const assignment=(await pool.query("INSERT INTO role_assignments(user_id,organization_id,role_key) VALUES($1,$2,'org_admin') RETURNING id",[seeded.accounts[account('org_admin')].id,id])).rows[0].id;
 const card=(await admin.call('/platform/organizations/'+id)).data;assert.equal(card.status,'active');assert.equal(card.users.length,1);assert.ok(card.modules.length);assert.ok('onboarding' in card&&'audit' in card&&'policy' in card);
  const body={key:randomUUID(),version:1,name:'Phase5 client',companyType:'management_company',legalName:'Legal QA',taxId:'QA',address:'QA address',contactEmail:'',contactPhone:'',timezone:'Asia/Yerevan',currency:'AMD',defaultLanguage:'ru'};
 const changed=await admin.call('/platform/organizations/'+id,'PATCH',body);assert.equal(changed.status,200);assert.equal(changed.data.version,2);
 assert.equal((await admin.call('/platform/organizations/'+id,'PATCH',body)).status,200);
 assert.equal((await admin.call('/platform/organizations/'+id,'PATCH',{...body,key:randomUUID()})).status,409);
 assert.equal((await admin.call('/platform/organizations/'+id,'PATCH',{...body,key:randomUUID(),version:2,timezone:'Invalid/Zone'})).status,400);
 assert.equal((await orgAdmin.call('/auth/context','POST',{id:assignment})).status,200);
 const oldCounts=(await pool.query('SELECT (SELECT count(*) FROM memberships WHERE organization_id=$1)::int AS members,(SELECT count(*) FROM module_entitlements WHERE organization_id=$1)::int AS modules',[id])).rows[0];
 for(const [n,status] of ['suspended','archived','active'].entries()){
  assert.equal((await admin.call('/platform/organizations/'+id+'/state','POST',{key:randomUUID(),version:n+2,status,reason:'Isolated lifecycle verification'})).status,200);
  const contexts=(await orgAdmin.call('/auth/session')).data.contexts;assert.equal(contexts.some((c:any)=>c.id===assignment),status==='active');
  if(status!=='active')assert.equal((await orgAdmin.call('/properties')).status,403);
 }
 assert.deepEqual((await pool.query('SELECT (SELECT count(*) FROM memberships WHERE organization_id=$1)::int AS members,(SELECT count(*) FROM module_entitlements WHERE organization_id=$1)::int AS modules',[id])).rows[0],oldCounts);
 const original=(await orgAdmin.call('/auth/session')).data.contexts.find((c:any)=>c.organization_id===org&&c.role_key==='org_admin');
 assert.equal((await orgAdmin.call('/auth/context','POST',{id:original.id})).status,200);
 assert.equal((await owner.call('/platform/organizations/'+org)).status,403);
});
test('Platform organization creation stores company profile and selected modules; date filter and CSV export are scoped',async()=>{
 const tag=randomUUID(),body={key:tag,companyType:'developer',name:'Organization export QA '+tag,legalName:'QA Legal '+tag,taxId:'QA-058',address:'Yerevan',contactEmail:'qa@example.test',contactPhone:'+37400000000',timezone:'Asia/Yerevan',currency:'AMD',defaultLanguage:'ru',modules:['requests','smart_building']};
 const created=await admin.call('/organizations','POST',body);assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(created.data.company_type,'developer');assert.equal(created.data.legal_name,body.legalName);
 const again=await admin.call('/organizations','POST',body);assert.equal(again.status,201);assert.equal(again.data.id,created.data.id);
 const modules=(await pool.query('SELECT module,enabled FROM module_entitlements WHERE organization_id=$1 ORDER BY module',[created.data.id])).rows;
 assert.equal(modules.find((m:any)=>m.module==='requests').enabled,true);assert.equal(modules.find((m:any)=>m.module==='smart_building').enabled,true);assert.equal(modules.find((m:any)=>m.module==='finance').enabled,false);
 const day=(await pool.query("SELECT (created_at AT TIME ZONE 'Asia/Yerevan')::date::text AS day FROM organizations WHERE id=$1",[created.data.id])).rows[0].day;
 const filtered=await admin.call('/paged/organizations?createdFrom='+day+'&createdTo='+day+'&q='+encodeURIComponent(tag));assert.equal(filtered.status,200);assert.ok(filtered.data.rows.some((r:any)=>r.id===created.data.id));
 const outside=await admin.call('/paged/organizations?createdFrom=2099-01-01');assert.equal(outside.status,200);assert.equal(outside.data.total,0);
 const exported=await fetch(base+'/api/platform/organizations/export.csv?createdFrom='+day+'&createdTo='+day+'&q='+encodeURIComponent(tag),{headers:{Cookie:admin.cookie}});assert.equal(exported.status,200);const csv=await exported.text();assert.ok(csv.includes(body.legalName));assert.ok(csv.includes('smart_building'));
 assert.equal((await orgAdmin.call('/platform/organizations/export.csv')).status,403);
 assert.equal((await admin.call('/organizations','POST',{...body,key:randomUUID(),companyType:'other'})).status,400);
});
test('Support queue/conversation is append-only, internal-private, tenant scoped, versioned and idempotent',async()=>{
 const b={key:randomUUID(),subject:'Phase5 support conversation',body:'Original public message',priority:'urgent',category:'technical'};
 const created=await orgAdmin.call('/platform/support-cases','POST',b);assert.equal(created.status,201);caseId=created.data.id;assert.equal(created.data.assigned_to,null);assert.ok(created.data.sla_due_at);
 assert.equal((await orgAdmin.call('/platform/support-cases','POST',b)).data.id,caseId);
 const queue=(await support.call('/platform/support-cases?queue=unassigned')).data;assert.ok(queue.some((r:any)=>r.id===caseId));
 assert.equal((await support.call('/platform/support-cases/'+caseId+'/messages','POST',{key:randomUUID(),version:1,body:'Not assigned'})).status,403);
 assert.equal((await support.call('/platform/support-cases/'+caseId+'/change','POST',{key:randomUUID(),version:1,assigneeId:seeded.accounts[account('support')].id})).status,403);
 assert.equal((await admin.call('/platform/support-cases/'+caseId+'/change','POST',{key:randomUUID(),version:1,assigneeId:seeded.accounts[account('support')].id})).status,200);
 const note={key:randomUUID(),version:2,body:'Private operational note',internal:true};
 assert.equal((await support.call('/platform/support-cases/'+caseId+'/messages','POST',note)).status,201);
 assert.equal((await support.call('/platform/support-cases/'+caseId+'/messages','POST',note)).status,201);
 const publicView=(await orgAdmin.call('/platform/support-cases/'+caseId)).data;assert.equal(publicView.messages.length,1);assert.ok(!JSON.stringify(publicView).includes(note.body));
 assert.equal((await support.call('/platform/support-cases/'+caseId)).data.messages.length,2);
 assert.equal((await orgAdmin.call('/platform/support-cases/'+caseId+'/messages','POST',{key:randomUUID(),version:3,body:'Customer cannot create internal notes',internal:true})).status,403);
 assert.equal((await foreign.call('/platform/support-cases/'+caseId)).status,404);
 assert.equal((await orgAdmin.call('/platform/support-cases/'+caseId+'/messages','POST',{key:randomUUID(),version:3,body:'Public customer reply'})).status,201);
 await assert.rejects(pool.query('UPDATE support_messages SET body=$2 WHERE case_id=$1',[caseId,'Changed history']));
 assert.equal((await pool.query('SELECT body,reply FROM support_cases WHERE id=$1',[caseId])).rows[0].body,b.body);
});
test('Support resolution/reopen, priority SLA, staff assignment ACL and legacy reply retain conversation history',async()=>{
 const detail=(await support.call('/platform/support-cases/'+caseId)).data;
 assert.equal((await support.call('/platform/support-cases/'+caseId+'/change','POST',{key:randomUUID(),version:detail.version,status:'resolved',priority:'high'})).status,200);
 const resolved=(await orgAdmin.call('/platform/support-cases/'+caseId)).data;assert.ok(resolved.resolved_at);
 assert.equal((await orgAdmin.call('/platform/support-cases/'+caseId+'/messages','POST',{key:randomUUID(),version:resolved.version,body:'Cannot reply until reopened'})).status,409);
 assert.equal((await admin.call('/platform/support-cases/'+caseId+'/change','POST',{key:randomUUID(),version:resolved.version,status:'open'})).status,200);
 assert.equal((await support.call('/support-cases/'+caseId+'/reply','POST',{reply:'Legacy compatible public reply',status:'in_progress'})).status,200);
 const newer=(await orgAdmin.call('/platform/support-cases/'+caseId)).data;assert.equal(newer.messages.length,3);assert.equal(newer.reply,'');
 assert.equal((await orgAdmin.call('/platform/support-cases/'+caseId+'/change','POST',{key:randomUUID(),version:newer.version,status:'resolved'})).status,403);
 const op=await admin.call('/platform/operators');assert.equal(op.status,200);assert.ok(op.data.some((o:any)=>o.id===seeded.accounts[account('support')].id));
 const legacy=await orgAdmin.call('/support-cases','POST',{subject:'Legacy caller',body:'Initial message from legacy caller'});assert.equal(legacy.status,201);
 const history=await orgAdmin.call('/platform/support-cases/'+legacy.data.id);assert.equal(history.data.messages[0].body,'Initial message from legacy caller');assert.ok(history.data.sla_due_at);
 assert.equal((await support.call('/support-cases/'+legacy.data.id+'/reply','POST',{reply:'Resolve legacy case',status:'resolved'})).status,200);
 assert.equal((await support.call('/support-cases/'+legacy.data.id+'/reply','POST',{reply:'Must explicitly reopen',status:'in_progress'})).status,409);
});
test('Case attachments require original document rights and explicit sharing; assigned case access is not blanket file access',async()=>{
 const storageKey=randomUUID();assert.ok(privateKeyPattern.test(storageKey));
 const doc=(await pool.query("INSERT INTO documents(organization_id,building_id,title,visibility,storage_key,media_type,uploaded_by) VALUES($1,$2,'QA attachment','staff',$3,'application/pdf',$4) RETURNING id",[org,building,storageKey,seeded.accounts[account('org_admin')].id])).rows[0];
 const created=await orgAdmin.call('/platform/support-cases','POST',{key:randomUUID(),subject:'Shared QA evidence',body:'Share only this selected document',attachmentIds:[doc.id]});assert.equal(created.status,201);
 const id=created.data.id,supportId=seeded.accounts[account('support')].id,customerId=seeded.accounts[account('org_admin')].id;
 const staffContext=(await contexts(supportId)).find(c=>c.organization_id===null)!;
 assert.equal((await support.call('/platform/support-cases/'+id+'/attachments/'+doc.id)).status,403);
 assert.equal((await foreign.call('/platform/support-cases/'+id+'/attachments/'+doc.id)).status,404);
 assert.equal((await admin.call('/platform/support-cases/'+id+'/change','POST',{key:randomUUID(),version:1,assigneeId:supportId})).status,200);
 assert.equal((await transaction(db=>sharedDocument(db,staffContext,id,doc.id,supportId))).id,doc.id);
 await assert.rejects(transaction(db=>sharedDocument(db,staffContext,id,randomUUID(),supportId)),(e:any)=>e.code==='attachment_not_found');
 assert.equal((await support.call('/documents/'+doc.id+'/download')).status,403);
 const customerContext=(await contexts(customerId)).find(c=>c.organization_id===org)!;
 assert.equal((await transaction(db=>sharedDocument(db,customerContext,id,doc.id,customerId))).id,doc.id);
 // Metadata-only fixture: no private file bytes created/read and no keys returned by API.
 assert.ok(!(JSON.stringify((await orgAdmin.call('/platform/support-cases/'+id)).data)).includes('storage_key'));
});
async function step(title:string,order:number,deps:string[]=[]){
 const r=await admin.call('/platform/onboarding','POST',{key:randomUUID(),organizationId:org,title,category:'registry',assigneeId:seeded.accounts[account('support')].id,dueOn:'2026-11-01',order,dependencies:deps,notes:'QA notes'});assert.equal(r.status,201);return r.data;
}
async function changeStep(id:string,action:string,extras={}){
 const s=(await admin.call('/platform/onboarding/'+id)).data;return admin.call('/platform/onboarding/'+id+'/change','POST',{key:randomUUID(),version:s.version,action,...extras});
}
test('Onboarding enforces order/dependencies, blocks legacy bypass and preserves immutable reopen/cascade history',async()=>{
 const a=await step('P5 organization setup',10),b=await step('P5 registry',20,[a.id]),c=await step('P5 training',30,[b.id]);
 assert.equal((await changeStep(b.id,'start')).status,409);
 assert.equal((await support.call('/onboarding/'+b.id+'/complete','POST',{})).status,409);
 assert.equal((await changeStep(a.id,'edit',{dependencies:[c.id]})).status,400);
 assert.equal((await changeStep(a.id,'complete')).status,200);
 assert.equal((await changeStep(b.id,'start')).status,200);assert.equal((await changeStep(b.id,'complete')).status,200);
 assert.equal((await changeStep(c.id,'start')).status,200);
 assert.equal((await changeStep(a.id,'reopen',{reason:'Dependencies changed'})).status,409);
 assert.equal((await changeStep(a.id,'reopen',{reason:'Dependencies changed',reopenDependents:true})).status,200);
 for(const id of [a.id,b.id,c.id])assert.equal((await admin.call('/platform/onboarding/'+id)).data.status,'pending');
 const history=(await admin.call('/platform/onboarding/'+b.id)).data.events;assert.ok(history.some((e:any)=>e.action==='dependent_reopen'));
 await assert.rejects(pool.query("DELETE FROM onboarding_events WHERE step_id=$1",[b.id]));
 assert.equal((await changeStep(a.id,'assign',{assigneeId:seeded.accounts[account('platform_admin')].id,dependencies:[b.id]})).status,400);
 assert.equal((await changeStep(a.id,'assign',{assigneeId:seeded.accounts[account('platform_admin')].id})).status,200);
 assert.equal((await support.call('/platform/onboarding/'+a.id)).status,404);
 const latest=(await support.call('/platform/onboarding/'+c.id)).data;
 assert.equal((await support.call('/platform/onboarding/'+c.id+'/change','POST',{key:randomUUID(),version:latest.version,action:'assign',assigneeId:seeded.accounts[account('platform_admin')].id})).status,403);
});
async function preview(client:Client,type:string,rows:Record<string,string>[]){
 return client.call('/platform/imports/preview','POST',{key:randomUUID(),buildingId:building,entityType:type,rows});
}
async function confirm(client:Client,j:any,key=randomUUID()){
 return client.call('/platform/imports/'+j.id+'/confirm','POST',{key,version:j.version});
}
test('Typed units/owner/resident/meter imports show row evidence, do not provision passwords or overwrite accounts',async()=>{
 const oldUsers=(await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
 const p=await preview(orgAdmin,'units',[{number:'P5-U',area:'25.50'},{number:'P5-R',area:'35.00'}]);assert.equal(p.status,201);assert.equal(p.data.status,'preview');assert.equal(p.data.preview[0].sourceRow,2);
 assert.equal((await pool.query("SELECT id FROM units WHERE building_id=$1 AND number='P5-U'",[building])).rowCount,0);
 const key=randomUUID(),committed=await confirm(orgAdmin,p.data,key);assert.equal(committed.status,200);assert.deepEqual((await confirm(orgAdmin,p.data,key)).data,committed.data);
 unit=(await pool.query("SELECT id FROM units WHERE building_id=$1 AND number='P5-U'",[building])).rows[0].id;residentUnit=(await pool.query("SELECT id FROM units WHERE building_id=$1 AND number='P5-R'",[building])).rows[0].id;
 const invalid=await preview(orgAdmin,'owners',[{unitNumber:'P5-U',email:'unregistered-qa@example.invalid'}]);assert.equal(invalid.data.status,'invalid');assert.ok(invalid.data.preview[0].errors.includes('registered_org_account_required'));assert.equal((await confirm(orgAdmin,invalid.data)).status,409);
 const own=await preview(orgAdmin,'owners',[{unitNumber:'P5-U',email:seeded.accounts.unit_owner.email}]);assert.equal(own.data.status,'preview');const applied=await confirm(orgAdmin,own.data);assert.equal(applied.status,200);ownerAssignment=applied.data.entities[0];
 const renterKey=account('renter'),r=await preview(orgAdmin,'residents',[{unitNumber:'P5-R',email:seeded.accounts[renterKey].email,startsOn:'2026-10-01',endsOn:'2026-12-31',rentMinor:'25000',currency:'AMD'}]);assert.equal(r.data.status,'preview');assert.equal((await confirm(orgAdmin,r.data)).status,200);
 assert.equal((await pool.query('SELECT id FROM leases WHERE unit_id=$1',[residentUnit])).rowCount,1);
 const m=await preview(orgAdmin,'meters',[{unitNumber:'P5-U',serialNumber:'P5-M-'+randomUUID(),kind:'water'}]);assert.equal((await confirm(orgAdmin,m.data)).status,200);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n,oldUsers);
 assert.equal((await preview(accountant,'units',[{number:'Denied-P5',area:'1'}])).status,403);
 assert.equal((await foreign.call('/platform/imports/'+p.data.id)).status,404);
});
test('Opening balances are exact signed minor units; debt/credit are atomic, immutable, bound and usable by existing credit allocation',async()=>{
 const before=(await pool.query('SELECT (SELECT count(*) FROM invoices)::int AS invoices,(SELECT count(*) FROM payments)::int AS payments')).rows[0];
 const rows=[{unitNumber:'P5-U',email:seeded.accounts.unit_owner.email,amountMinor:'12345',currency:'AMD',period:'2026-10-01',reference:'P5-DEBT-'+randomUUID()},
 {unitNumber:'P5-U',email:seeded.accounts.unit_owner.email,amountMinor:'-5000',currency:'AMD',period:'2026-10-01',reference:'P5-CREDIT-'+randomUUID()}];
 assert.equal((await preview(orgAdmin,'opening_balances',rows)).status,403);
 const p=await preview(accountant,'opening_balances',rows);assert.equal(p.status,201);assert.equal(p.data.status,'preview');
 assert.deepEqual((await pool.query('SELECT (SELECT count(*) FROM invoices)::int AS invoices,(SELECT count(*) FROM payments)::int AS payments')).rows[0],before);
 const key=randomUUID(),result=await confirm(accountant,p.data,key);assert.equal(result.status,200);assert.equal((await confirm(accountant,p.data,key)).status,200);
 const invoice=(await pool.query('SELECT * FROM invoices WHERE id=$1',[result.data.entities[0]])).rows[0];assert.equal(invoice.status,'published');assert.equal(invoice.amount_minor,'12345');
 const credit=(await pool.query('SELECT * FROM payments WHERE id=$1',[result.data.entities[1]])).rows[0];assert.equal(credit.amount_minor,'5000');assert.equal(credit.source,'opening_balance');
 const allocation=await accountant.call('/finance/credits/'+credit.id+'/allocate','POST',{key:randomUUID(),allocations:[{invoiceId:invoice.id,amountMinor:'3000'}]});assert.equal(allocation.status,200);
 assert.equal((await accountant.call('/finance/credits')).data.find((c:any)=>c.id===credit.id).credit_minor,'2000');
 assert.equal((await owner.call('/auth/context','POST',{id:ownerAssignment})).status,200);
 assert.equal((await owner.call('/finance/credits')).data.find((c:any)=>c.id===credit.id).credit_minor,'2000');
 await assert.rejects(pool.query('UPDATE payments SET amount_minor=1 WHERE id=$1',[credit.id]));
 const duplicate=await preview(accountant,'opening_balances',rows);assert.equal(duplicate.data.status,'invalid');
});
test('Typed import revalidation, late failure rollback, invalid dates/currencies and >32KB bounded JSON remain safe',async()=>{
 const invalid=await preview(accountant,'opening_balances',[{unitNumber:'P5-U',email:seeded.accounts.unit_owner.email,amountMinor:'100',currency:'EUR',period:'2026-02-30',reference:randomUUID()}]);assert.equal(invalid.data.status,'invalid');
 const late=await preview(orgAdmin,'units',[{number:'P5-LATE',area:'10'}]);await pool.query("INSERT INTO units(organization_id,building_id,number,area) VALUES($1,$2,'P5-LATE',10)",[org,building]);assert.equal((await confirm(orgAdmin,late.data)).status,409);
 const atomic=await preview(orgAdmin,'units',[{number:'P5-ATOMIC-1',area:'1'},{number:'P5-ATOMIC-2',area:'1'}]);
 await pool.query(`CREATE FUNCTION reject_p5_second() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.number='P5-ATOMIC-2' THEN RAISE EXCEPTION 'Injected late import failure';END IF;RETURN NEW;END$$;
 CREATE TRIGGER reject_p5_second BEFORE INSERT ON units FOR EACH ROW EXECUTE FUNCTION reject_p5_second()`);
 const key=randomUUID();try{assert.equal((await confirm(orgAdmin,atomic.data,key)).status,500);assert.equal((await pool.query("SELECT id FROM units WHERE number LIKE 'P5-ATOMIC-%'")).rowCount,0);assert.equal((await orgAdmin.call('/platform/imports/'+atomic.data.id)).data.status,'preview')}
 finally{await pool.query('DROP TRIGGER reject_p5_second ON units;DROP FUNCTION reject_p5_second()')}
 assert.equal((await confirm(orgAdmin,atomic.data,key)).status,200);
 const big=Array.from({length:500},(_,n)=>({number:('P5-JSON-'+n).padEnd(50,'X'),area:'1.00'}));assert.ok(Buffer.byteLength(JSON.stringify(big))>32768);
 const p=await preview(orgAdmin,'units',big);assert.equal(p.status,201);assert.equal(p.data.preview.length,500);
});
