import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
import {contexts} from '../access.js';
import {storedFiles} from '../file-migration.js';
import {protocolPdf} from '../meeting-results.js';
import {chromium} from 'playwright';
import {spawn,type ChildProcess} from 'node:child_process';
import {resolve} from 'node:path';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Isolated database required');
const seed=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const account=(role:string)=>Object.keys(seed.accounts).find(k=>k!=='second_org'&&seed.accounts[k].role===role)!;
const server=app.listen(0,'127.0.0.1');let base:string;
class Client{
 cookie='';csrf='';
 async call(path:string,method='GET',body?:any,binary=false){
 const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':binary?'application/octet-stream':'application/json',Cookie:this.cookie,...(method==='GET'?{}:{'X-CSRF-Token':this.csrf})},...(body===undefined?{}:{body:binary?body:JSON.stringify(body)})});
 if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 const data=r.headers.get('content-type')?.includes('json')?await r.json():Buffer.from(await r.arrayBuffer());if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data};
 }
 async login(key:string){const a=seed.accounts[key];await this.call('/auth/session');const r=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(r.status,200);
 if(!r.data.contextId){const c=r.data.contexts.find((c:any)=>c.role_key===a.role);assert.equal((await this.call('/auth/context','POST',{id:c.id})).status,200)}return this}
 async switch(user:string,role:string,b:string,unit?:string){const list=await contexts(user),c=list.find(c=>c.role_key===role&&c.building_id===b&&(!unit||c.unit_id===unit));assert.ok(c);assert.equal((await this.call('/auth/context','POST',{id:c.id})).status,200)}
}
const clients:Record<string,Client>={},users:Record<string,string>={};let org:string,building:string,unit:string,co:string,meeting:any,caseId:string,docId:string,version1:string,share:any,eligibility:any[],agendaId:string,discussionId:string,proposalId:string;
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Yerevan'}).format(new Date()),month=today.slice(0,7)+'-01',from=new Date(Date.parse(month)-35*86400000).toISOString().slice(0,10),filters=`from=${from}&to=${today}&currency=AMD`;
const oldBytes=Buffer.from('%PDF-1.7\nPHASE6-ORIGINAL-PRIVATE\n%%EOF'),newBytes=Buffer.from('%PDF-1.7\nPHASE6-NEW-PRIVATE\n%%EOF');
before(async()=>{
 await pool.query('DELETE FROM auth_rate_limits');await new Promise<void>(r=>server.listening?r():server.on('listening',r));base='http://127.0.0.1:'+(server.address() as any).port;
 for(const role of ['org_admin','manager','unit_owner','family','support','developer','contractor']){
 const key=account(role);users[role]=(await pool.query('SELECT id FROM users WHERE email=$1',[seed.accounts[key].email])).rows[0].id;clients[role]=await new Client().login(key);
 }
 org=(await pool.query("SELECT organization_id FROM role_assignments WHERE user_id=$1 AND role_key='org_admin' AND active LIMIT 1",[users.org_admin])).rows[0].organization_id;
 building=(await pool.query("INSERT INTO buildings(organization_id,name,address) VALUES($1,'Phase6 isolated building','QA synthetic') RETURNING id",[org])).rows[0].id;
 unit=(await pool.query("INSERT INTO units(organization_id,building_id,number,area) VALUES($1,$2,'P6-101',56) RETURNING id",[org,building])).rows[0].id;
 for(const role of ['manager','developer','unit_owner']){await pool.query('INSERT INTO role_assignments(user_id,organization_id,role_key,building_id,unit_id) VALUES($1,$2,$3,$4,$5)',[users[role],org,role,building,role==='unit_owner'?unit:null]);await clients[role].switch(users[role],role,building,role==='unit_owner'?unit:undefined)}
 const settings=await clients.org_admin.call('/resident/settings?buildingId='+building,'PUT',{directory:true,discussions:true,chat:true,marketplace:true,services:true});assert.equal(settings.status,200,JSON.stringify(settings.data));
 co=users.family;
});
after(async()=>{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));await pool.end()});
test('legal shares validate total, dates, basis, authorization, replay and append-only history',async()=>{
 const p={key:randomUUID(),unitId:unit,userId:users.unit_owner,startsOn:'2020-01-01',endsOn:null,shareBasisPoints:6000,basis:'Recorded isolated legal basis'};
 const a=await clients.manager.call('/ownerships','POST',p);assert.equal(a.status,201,JSON.stringify(a.data));share=a.data;
 assert.equal((await clients.manager.call('/ownerships','POST',p)).data.id,share.id);
 assert.equal((await clients.manager.call('/ownerships','POST',{...p,shareBasisPoints:5000})).status,409);
 assert.equal((await clients.manager.call('/ownerships','POST',{...p,key:randomUUID(),userId:co,shareBasisPoints:5000})).status,409);
 assert.equal((await clients.manager.call('/ownerships','POST',{...p,key:randomUUID(),userId:co,shareBasisPoints:4000})).status,201);
 assert.equal((await clients.family.call('/ownerships')).status,403);assert.equal((await clients.unit_owner.call('/ownerships','POST',{...p,key:randomUUID()})).status,403);
 assert.equal((await clients.manager.call('/ownerships','POST',{...p,key:randomUUID(),basis:'',shareBasisPoints:1})).status,400);
 await assert.rejects(pool.query('INSERT INTO ownerships(organization_id,unit_id,user_id,starts_on,share_basis_points) VALUES($1,$2,$3,$4,1)',[org,unit,co,'2020-01-01']),/ownership_share_overflow/);
 const list=await clients.unit_owner.call('/ownerships');assert.equal(list.status,200);assert.ok(list.data.every((r:any)=>r.user_id===users.unit_owner&&r.unit_id===unit));assert.ok(list.data[0].history.length);
 await assert.rejects(pool.query("UPDATE ownership_events SET reason='tamper' WHERE ownership_id=$1",[share.id]),/append-only/);
});
test('concurrent ownership writers cannot both consume the same remaining share',async()=>{
 const u=(await pool.query("INSERT INTO units(organization_id,building_id,number,area) VALUES($1,$2,'P6-RACE',40) RETURNING id",[org,building])).rows[0].id;
 const p={unitId:u,startsOn:'2020-01-01',endsOn:null,basis:'Concurrent recorded basis'};
 const a=await Promise.all([clients.manager.call('/ownerships','POST',{...p,key:randomUUID(),userId:users.unit_owner,shareBasisPoints:5000}),clients.manager.call('/ownerships','POST',{...p,key:randomUUID(),userId:co,shareBasisPoints:6000})]);
 assert.deepEqual(a.map(r=>r.status).sort(),[201,409]);assert.ok(Number((await pool.query('SELECT sum(share_basis_points) AS s FROM ownerships WHERE unit_id=$1',[u])).rows[0].s)<=10000);
 // Finish this test-only ownership before meeting eligibility calendar date.
 await pool.query("UPDATE ownerships SET ends_on='2020-01-02' WHERE unit_id=$1",[u]);
});
test('document v1 and consent are pinned before any parent replacement',async()=>{
 const q=new URLSearchParams({key:randomUUID(),title:'Հայերեն документ',buildingId:building,visibility:'residents',category:'ownership_basis'});
 const d=await clients.org_admin.call('/documents?'+q,'POST',oldBytes,true);assert.equal(d.status,201,JSON.stringify(d.data));docId=d.data.id;
 assert.equal((await clients.org_admin.call('/documents?'+q,'POST',oldBytes,true)).data.id,docId);
 const docs=await clients.org_admin.call('/documents');const doc=docs.data.find((r:any)=>r.id===docId);assert.ok(doc.latest_version_id);assert.equal(doc.category,'ownership_basis');assert.ok(!('storage_key'in doc));version1=doc.latest_version_id;
 const c=await clients.org_admin.call('/platform/support-cases','POST',{key:randomUUID(),subject:'Phase6 private attachment case',body:'Explicit consent to original document',attachmentIds:[docId],attachmentVersions:[{documentId:docId,versionId:version1}]});assert.equal(c.status,201,JSON.stringify(c.data));caseId=c.data.id;
 await pool.query('UPDATE support_cases SET assigned_to=$2 WHERE id=$1',[caseId,users.support]);
 const pinned=await clients.support.call(`/platform/support-cases/${caseId}/attachments/${docId}?versionId=${version1}`);assert.equal(pinned.status,200);assert.deepEqual(pinned.data,oldBytes);
});
test('weighted publication freezes real legal records, excludes role-only access and hides drafts',async()=>{
 const topic=await clients.unit_owner.call('/resident/records/discussions','POST',{title:'Bike rack proposal',body:'A resident suggested a secure bicycle rack.',category:'building'});assert.equal(topic.status,201,JSON.stringify(topic.data));discussionId=topic.data.id;
 const message=await clients.unit_owner.call(`/resident/records/discussions/${discussionId}/messages`,'POST',{body:'Please add a secure rack near entrance A.',clientId:randomUUID()});assert.equal(message.status,201,JSON.stringify(message.data));
 const submitted=await clients.unit_owner.call(`/resident/records/discussions/${discussionId}/agenda-proposals`,'POST',{key:randomUUID(),sourceMessageId:message.data.id,title:'Install a bicycle rack',description:'Review placement and procurement of a secure bicycle rack.'});assert.equal(submitted.status,201,JSON.stringify(submitted.data));proposalId=submitted.data.proposalId;
 assert.equal(submitted.data.status,'pending_review');
 const proposalTrail=await clients.unit_owner.call(`/resident/records/discussions/${discussionId}/lineage`);assert.equal(proposalTrail.status,200);assert.equal(proposalTrail.data[0].proposalId,proposalId);assert.equal(proposalTrail.data[0].requestId,null);assert.equal(proposalTrail.data[0].sourceExcerpt,'Please add a secure rack near entrance A.');
 const pending=await clients.manager.call(`/governance/agenda-proposals?status=pending_review&buildingId=${building}`);assert.equal(pending.status,200);assert.ok(pending.data.some((x:any)=>x.id===proposalId));
 const approved=await clients.manager.call(`/governance/agenda-proposals/${proposalId}/review`,'POST',{key:randomUUID(),version:1,action:'approve'});assert.equal(approved.status,200,JSON.stringify(approved.data));assert.equal(approved.data.status,'approved');
 const p:any={key:randomUUID(),buildingId:building,title:'Հայերեն собрание',description:'Recorded weighted meeting',startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),quorumBasisPoints:5000,documentIds:[docId],agenda:[{title:'Question one',votingType:'yes_no',options:['yes','no','abstain'],passOption:'yes',passBasisPoints:5001,proposalId},{title:'Question choice',votingType:'single_choice',options:['A','B'],passOption:'A',passBasisPoints:5001}]};
 const r=await clients.manager.call('/governance/meetings','POST',p);assert.equal(r.status,201,JSON.stringify(r.data));meeting=r.data;
 const draftTrail=await clients.unit_owner.call(`/resident/records/discussions/${discussionId}/lineage`);assert.equal(draftTrail.status,200);
 assert.equal(draftTrail.data[0].meetingId,null);assert.equal(draftTrail.data[0].meetingTitle,null);assert.equal(draftTrail.data[0].meetingStatus,null);
 assert.deepEqual(draftTrail.data[0].voteIds,[]);
 assert.equal((await clients.unit_owner.call('/governance/meetings/'+meeting.id)).status,404);
 assert.ok(!(await clients.unit_owner.call('/meetings')).data.some((m:any)=>m.id===meeting.id));
 assert.equal((await clients.manager.call(`/governance/meetings/${meeting.id}/actions`,'POST',{key:randomUUID(),version:1,action:'finalize'})).status,409);
 const pub={key:randomUUID(),version:1,action:'publish'};r.data=(await clients.manager.call(`/governance/meetings/${meeting.id}/actions`,'POST',pub)).data;
 assert.equal(r.data.status,'published',JSON.stringify(r.data));meeting=r.data;
 assert.equal((await clients.manager.call(`/governance/meetings/${meeting.id}/actions`,'POST',pub)).data.version,2);
 const detail=await clients.manager.call('/governance/meetings/'+meeting.id);eligibility=detail.data.eligibility;agendaId=detail.data.agenda.find((a:any)=>a.voting_type==='yes_no').id;
 assert.equal(detail.data.agenda.find((a:any)=>a.id===agendaId).proposal_id,proposalId);assert.equal(detail.data.agenda.find((a:any)=>a.id===agendaId).discussion_id,discussionId);
 const traced=await clients.unit_owner.call(`/resident/records/discussions/${discussionId}/lineage`);assert.equal(traced.status,200);assert.equal(traced.data[0].meetingId,meeting.id);assert.equal(traced.data[0].meetingTitle,'Հայերեն собрание');assert.equal(traced.data[0].meetingStatus,'published');assert.equal(traced.data[0].proposalStatus,'included');assert.equal(traced.data[0].sourceMessageId,message.data.id);assert.equal(traced.data[0].sourceExcerpt,'Please add a secure rack near entrance A.');
 assert.equal(detail.data.result.totalEligibleShare,10000);assert.equal(eligibility.length,2);assert.equal(detail.data.documents[0].version_id,version1);
 const e=await clients.manager.call('/ownerships/'+share.id+'/end','POST',{key:randomUUID(),version:1,endsOn:'2020-01-02',reason:'Test historical legal ending after publication'});assert.equal(e.status,200,JSON.stringify(e.data));
 assert.equal((await clients.manager.call('/governance/meetings/'+meeting.id)).data.result.totalEligibleShare,10000);
});
test('only actual snapshot owners vote once; weights and quorum are not legacy vote counts',async()=>{
 const own=eligibility.find(e=>e.owner_id===users.unit_owner),other=eligibility.find(e=>e.owner_id===co),p={key:randomUUID(),eligibilityId:own.id,selectedOption:'yes'};
 assert.equal((await clients.unit_owner.call(`/governance/agenda/${agendaId}/vote`,'POST',{...p,eligibilityId:other.id})).status,403);
 assert.equal((await clients.family.call(`/governance/agenda/${agendaId}/vote`,'POST',p)).status,403);
 assert.equal((await clients.unit_owner.call('/agenda/'+agendaId+'/vote','POST',{choice:'yes'})).status,409);
 const a=await clients.unit_owner.call(`/governance/agenda/${agendaId}/vote`,'POST',p);assert.equal(a.status,201,JSON.stringify(a.data));
 assert.equal((await clients.unit_owner.call(`/governance/agenda/${agendaId}/vote`,'POST',p)).data.id,a.data.id);
 assert.equal((await clients.unit_owner.call(`/governance/agenda/${agendaId}/vote`,'POST',{...p,key:randomUUID(),selectedOption:'no'})).status,409);
 const ownerTrail=await clients.unit_owner.call(`/resident/records/discussions/${discussionId}/lineage`);assert.equal(ownerTrail.status,200);assert.ok(ownerTrail.data[0].voteIds.includes(a.data.id));
 await pool.query("INSERT INTO role_assignments(user_id,organization_id,role_key,building_id,unit_id) VALUES($1,$2,'unit_owner',$3,$4)",[co,org,building,unit]);await clients.family.switch(co,'unit_owner',building,unit);
 const secondVote=await clients.family.call(`/governance/agenda/${agendaId}/vote`,'POST',{key:randomUUID(),eligibilityId:other.id,selectedOption:'no'});assert.equal(secondVote.status,201,JSON.stringify(secondVote.data));
 const coTrail=await clients.family.call(`/resident/records/discussions/${discussionId}/lineage`);assert.equal(coTrail.status,200);assert.ok(coTrail.data[0].voteIds.includes(secondVote.data.id));
 const detail=await clients.manager.call('/governance/meetings/'+meeting.id),result=detail.data.result.agenda.find((a:any)=>a.id===agendaId);
 assert.equal(detail.data.result.participationShare,10000);assert.equal(result.byOption.yes,6000);assert.equal(result.byOption.no,4000);assert.equal(result.quorum,true);assert.equal(result.passed,true);
 const view=await clients.unit_owner.call('/governance/meetings/'+meeting.id);assert.equal(view.data.eligibility.length,1);assert.equal(view.data.agenda.find((a:any)=>a.id===agendaId).my_votes.length,1);
 await assert.rejects(pool.query("UPDATE meeting_ballots SET selected_option='no' WHERE id=$1",[a.data.id]),/append-only/);
});
test('version uploads preserve byte history, reject stale sharing and never widen case consent',async()=>{
 const key=randomUUID(),q=new URLSearchParams({key,version:'1',title:'Replacement private staff version',category:'contract',visibility:'staff',relatedType:'building',relatedId:building});
 const v=await clients.manager.call(`/documents/${docId}/versions?${q}`,'POST',newBytes,true);assert.equal(v.status,201,JSON.stringify(v.data));
 const oldKey=(await pool.query('SELECT storage_key FROM document_versions WHERE id=$1',[version1])).rows[0].storage_key;
 assert.ok((await storedFiles()).some(f=>f.key===oldKey),'Backup inventory retains files referenced only by old document versions');
 assert.equal(v.data.previous_version_id,version1);assert.equal(v.data.version_number,2);assert.ok(!('storage_key'in v.data));
 const retry=await clients.manager.call(`/documents/${docId}/versions?${q}`,'POST',newBytes,true);assert.equal(retry.status,201);assert.equal(retry.data.id,v.data.id);
 const stale=new URLSearchParams(q);stale.set('key',randomUUID());assert.equal((await clients.manager.call(`/documents/${docId}/versions?${stale}`,'POST',newBytes,true)).status,409);
 assert.deepEqual((await clients.manager.call(`/documents/${docId}/versions/${version1}/download`)).data,oldBytes);
 assert.deepEqual((await clients.support.call(`/platform/support-cases/${caseId}/attachments/${docId}?versionId=${version1}`)).data,oldBytes);
 assert.equal((await clients.support.call(`/platform/support-cases/${caseId}/attachments/${docId}?versionId=${v.data.id}`)).status,404);
 assert.deepEqual((await clients.support.call(`/platform/support-cases/${caseId}/attachments/${docId}`)).data,oldBytes);
 assert.equal((await clients.unit_owner.call(`/documents/${docId}/versions/${version1}/download`)).status,404);
 const create={key:randomUUID(),subject:'No invisible future consent',body:'Stale selection must be rejected',attachmentIds:[docId],attachmentVersions:[{documentId:docId,versionId:version1}]};
 assert.equal((await clients.org_admin.call('/platform/support-cases','POST',create)).status,409);
 assert.equal((await clients.org_admin.call('/platform/support-cases','POST',{...create,key:randomUUID(),attachmentVersions:[]})).status,409);
 const messages=await clients.support.call('/platform/support-cases/'+caseId);assert.equal(messages.data.messages[0].attachment_versions[0].versionId,version1);
 await assert.rejects(pool.query("UPDATE document_versions SET title='changed' WHERE id=$1",[version1]),/append-only/);
});
test('protocol is generated only after end, as a private Unicode PDF and immutable result',async()=>{
 assert.equal((await clients.manager.call(`/governance/meetings/${meeting.id}/actions`,'POST',{key:randomUUID(),version:2,action:'finalize'})).status,409);
 // Isolated fixture advances the end instant; production exposes no published editor.
 await pool.query("UPDATE meetings SET ends_at=now()-interval '1 second' WHERE id=$1",[meeting.id]);
 assert.equal((await clients.unit_owner.call(`/governance/agenda/${agendaId}/vote`,'POST',{key:randomUUID(),eligibilityId:eligibility[0].id,selectedOption:'yes'})).status,409);
 const p={key:randomUUID(),version:2,action:'finalize'},f=await clients.manager.call(`/governance/meetings/${meeting.id}/actions`,'POST',p);
 assert.equal(f.status,200,JSON.stringify(f.data));assert.equal(f.data.status,'finalized');assert.ok(f.data.protocol_document_id);
 const decisionTrail=await clients.unit_owner.call(`/resident/records/discussions/${discussionId}/lineage`);assert.equal(decisionTrail.status,200);assert.equal(decisionTrail.data[0].proposalStatus,'decided');assert.equal(decisionTrail.data[0].decision?.passed,true);
 assert.equal((await clients.manager.call(`/governance/meetings/${meeting.id}/actions`,'POST',p)).data.protocol_document_id,f.data.protocol_document_id);
 assert.equal((await pool.query('SELECT count(*)::int AS count FROM meeting_results WHERE meeting_id=$1',[meeting.id])).rows[0].count,1);
 assert.equal((await pool.query('SELECT count(*)::int AS count FROM documents WHERE id=$1',[f.data.protocol_document_id])).rows[0].count,1);
 const pdf=await clients.unit_owner.call('/documents/'+f.data.protocol_document_id+'/download');assert.equal(pdf.status,200);assert.equal(pdf.data.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.data.length>1000);
 for(let attempt=0;attempt<12;attempt++){
  const bytes=await protocolPdf({...meeting,title:'Հայերեն русский',description:'Ստուգում'}, {totalEligibleShare:10000,participationShare:10000,agenda:[]});
  assert.ok(Buffer.isBuffer(bytes));assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok(bytes.length>1000);
 }
 await assert.rejects(pool.query('UPDATE meeting_results SET result=$2 WHERE meeting_id=$1',[meeting.id,'{}']),/append-only/);
});
test('manager and resident complete a weighted meeting through the UI and download its protocol',async()=>{
 const uiUnit=(await pool.query("INSERT INTO units(organization_id,building_id,number,area) VALUES($1,$2,'P6-UI',52) RETURNING id",[org,building])).rows[0].id;
 for(const role of ['unit_owner','family'])await pool.query(
  'INSERT INTO role_assignments(user_id,organization_id,role_key,building_id,unit_id) VALUES($1,$2,$3,$4,$5)',
  [users[role],org,role,building,uiUnit],
 );
 await pool.query("UPDATE users SET locale='en' WHERE id=ANY($1::uuid[])",[[users.manager,users.unit_owner]]);
 const startsOn=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Yerevan'}).format(new Date());
 for(const [userId,shareBasisPoints] of [[users.unit_owner,6000],[users.family,4000]] as const){
  const ownership=await clients.manager.call('/ownerships','POST',{
   key:randomUUID(),unitId:uiUnit,userId,startsOn,endsOn:null,shareBasisPoints,basis:'Isolated browser acceptance ownership',
  });
  assert.equal(ownership.status,201,JSON.stringify(ownership.data));
 }

 const webPort=4191,webDir=resolve(process.cwd(),'../../../vernatun');
 const viteBin=resolve(webDir,'node_modules/vite/bin/vite.js');
 let web:ChildProcess|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
 try{
  web=spawn(process.execPath,[viteBin,'--host','127.0.0.1'],{
   cwd:webDir,
   env:{...process.env,PORT:String(webPort),BASE_PATH:'/',API_PROXY_TARGET:base},
   stdio:'ignore',
  });
  const launch=Date.now();
  while(Date.now()-launch<30000){
   if(web.exitCode!==null)throw new Error(`Vite exited with code ${web.exitCode}`);
   try{const response=await fetch(`http://127.0.0.1:${webPort}/`);if(response.ok)break}catch{}
   await new Promise(r=>setTimeout(r,200));
  }
  assert.ok(Date.now()-launch<30000,'Vite UI server did not become ready');
  browser=await chromium.launch({headless:true,executablePath:process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
  const managerAccount=seed.accounts[account('manager')],ownerAccount=seed.accounts[account('unit_owner')];
  const signIn=async(page:import('playwright').Page,a:{email:string;password:string})=>{
   await page.addInitScript(()=>localStorage.setItem('vernatun.language','en'));
   await page.goto(`http://127.0.0.1:${webPort}/login`,{waitUntil:'domcontentloaded'});
   await page.locator('input[name="email"]').fill(a.email);
   await page.locator('input[name="password"]').fill(a.password);
   await page.getByRole('button',{name:'Sign in'}).click();
   await page.waitForFunction(()=>location.pathname!=='/login',{timeout:15000});
  };
  const managerPage=await browser.newPage();
  await signIn(managerPage,managerAccount);
  if(await managerPage.locator('.p-context-grid').count())await managerPage.getByRole('button').filter({hasText:'Manager'}).first().click();
  await managerPage.goto(`http://127.0.0.1:${webPort}/os/meetings`);
  await managerPage.getByRole('button',{name:'New weighted meeting'}).waitFor({timeout:10000});
  await managerPage.getByRole('button',{name:'New weighted meeting'}).click();
  const createDialog=managerPage.locator('dialog.p-modal').filter({hasText:'New weighted meeting'});
  try{await createDialog.waitFor({state:'visible',timeout:5000})}
  catch{throw new Error(`Weighted meeting editor did not open. Dialogs: ${await managerPage.locator('dialog').count()}; page: ${(await managerPage.locator('body').innerText()).slice(-900)}`)}
  const now=new Date(),start=new Date(now.getTime()+30*60_000),end=new Date(now.getTime()+60*60_000);
  const inOrgTime=(date:Date)=>new Intl.DateTimeFormat('sv-SE',{
   timeZone:'Asia/Yerevan',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  }).format(date).replace(' ','T');
  await createDialog.locator('select').first().selectOption({label:'Phase6 isolated building'});
  await createDialog.locator('input:not([type])').nth(0).fill('QA browser weighted meeting');
  await createDialog.locator('input[type="datetime-local"]').nth(0).fill(inOrgTime(start));
  await createDialog.locator('input[type="datetime-local"]').nth(1).fill(inOrgTime(end));
  await createDialog.locator('input:not([type])').nth(2).fill('Approve the maintenance plan');
  await createDialog.getByRole('button',{name:'Create',exact:true}).click();
  await managerPage.getByRole('button',{name:'Publish',exact:true}).click();
  await managerPage.getByRole('button',{name:'Cancel meeting',exact:true}).waitFor({timeout:10000});
  const meetingId=(await clients.manager.call('/governance/meetings')).data.find((m:any)=>m.title==='QA browser weighted meeting')?.id;
  assert.ok(meetingId,'UI-created meeting should appear in the API list');

  // Advance only this disposable test meeting's clock after publication so the
  // resident can vote in the published open window without a long real-time wait.
  await pool.query('UPDATE meetings SET starts_at=now()-interval \'1 second\' WHERE id=$1',[meetingId]);
  const ownerPage=await browser.newPage();
  await signIn(ownerPage,ownerAccount);
  if(await ownerPage.locator('.p-context-grid').count()){
   await ownerPage.getByRole('button').filter({hasText:'P6-UI'}).click();
  }
  await ownerPage.goto(`http://127.0.0.1:${webPort}/imtun/meetings`);
  await ownerPage.getByRole('button',{name:/QA browser weighted meeting/}).waitFor();
  await ownerPage.getByRole('button',{name:/QA browser weighted meeting/}).click();
  const option=ownerPage.locator('.p6-opt select').first();
  await option.selectOption('yes');
  await ownerPage.getByRole('button',{name:'Cast vote',exact:true}).click();
  await ownerPage.getByText(/60(?:\.0+)?%/).first().waitFor({timeout:10000});
  await ownerPage.getByText(/Ballot recorded/).waitFor();

  await pool.query('UPDATE meetings SET ends_at=now()-interval \'1 second\' WHERE id=$1',[meetingId]);
  await managerPage.goto(`http://127.0.0.1:${webPort}/os/meetings`);
  await managerPage.getByRole('button',{name:/QA browser weighted meeting/}).click();
  await managerPage.getByRole('button',{name:'Finalize and produce protocol'}).click();
  const protocolLink=managerPage.getByRole('link',{name:/Protected protocol.*Download/});
  await protocolLink.waitFor({timeout:10000});
  const [download]=await Promise.all([managerPage.waitForEvent('download'),protocolLink.click()]);
  const path=await download.path();assert.ok(path);
  const pdf=await readFile(path);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>1000);
  await ownerPage.close();
 }finally{
  await browser?.close();
  if(web&&!web.killed)web.kill('SIGTERM');
 }
});
test('resident discussion conversions reach request, reviewed agenda, vote and decision across browser UIs',async()=>{
 const uiUnit=(await pool.query("INSERT INTO units(organization_id,building_id,number,area) VALUES($1,$2,'P6-LINEAGE',48) RETURNING id",[org,building])).rows[0].id;
 await pool.query('INSERT INTO role_assignments(user_id,organization_id,role_key,building_id,unit_id) VALUES($1,$2,$3,$4,$5)',[users.unit_owner,org,'unit_owner',building,uiUnit]);
 await pool.query("UPDATE users SET locale='en' WHERE id=ANY($1::uuid[])",[[users.manager,users.unit_owner]]);
 const startsOn=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Yerevan'}).format(new Date());
 const ownership=await clients.manager.call('/ownerships','POST',{key:randomUUID(),unitId:uiUnit,userId:users.unit_owner,startsOn,endsOn:null,shareBasisPoints:10000,basis:'Isolated discussion-to-decision browser ownership'});
 assert.equal(ownership.status,201,JSON.stringify(ownership.data));
 const ownerContext=(await contexts(users.unit_owner)).find(c=>c.role_key==='unit_owner'&&c.building_id===building&&c.unit_id===uiUnit);
 assert.ok(ownerContext,'The resident test user should have a context for the isolated unit');
 await clients.unit_owner.switch(users.unit_owner,'unit_owner',building,uiUnit);

 const webPort=4191,mobilePort=4192,webDir=resolve(process.cwd(),'../../../vernatun'),mobileDir=resolve(process.cwd(),'../../../imtun-mobile');
 const viteBin=resolve(webDir,'node_modules/vite/bin/vite.js'),expoBin=resolve(mobileDir,'node_modules/expo/bin/cli');
 let web:ChildProcess|undefined,mobile:ChildProcess|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
 let mobileLogs='';
 try{
  web=spawn(process.execPath,[viteBin,'--host','127.0.0.1'],{cwd:webDir,env:{...process.env,PORT:String(webPort),BASE_PATH:'/',API_PROXY_TARGET:base},stdio:'ignore'});
  const mobileEnv={...process.env,NODE_ENV:'development',CI:'1',PORT:String(mobilePort),REPLIT_EXPO_DEV_DOMAIN:`localhost:${mobilePort}`};
  mobile=spawn(process.execPath,[expoBin,'start','--web','--host','localhost','--port',String(mobilePort)],{
   cwd:mobileDir,env:mobileEnv,stdio:'pipe',
  });
  mobile.stdout?.on('data',chunk=>{mobileLogs+=String(chunk)});
  mobile.stderr?.on('data',chunk=>{mobileLogs+=String(chunk)});
  const waitForServer=async(url:string,child:ChildProcess,label:string)=>{
   const started=Date.now();
   while(Date.now()-started<90000){
    if(child.exitCode!==null)throw new Error(`${label} exited with code ${child.exitCode}${label==='ImTun browser UI'?`: ${mobileLogs.slice(-5000)}`:''}`);
    try{const response=await fetch(url);if(response.ok)return}catch{}
    await new Promise(r=>setTimeout(r,250));
   }
   throw new Error(`${label} did not become ready`);
  };
  await Promise.all([
   waitForServer(`http://127.0.0.1:${webPort}/`,web,'Vernatun browser UI'),
   waitForServer(`http://localhost:${mobilePort}/`,mobile,'ImTun browser UI'),
  ]);
  browser=await chromium.launch({headless:true,executablePath:process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
  const ownerPage=await browser.newPage({viewport:{width:430,height:900}});
  const mobilePageErrors:string[]=[];
  const mobileApiResponses:string[]=[];
  ownerPage.on('pageerror',error=>mobilePageErrors.push(error.message));
  ownerPage.on('response',response=>{if(response.url().includes('/__imtun_dev_api/api/'))mobileApiResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`)});
  const mobileOrigin=`http://localhost:${mobilePort}`;
  await ownerPage.route('**/__imtun_dev_api/api/**',async route=>{
   const request=route.request(),requestHeaders=request.headers(),url=new URL(request.url());
   const headers:Record<string,string>={};
   for(const key of ['accept','content-type','cookie','x-csrf-token'])if(requestHeaders[key])headers[key]=requestHeaders[key];
   const response=await fetch(`${base}${url.pathname.replace('/__imtun_dev_api','')}${url.search}`,{
    method:request.method(),headers,...(request.postDataBuffer()?{body:request.postDataBuffer()}:{}),
   });
   const responseHeaders:Record<string,string>={'content-type':response.headers.get('content-type')??'application/json'};
   const setCookie=response.headers.get('set-cookie');if(setCookie)responseHeaders['set-cookie']=setCookie;
   const payload=Buffer.from(await response.arrayBuffer());
   if(response.status>=400)mobileApiResponses.push(`API error ${response.status} ${request.method()} ${url.pathname}${url.search}; csrf=${Boolean(headers['x-csrf-token'])}; cookie=${Boolean(headers.cookie)}; body=${payload.toString('utf8').slice(0,500)}`);
   await route.fulfill({status:response.status,headers:responseHeaders,body:payload});
  });
  const residentAccount=seed.accounts[account('unit_owner')];
  await ownerPage.goto(mobileOrigin);
  await ownerPage.getByTestId('login-email').waitFor({timeout:30000});
  await ownerPage.getByTestId('login-email').fill(residentAccount.email);
  await ownerPage.getByTestId('login-password').fill(residentAccount.password);
  await ownerPage.getByTestId('login-submit').click();
  const contextCards=ownerPage.locator('[data-testid^="context-"]');
  await contextCards.first().waitFor({timeout:20000});
  let targetContext:string|undefined;
  for(const card of await contextCards.all()){
   if((await card.innerText()).includes('P6-LINEAGE')){targetContext=await card.getAttribute('data-testid')??undefined;break}
  }
  assert.ok(targetContext,'The ImTun context picker should list the isolated resident apartment');
  await ownerPage.getByTestId(targetContext).click();
  try{await ownerPage.getByTestId('home-context-button').waitFor({timeout:20000})}
  catch{throw new Error(`ImTun did not open the selected resident home. URL: ${ownerPage.url()}; page: ${(await ownerPage.locator('body').innerText()).slice(-3000)}; browser errors: ${mobilePageErrors.join(' | ')}; API responses: ${mobileApiResponses.slice(-20).join(' | ')}`)}
  await ownerPage.getByText('Community',{exact:true}).last().click();
  await ownerPage.getByText('Discussions',{exact:true}).click();
  await ownerPage.getByRole('button',{name:'Add',exact:true}).first().waitFor({timeout:20000});
  await ownerPage.getByRole('button',{name:'Add',exact:true}).first().click();
  const topicTitle=`QA discussion ${randomUUID().slice(0,8)}`,firstMessage=`QA source message ${randomUUID().slice(0,8)}`,secondMessage=`QA rejected source ${randomUUID().slice(0,8)}`;
  await ownerPage.getByLabel('Title',{exact:true}).fill(topicTitle);
  await ownerPage.getByLabel('Details',{exact:true}).fill('Resident discussion for the browser acceptance path.');
  await ownerPage.getByRole('button',{name:'Save',exact:true}).click();
  try{await ownerPage.getByText(topicTitle,{exact:true}).waitFor()}
  catch{throw new Error(`ImTun did not show the newly created discussion. Page: ${(await ownerPage.locator('body').innerText()).slice(-3000)}; API responses: ${mobileApiResponses.slice(-20).join(' | ')}`)}
  await ownerPage.getByRole('button',{name:'Messages',exact:true}).first().click();
  const messageInput=ownerPage.getByLabel('Message',{exact:true});
  await messageInput.fill(firstMessage);
  await ownerPage.getByRole('button',{name:'Send',exact:true}).click();
  await ownerPage.getByRole('button',{name:'Create request',exact:true}).waitFor();
  await ownerPage.getByRole('button',{name:'Create request',exact:true}).click();
  await ownerPage.getByText('Selected discussion source',{exact:false}).waitFor();
  assert.ok(await ownerPage.getByText(firstMessage,{exact:true}).count()>=2,'The chosen source message should be previewed in the request form');
  await ownerPage.getByLabel('Request subject',{exact:true}).fill('QA entrance light repair request');
  await ownerPage.getByLabel('Details',{exact:true}).last().fill('Replace the failed entrance light.');
  await ownerPage.getByRole('button',{name:'Create request',exact:true}).last().click();
  await ownerPage.getByText('Submitted',{exact:true}).waitFor();
  await ownerPage.getByRole('button',{name:'Linked records',exact:true}).first().click();
  await ownerPage.getByText('Discussion → request',{exact:true}).waitFor();
  const topicId=(await pool.query("SELECT id FROM resident_product_records WHERE organization_id=$1 AND kind='discussions' AND title=$2",[org,topicTitle])).rows[0]?.id;
  assert.ok(topicId,'The discussion created in ImTun should be persisted');
  const originalMessage=(await pool.query('SELECT id FROM resident_product_messages WHERE record_id=$1 AND body=$2',[topicId,firstMessage])).rows[0];
  assert.ok(originalMessage,'The source message should be persisted before it is converted');
  let trail=(await clients.unit_owner.call(`/resident/records/discussions/${topicId}/lineage`));
  assert.equal(trail.status,200,JSON.stringify(trail.data));assert.equal(trail.data.length,1);
  assert.ok(trail.data[0].requestId);assert.equal(trail.data[0].proposalId,null);
  assert.equal(trail.data[0].sourceMessageId,originalMessage.id);
  assert.equal((await pool.query('SELECT source_text FROM resident_discussion_lineage WHERE request_id=$1',[trail.data[0].requestId])).rows[0]?.source_text,firstMessage);

  await ownerPage.getByRole('button',{name:'Messages',exact:true}).first().click();
  await ownerPage.getByRole('button',{name:'Suggest agenda',exact:true}).click();
  const approvedTitle='QA approved bicycle rack proposal';
  await ownerPage.getByLabel('Agenda proposal title',{exact:true}).fill(approvedTitle);
  await ownerPage.getByLabel('Proposal details',{exact:true}).fill('Review a secure bicycle rack near the entrance.');
  await ownerPage.getByRole('button',{name:'Submit for review',exact:true}).click();
  await ownerPage.getByText('Submitted',{exact:true}).waitFor();
  await ownerPage.getByRole('button',{name:'Messages',exact:true}).first().click();
  await messageInput.fill(secondMessage);
  await ownerPage.getByRole('button',{name:'Send',exact:true}).click();
  await ownerPage.getByRole('button',{name:'Suggest agenda',exact:true}).nth(1).waitFor();
  await ownerPage.getByRole('button',{name:'Suggest agenda',exact:true}).nth(1).click();
  const rejectedTitle='QA rejected parking proposal';
  await ownerPage.getByLabel('Agenda proposal title',{exact:true}).fill(rejectedTitle);
  await ownerPage.getByLabel('Proposal details',{exact:true}).fill('This proposal must not become an agenda item.');
  await ownerPage.getByRole('button',{name:'Submit for review',exact:true}).click();
  await ownerPage.getByText('Submitted',{exact:true}).waitFor();
  await ownerPage.getByRole('button',{name:'Linked records',exact:true}).first().click();
  const agendaLinks=ownerPage.getByText('Discussion → agenda proposal',{exact:true});
  await agendaLinks.first().waitFor();
  assert.equal(await agendaLinks.count(),2);
  trail=await clients.unit_owner.call(`/resident/records/discussions/${topicId}/lineage`);
  assert.equal(trail.status,200);assert.equal(trail.data.length,3);
  assert.equal(trail.data.filter((x:any)=>x.requestId).length,1);
  assert.equal(trail.data.filter((x:any)=>x.proposalId).length,2);
  const approvedProposal=(await pool.query('SELECT id FROM resident_agenda_proposals WHERE organization_id=$1 AND title=$2',[org,approvedTitle])).rows[0]?.id;
  const rejectedProposal=(await pool.query('SELECT id FROM resident_agenda_proposals WHERE organization_id=$1 AND title=$2',[org,rejectedTitle])).rows[0]?.id;
  assert.ok(approvedProposal&&rejectedProposal,'Both proposals created in ImTun should be persisted separately from the request');
  const secondMessageRecord=(await pool.query('SELECT id FROM resident_product_messages WHERE record_id=$1 AND body=$2',[topicId,secondMessage])).rows[0];
  assert.ok(secondMessageRecord,'The second proposal source message should be persisted');
  const proposalSources=await pool.query('SELECT proposal_id,source_message_id,source_text FROM resident_discussion_lineage WHERE proposal_id=ANY($1::uuid[])',[ [approvedProposal,rejectedProposal] ]);
  assert.equal(proposalSources.rowCount,2);
  assert.deepEqual(new Set(proposalSources.rows.map(row=>row.source_message_id)),new Set([originalMessage.id,secondMessageRecord.id]));
  assert.deepEqual(new Set(proposalSources.rows.map(row=>row.source_text)),new Set([firstMessage,secondMessage]));

  const managerPage=await browser.newPage();
  const managerAccount=seed.accounts[account('manager')];
  await managerPage.addInitScript(()=>localStorage.setItem('vernatun.language','en'));
  await managerPage.goto(`http://127.0.0.1:${webPort}/login`,{waitUntil:'domcontentloaded'});
  await managerPage.locator('input[name="email"]').fill(managerAccount.email);
  await managerPage.locator('input[name="password"]').fill(managerAccount.password);
  await managerPage.getByRole('button',{name:'Sign in'}).click();
  await managerPage.waitForFunction(()=>location.pathname!=='/login',{timeout:15000});
  if(await managerPage.locator('.p-context-grid').count())await managerPage.getByRole('button').filter({hasText:'Manager'}).first().click();
  await managerPage.goto(`http://127.0.0.1:${webPort}/os/meetings`);
  const proposalRow=(title:string)=>managerPage.locator('.p6-agenda').filter({hasText:title});
  await proposalRow(rejectedTitle).getByRole('button',{name:'Reject',exact:true}).click();
  const rejectDialog=managerPage.locator('dialog.p-modal').filter({hasText:'Reject'});
  await rejectDialog.waitFor({state:'visible'});
  await rejectDialog.locator('textarea').fill('Not suitable for the building.');
  await rejectDialog.getByRole('button',{name:'Save decision',exact:true}).click();
  await proposalRow(approvedTitle).getByRole('button',{name:'Approve after review',exact:true}).click();
  await proposalRow(approvedTitle).waitFor({state:'detached',timeout:10000});
  const rejected=await pool.query('SELECT status FROM resident_agenda_proposals WHERE id=$1',[rejectedProposal]);
  assert.equal(rejected.rows[0].status,'rejected');
  const approved=await pool.query('SELECT status FROM resident_agenda_proposals WHERE id=$1',[approvedProposal]);
  assert.equal(approved.rows[0].status,'approved');
  const approvedQueue=await clients.manager.call(`/governance/agenda-proposals?status=approved&buildingId=${building}`);
  assert.equal(approvedQueue.status,200);
  assert.ok(approvedQueue.data.some((proposal:any)=>proposal.id===approvedProposal));
  assert.equal(approvedQueue.data.some((proposal:any)=>proposal.id===rejectedProposal),false);

  await managerPage.getByRole('button',{name:'New weighted meeting',exact:true}).click();
  const createDialog=managerPage.locator('dialog.p-modal').filter({hasText:'New weighted meeting'});
  await createDialog.waitFor({state:'visible'});
  const now=new Date(),start=new Date(now.getTime()+30*60_000),end=new Date(now.getTime()+60*60_000);
  const inOrgTime=(date:Date)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Yerevan',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date).replace(' ','T');
  await createDialog.locator('select').first().selectOption({label:'Phase6 isolated building'});
  const approvedCard=createDialog.locator('.p6-agenda').filter({hasText:approvedTitle});
  await approvedCard.waitFor({state:'visible'});
  await approvedCard.getByRole('button',{name:'Add to agenda',exact:true}).click();
  assert.equal(await createDialog.getByText(rejectedTitle,{exact:true}).count(),0,'Rejected proposals must not appear in the approved-proposals picker');
  await createDialog.getByRole('button',{name:'Remove',exact:true}).first().click();
  await createDialog.getByLabel('Title',{exact:true}).first().fill('QA discussion decision meeting');
  // Other phase6 fixtures use this building; a low quorum isolates the result to this test voter's actual ballot.
  await createDialog.locator('label').filter({hasText:'Quorum (%)'}).locator('input').fill('0.01');
  await createDialog.locator('input[type="datetime-local"]').nth(0).fill(inOrgTime(start));
  await createDialog.locator('input[type="datetime-local"]').nth(1).fill(inOrgTime(end));
  await createDialog.getByRole('button',{name:'Create',exact:true}).click();
  await managerPage.getByRole('button',{name:'Publish',exact:true}).click();
  await managerPage.getByRole('button',{name:'Cancel meeting',exact:true}).waitFor({timeout:10000});
  const meetingId=(await clients.manager.call('/governance/meetings')).data.find((m:any)=>m.title==='QA discussion decision meeting')?.id;
  assert.ok(meetingId,'The manager should create and publish the meeting from the approved proposal');
  await pool.query("UPDATE meetings SET starts_at=now()-interval '1 second' WHERE id=$1",[meetingId]);
  const agenda=await clients.manager.call(`/governance/meetings/${meetingId}`);
  const proposalItem=agenda.data.agenda.find((item:any)=>item.proposal_id===approvedProposal);
  assert.ok(proposalItem,'The published agenda item should preserve its approved proposal');
  assert.equal(proposalItem.discussion_id,topicId);
  assert.equal(proposalItem.source_message_id,trail.data.find((x:any)=>x.proposalId===approvedProposal).sourceMessageId);

  const voterPage=await browser.newPage();
  await voterPage.addInitScript(()=>localStorage.setItem('vernatun.language','en'));
  await voterPage.goto(`http://127.0.0.1:${webPort}/login`,{waitUntil:'domcontentloaded'});
  await voterPage.locator('input[name="email"]').fill(residentAccount.email);
  await voterPage.locator('input[name="password"]').fill(residentAccount.password);
  await voterPage.getByRole('button',{name:'Sign in'}).click();
  await voterPage.waitForFunction(()=>location.pathname!=='/login',{timeout:15000});
  if(await voterPage.locator('.p-context-grid').count())await voterPage.getByRole('button').filter({hasText:'P6-LINEAGE'}).click();
  await voterPage.goto(`http://127.0.0.1:${webPort}/imtun/meetings`);
  await voterPage.getByRole('button',{name:/QA discussion decision meeting/}).click();
  await voterPage.locator('.p6-opt select').first().selectOption('yes');
  await voterPage.getByRole('button',{name:'Cast vote',exact:true}).click();
  await voterPage.getByText(/Ballot recorded/).waitFor({timeout:10000});
  await pool.query("UPDATE meetings SET ends_at=now()-interval '1 second' WHERE id=$1",[meetingId]);
  await managerPage.goto(`http://127.0.0.1:${webPort}/os/meetings`);
  await managerPage.getByRole('button',{name:/QA discussion decision meeting/}).click();
  await managerPage.getByRole('button',{name:'Finalize and produce protocol'}).click();
  await managerPage.getByRole('link',{name:/Protected protocol.*Download/}).waitFor({timeout:10000});
  const final=await clients.manager.call(`/governance/meetings/${meetingId}`);
  assert.equal(final.data.result.agenda.find((x:any)=>x.id===proposalItem.id).passed,true,JSON.stringify(final.data.result));
  await ownerPage.reload();
  await ownerPage.getByTestId('home-context-button').waitFor({timeout:20000});
  await ownerPage.getByText('Community',{exact:true}).last().click();
  await ownerPage.getByText('Discussions',{exact:true}).click();
  await ownerPage.getByText(topicTitle,{exact:true}).waitFor();
  await ownerPage.getByRole('button',{name:'Linked records',exact:true}).first().click();
  await ownerPage.getByText('Decision: Passed',{exact:true}).waitFor({timeout:15000});
  await ownerPage.getByText(`Meeting: QA discussion decision meeting · finalized`,{exact:true}).waitFor();
  assert.equal((await clients.unit_owner.call(`/resident/records/discussions/${topicId}/lineage`)).data.find((x:any)=>x.proposalId===approvedProposal).decision.passed,true);
  await voterPage.close();await managerPage.close();await ownerPage.close();
 }finally{
  await browser?.close();
  if(web&&!web.killed)web.kill('SIGTERM');
  if(mobile&&!mobile.killed)mobile.kill('SIGTERM');
 }
});
test('portfolio exact arithmetic, recorded budget CAS, real series and contractor history',async()=>{
 const budget={key:randomUUID(),buildingId:building,period:month,currency:'AMD',amountMinor:'99999999999999'};
 const a=await clients.manager.call('/portfolio/budgets','POST',budget);assert.equal(a.status,200,JSON.stringify(a.data));
 assert.equal((await clients.manager.call('/portfolio/budgets','POST',budget)).data.id,a.data.id);
 assert.equal((await clients.manager.call('/portfolio/budgets','POST',{...budget,key:randomUUID(),amountMinor:'1'})).status,409);
 assert.equal((await clients.unit_owner.call('/portfolio/budgets','POST',budget)).status,403);
 const invoice=(await pool.query("INSERT INTO invoices(organization_id,unit_id,payer_user_id,period,amount_minor,currency,status) VALUES($1,$2,$3,$4,99999999999999,'AMD','published') RETURNING id",[org,unit,users.unit_owner,month])).rows[0].id;
 const payment=(await pool.query("INSERT INTO payments(organization_id,payer_user_id,amount_minor,currency,source,reference,confirmed_by) VALUES($1,$2,99999999999998,'AMD','manual_bank',$3,$4) RETURNING id",[org,users.unit_owner,randomUUID(),users.manager])).rows[0].id;
 await pool.query('INSERT INTO payment_allocations(organization_id,payment_id,invoice_id,amount_minor,created_by) VALUES($1,$2,$3,99999999999998,$4)',[org,payment,invoice,users.manager]);
 await pool.query("INSERT INTO expenses(organization_id,building_id,description,amount_minor,currency,created_by,approved_by,approved_at) VALUES($1,$2,'Recorded approved expense',3,'AMD',$3,$4,now())",[org,building,users.org_admin,users.manager]);
 const r=await clients.manager.call('/portfolio/analytics?'+filters+'&buildingId='+building);assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(r.data.summary.billedMinor,'99999999999999');assert.equal(r.data.summary.collectedMinor,'99999999999998');assert.equal(r.data.summary.outstandingMinor,'1');assert.equal(r.data.summary.budgetVarianceMinor,'99999999999996');assert.equal(r.data.summary.netAllocatedCashflowMinor,'99999999999995');assert.ok(r.data.series.length);
 const empty=await clients.manager.call('/portfolio/analytics?from=1900-01-01&to=1900-01-31&currency=USD&buildingId='+building);assert.equal(empty.status,200);assert.equal(empty.data.series.length,0);assert.equal(empty.data.summary.budgetMinor,null);
 assert.equal((await clients.unit_owner.call('/portfolio/analytics?'+filters)).status,403);
 assert.equal((await clients.manager.call('/portfolio/analytics?'+filters+'&buildingId='+building+'&propertyId='+randomUUID())).status,400);
 const d=(await pool.query("INSERT INTO defects(organization_id,unit_id,subject,location,description,contractor_id,due_on,status,created_by,created_at) VALUES($1,$2,'Scorecard repair','QA','Real history only',$3,current_date-1,'accepted',$4,now()-interval '2 days') RETURNING id",[org,unit,users.contractor,users.developer])).rows[0].id;
 await pool.query("INSERT INTO defect_history(defect_id,actor_id,action,note,created_at) VALUES($1,$2,'report','Actual contractor report',now()-interval '2 hours'),($1,$3,'accept','Actual review',now()-interval '1 hour')",[d,users.contractor,users.developer]);
 const reopen=await clients.developer.call('/defects/'+d+'/transition','POST',{key:randomUUID(),version:1,action:'reopen',note:'Reopened after accepted defect reappeared'});assert.equal(reopen.status,200,JSON.stringify(reopen.data));
 const score=await clients.manager.call('/contractors/scorecard?'+filters+'&buildingId='+building);assert.equal(score.status,200,JSON.stringify(score.data));
 const s=score.data.find((x:any)=>x.id===users.contractor);assert.equal(s.jobsAssigned,1);assert.equal(s.completed,1);assert.equal(s.accepted,1);assert.equal(s.defectsReopened,1);assert.ok(s.avgCompletionHours>0);
 const pc=await new Client().login(account('portfolio_owner'));
 const previous=(await pool.query("SELECT module,enabled,override_state FROM module_entitlements WHERE organization_id=$1 AND module IN('finance','handover')",[org])).rows;
 try{
  // Earlier full-suite checks may leave explicit enabled overrides. Disable the
  // effective policy rather than only its legacy boolean.
  await pool.query("UPDATE module_entitlements SET override_state='enabled' WHERE organization_id=$1 AND module IN('finance','handover')",[org]);
  await pool.query("UPDATE module_entitlements SET enabled=false,override_state='disabled' WHERE organization_id=$1 AND module='finance'",[org]);
  assert.equal((await pc.call('/portfolio/analytics?'+filters)).status,403,'Report permission cannot bypass disabled finance');
  await pool.query("UPDATE module_entitlements SET enabled=false,override_state='disabled' WHERE organization_id=$1 AND module='handover'",[org]);
  assert.equal((await pc.call('/contractors/scorecard?'+filters)).status,403,'Scorecard respects the disabled source module');
 }finally{for(const row of previous)await pool.query('UPDATE module_entitlements SET enabled=$3,override_state=$4 WHERE organization_id=$1 AND module=$2',[org,row.module,row.enabled,row.override_state])}
});
