import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {spawn,type ChildProcess} from 'node:child_process';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
import {startRoute,viewRoute} from '../../shared/products.js';
import {deliverEmail,emailProviderState} from '../email.js';

if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))
 throw new Error('Phase 1 checks require the isolated test database');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const server=app.listen(0,'127.0.0.1');
let base='';
class Client{
 cookie='';csrf='';contextId='';
 async call(path:string,method='GET',body?:unknown){
  const response=await fetch(base+'/api'+path,{method,headers:{
   'Content-Type':'application/json',...(this.cookie?{Cookie:this.cookie}:{}),
   ...(method==='GET'?{}:{'X-CSRF-Token':this.csrf})
  },...(body===undefined?{}:{body:JSON.stringify(body)})});
  const cookies=response.headers.getSetCookie();
  if(cookies.length)this.cookie=cookies.map(s=>s.split(';')[0]).join('; ');
  const data=response.status===204?null:await response.json();
  if(data?.csrf)this.csrf=data.csrf;
  return {status:response.status,data};
 }
 async login(key:string){
  await this.call('/auth/session');
  const a=seeded.accounts[key];
  const result=await this.call('/auth/login','POST',{email:a.email,password:a.password});
  assert.equal(result.status,200);
  const c=result.data.contexts.find((c:any)=>c.role_key===a.role);
  assert.ok(c);
  assert.equal((await this.call('/auth/context','POST',{id:c.id})).status,200);
  this.contextId=c.id;
  return this;
 }
}
const clients:Record<string,Client>={};
async function freePort(){
 const listener=createServer();
 await new Promise<void>((resolveListen,reject)=>listener.listen(0,'127.0.0.1',error=>error?reject(error):resolveListen()));
 const port=(listener.address() as {port:number}).port;
 await new Promise<void>((resolveClose,reject)=>listener.close(error=>error?reject(error):resolveClose()));
 return port;
}
function parseCsv(source:string){
 const rows:string[][]=[],row:string[]=[];let value='',quoted=false;
 for(let i=0;i<source.length;i++){
  const char=source[i];
  if(quoted){
   if(char==='"'&&source[i+1]==='"'){value+='"';i++}
   else if(char==='"')quoted=false;
   else value+=char;
  }else if(char==='"')quoted=true;
  else if(char===','){row.push(value);value=''}
  else if(char==='\n'){row.push(value);rows.push([...row]);row.length=0;value=''}
  else if(char!=='\r')value+=char;
 }
 if(value||row.length){row.push(value);rows.push(row)}
 return rows;
}
before(async()=>{
 await new Promise<void>(resolve=>server.listening?resolve():server.on('listening',resolve));
 base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 await pool.query('DELETE FROM auth_rate_limits');
 for(const key of ['platform_admin','org_admin','support'])clients[key]=await new Client().login(key);
});
after(async()=>{server.close();server.closeAllConnections();await pool.end()});

test('API allows credentialed CORS only for the configured frontend origin',async()=>{
 const preflight=await fetch(base+'/api/auth/login',{method:'OPTIONS',headers:{
  Origin:config.APP_ORIGIN,
  'Access-Control-Request-Method':'POST',
  'Access-Control-Request-Headers':'content-type,x-csrf-token',
 }});
 assert.equal(preflight.status,204);
 assert.equal(preflight.headers.get('access-control-allow-origin'),config.APP_ORIGIN);
 assert.equal(preflight.headers.get('access-control-allow-credentials'),'true');
 assert.match(preflight.headers.get('access-control-allow-methods')??'',/POST/);
 assert.match(preflight.headers.get('access-control-allow-headers')??'',/x-csrf-token/i);

 const session=await fetch(base+'/api/auth/session',{headers:{Origin:config.APP_ORIGIN}});
 assert.equal(session.status,200);
 assert.equal(session.headers.get('access-control-allow-origin'),config.APP_ORIGIN);
 assert.equal(session.headers.get('access-control-allow-credentials'),'true');
 assert.ok(session.headers.get('set-cookie')?.includes('vernatun.sid='));

 const denied=await fetch(base+'/api/auth/session',{headers:{Origin:'https://untrusted.example'}});
 assert.equal(denied.headers.get('access-control-allow-origin'),null);
});

test('Platform invitation list and revocation use platform.invite, while organization scope stays isolated',async()=>{
 const platform=clients.platform_admin,org=clients.org_admin;
 const pc=(await platform.call('/auth/session')).data.contexts.find((c:any)=>c.id===platform.contextId);
 assert.ok(pc.permissions.includes('platform.invite'));
 assert.equal(pc.permissions.includes('people.invite'),false);
 const a=await platform.call('/invitations','POST',{email:randomUUID()+'@example.test',role:'org_admin',organizationId:seeded.fixtures.orgA});
 const b=await platform.call('/invitations','POST',{email:randomUUID()+'@example.test',role:'org_admin',organizationId:seeded.fixtures.orgB});
 assert.equal(a.status,201);assert.equal(b.status,201);
 const all=await platform.call('/invitations');
 assert.equal(all.status,200);
 assert.ok(all.data.some((i:any)=>i.id===a.data.id)&&all.data.some((i:any)=>i.id===b.data.id));
 const own=await org.call('/invitations');
 assert.equal(own.status,200);
 assert.ok(own.data.some((i:any)=>i.id===a.data.id));
 assert.equal(own.data.some((i:any)=>i.id===b.data.id),false);
 assert.ok(own.data.every((i:any)=>i.organization_id===seeded.fixtures.orgA));
 assert.equal((await org.call('/invitations/'+b.data.id,'DELETE')).status,404);
 assert.equal((await platform.call('/invitations/'+b.data.id,'DELETE')).status,204);
 const event=(await pool.query("SELECT organization_id FROM audit_events WHERE action='invitation.revoke' AND entity_id=$1",[b.data.id])).rows[0];
 assert.equal(event.organization_id,seeded.fixtures.orgB);
});
test('Platform can invite organization roles and Vernatun support without creating a second platform administrator',async()=>{
 const platform=clients.platform_admin,org=clients.org_admin;
 const tag=randomUUID(),email=`support-${tag}@example.test`,password='Temporary-Test-Only-0000';
 const employee=await platform.call('/invitations','POST',{email,role:'support'});
 assert.equal(employee.status,201);assert.equal(employee.data.organization_id,null);
 const rotated=await platform.call('/invitations/'+employee.data.id+'/resend','POST',{});
 assert.equal(rotated.status,200);
 const listed=await platform.call('/invitations');
 assert.equal(listed.status,200);assert.ok(listed.data.some((row:any)=>row.id===employee.data.id&&row.role_key==='support'&&row.organization_id===null));
 const token=new URL(rotated.data.url).searchParams.get('token'),guest=new Client();await guest.call('/auth/session');
 assert.equal((await guest.call('/auth/accept-invitation','POST',{token,name:'Vernatun Support',password})).status,200);
 const login=await guest.call('/auth/login','POST',{email,password});assert.equal(login.status,200);
 assert.ok(login.data.contexts.some((item:any)=>item.role_key==='support'&&item.organization_id===null));
 const user=(await pool.query('SELECT id FROM users WHERE email=$1',[email])).rows[0];
 assert.equal((await pool.query('SELECT role_key,organization_id FROM role_assignments WHERE user_id=$1',[user.id])).rows[0].role_key,'support');
 assert.equal((await pool.query('SELECT count(*)::int AS count FROM memberships WHERE user_id=$1',[user.id])).rows[0].count,0);
 const users=await platform.call('/iam/users?q='+encodeURIComponent(email));
 assert.equal(users.status,200);assert.ok(users.data.rows[0].assignments.some((a:any)=>a.role_key==='support'&&a.organization_id===null));
 assert.equal((await platform.call('/invitations','POST',{email:`admin-${tag}@example.test`,role:'platform_admin'})).status,403);
 const companyRole=await platform.call('/invitations','POST',{email:`manager-${tag}@example.test`,role:'manager',organizationId:seeded.fixtures.orgA,buildingId:seeded.fixtures.ba});
 assert.equal(companyRole.status,201);assert.equal(companyRole.data.organization_id,seeded.fixtures.orgA);assert.equal(companyRole.data.role_key,'manager');
 assert.equal((await org.call('/invitations','POST',{email:`support-org-${tag}@example.test`,role:'support'})).status,403);
});

test('Platform user directory supports creation-date filters and an audited formula-safe CSV export',async()=>{
 const platform=clients.platform_admin,org=clients.org_admin,user=seeded.accounts.platform_admin;
 const day=(await pool.query("SELECT (created_at AT TIME ZONE 'Asia/Yerevan')::date::text AS day FROM users WHERE id=$1",[user.id])).rows[0].day;
 const query=new URLSearchParams({q:user.email,createdFrom:day,createdTo:day});
 const filtered=await platform.call('/iam/users?'+query.toString());
 assert.equal(filtered.status,200);
 assert.ok(filtered.data.rows.some((row:any)=>row.id===user.id&&row.created_at));
 const excluded=await platform.call('/iam/users?'+new URLSearchParams({q:user.email,createdFrom:'1900-01-01',createdTo:'1900-01-02'}));
 assert.equal(excluded.status,200);assert.equal(excluded.data.total,0);
 assert.equal((await platform.call('/iam/users?createdFrom=2026-10-30&createdTo=2026-10-01')).status,400);

 const original=(await pool.query('SELECT name FROM users WHERE id=$1',[user.id])).rows[0].name;
 await pool.query('UPDATE users SET name=$2 WHERE id=$1',[user.id,'=HYPERLINK("https://example.test")']);
 try{
  const response=await fetch(base+'/api/iam/users/export.csv?'+query.toString(),{headers:{Cookie:platform.cookie}});
  assert.equal(response.status,200);assert.match(response.headers.get('content-type')??'',/text\/csv/i);
  assert.match(response.headers.get('content-disposition')??'',/vernatun-users\.csv/);
  const csv=await response.text();
  assert.ok(csv.startsWith('"name","email","access","account_status","mfa_enabled","created_at"'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes(user.email));
  const audit=(await pool.query("SELECT details FROM audit_events WHERE action='iam.users.export' AND actor_user_id=$1 ORDER BY created_at DESC LIMIT 1",[user.id])).rows[0];
  assert.deepEqual(audit.details,{rows:1,searchApplied:true,createdFrom:day,createdTo:day});
 }finally{await pool.query('UPDATE users SET name=$2 WHERE id=$1',[user.id,original])}
 const denied=await fetch(base+'/api/iam/users/export.csv',{headers:{Cookie:org.cookie}});
 assert.equal(denied.status,403);
  const invalidExport=await fetch(base+'/api/iam/users/export.csv?createdFrom=2026-10-30&createdTo=2026-10-01',{headers:{Cookie:platform.cookie}});
  assert.equal(invalidExport.status,400);
});

test('Platform user filters, pagination and CSV export work in the authenticated browser',async()=>{
 const tag='qa223-'+randomUUID(),startDay='2025-01-10',endDay='2025-01-11';
 const marker=`${tag}-boundary`;
 const platformAdminId=seeded.accounts.platform_admin.id;
 const originalLocale=(await pool.query('SELECT locale FROM users WHERE id=$1',[platformAdminId])).rows[0].locale;
 await pool.query("UPDATE users SET locale='en' WHERE id=$1",[platformAdminId]);
 await pool.query(`INSERT INTO users(email,name,password_hash,created_at)
  SELECT $1||'-list-'||lpad(n::text,2,'0')||'@example.test','QA223 Directory '||lpad(n::text,2,'0'),'test-only-hash',now()-make_interval(days=>n)
  FROM generate_series(1,55) AS n`,[tag]);
 await pool.query(`INSERT INTO users(email,name,password_hash,created_at) VALUES
  ($1||'-start@example.test','QA223 boundary start','test-only-hash',$2::timestamptz),
  ($1||'-end@example.test','QA223 boundary end','test-only-hash',$3::timestamptz),
  ($1||'-before@example.test','QA223 boundary before','test-only-hash',$4::timestamptz),
  ($1||'-after@example.test','QA223 boundary after','test-only-hash',$5::timestamptz),
  ($6||'@example.test','QA223 unrelated','test-only-hash',$2::timestamptz)`,
 [marker,startDay+'T06:00:00Z',endDay+'T06:00:00Z','2025-01-09T06:00:00Z','2025-01-12T06:00:00Z',tag+'-unrelated']);

 const port=await freePort(),webDir=resolve(process.cwd(),'../../../vernatun'),viteBin=resolve(webDir,'node_modules/vite/bin/vite.js');
 let web:ChildProcess|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
 try{
  web=spawn(process.execPath,[viteBin,'--host','127.0.0.1','--port',String(port),'--strictPort'],{
   cwd:webDir,env:{...process.env,PORT:String(port),BASE_PATH:'/',API_PROXY_TARGET:base},stdio:'ignore',
  });
  const started=Date.now();
  while(Date.now()-started<30000){
   if(web.exitCode!==null)throw new Error(`Vite exited with code ${web.exitCode}`);
   try{if((await fetch(`http://127.0.0.1:${port}/`)).ok)break}catch{}
   await new Promise(resolveWait=>setTimeout(resolveWait,200));
  }
  assert.ok(Date.now()-started<30000,'Vernatun UI server did not become ready');
  browser=await chromium.launch({headless:true,executablePath:process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
  const context=await browser.newContext({acceptDownloads:true});
  const cookie=clients.platform_admin.cookie.split(';').map(part=>part.trim()).find(part=>part.startsWith('vernatun.sid='));
  assert.ok(cookie,'Platform admin test session cookie must exist');
  await context.addCookies([{name:'vernatun.sid',value:cookie.slice('vernatun.sid='.length),url:`http://127.0.0.1:${port}`}]);
  await context.addInitScript(()=>localStorage.setItem('vernatun.language','en'));
  const page=await context.newPage();
  const browserErrors:string[]=[];
  page.on('pageerror',error=>browserErrors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')browserErrors.push(message.text())});
  page.on('response',response=>{if(response.url().includes('/api/')&&response.status()>=400)browserErrors.push(`API ${response.status()} ${response.url()}`)});
  await page.goto(`http://127.0.0.1:${port}/console/users`);
  try{await page.getByRole('heading',{name:'Users',exact:true}).waitFor({timeout:15000})}
  catch(error){
   throw new Error(`Authenticated users page did not render. URL: ${page.url()}; body: ${(await page.locator('body').innerText()).slice(0,1600)}; browser/API logs: ${browserErrors.join(' | ')}`,{cause:error});
  }
  const tableRows=page.locator('.iam-table tbody tr');
  await tableRows.nth(49).waitFor({timeout:15000});
  const pagination=page.locator('.iam-main .p-card .iam-row').last();
  const firstPage=await pagination.innerText();
  assert.match(firstPage,/1–50/);
  assert.ok(Number(firstPage.match(/\/ (\d+)/)?.[1])>50,'Pagination must be available with more than 50 matching users');
  assert.equal(await tableRows.count(),50);
  await page.getByRole('button',{name:'Next'}).click();
  await page.waitForFunction(()=>document.querySelector('.iam-main .p-card > .iam-row:last-child')?.textContent?.includes('51–'));
  assert.ok(await tableRows.count()>0&&await tableRows.count()<50);
  await page.getByRole('button',{name:'Previous'}).click();
  await page.waitForFunction(()=>document.querySelector('.iam-main .p-card > .iam-row:last-child')?.textContent?.includes('1–50 /'));

  await page.getByRole('textbox',{name:'Name or email'}).fill(marker);
  await page.getByLabel('Created from').fill(startDay);
  await page.getByLabel('Created through').fill(endDay);
  await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.iam-main .p-card > .iam-row:last-child')?.textContent?.includes('1–2 / 2'));
  const displayed=await tableRows.allInnerTexts();
  assert.equal(displayed.length,2);
  assert.ok(displayed.some(row=>row.includes(`${marker}-start@example.test`)),'the starting date is inclusive');
  assert.ok(displayed.some(row=>row.includes(`${marker}-end@example.test`)),'the ending date is inclusive');
  assert.ok(displayed.every(row=>!row.includes('-before@example.test')&&!row.includes('-after@example.test')));
  assert.equal(await page.getByRole('button',{name:'Previous'}).isDisabled(),true);

  const [download]=await Promise.all([
   page.waitForEvent('download'),
   page.getByRole('button',{name:'Export users'}).click(),
  ]);
  assert.equal(download.suggestedFilename(),'vernatun-users.csv');
  const downloadedPath=await download.path();
  assert.ok(downloadedPath,'The CSV download must be saved and readable');
  const downloaded=(await readFile(downloadedPath,'utf8')).replace(/^\uFEFF/,'');
  const csvRows=parseCsv(downloaded);
  assert.deepEqual(csvRows[0],['name','email','access','account_status','mfa_enabled','created_at']);
  assert.equal(csvRows.length,3,'The exported file contains exactly the two filtered records');
  const exportedEmails=csvRows.slice(1).map(row=>row[1]).sort();
  assert.deepEqual(exportedEmails,[`${marker}-end@example.test`,`${marker}-start@example.test`].sort());
  assert.ok(!downloaded.includes(`${marker}-before@example.test`));
  assert.ok(!downloaded.includes(`${marker}-after@example.test`));

  await page.getByLabel('Created from').fill('2025-01-12');
  await page.getByLabel('Created through').fill(endDay);
  await page.getByRole('button',{name:'Search',exact:true}).click();
  assert.match(await page.getByRole('alert').innerText(),/Start date must be on or before end date/);
  assert.equal(await tableRows.count(),2,'An invalid date range must not replace the last valid results');
  assert.match(await pagination.innerText(),/1–2 \/ 2/);

  await page.route('**/api/iam/users/export.csv*',route=>route.fulfill({
   status:503,contentType:'application/json',body:JSON.stringify({error:'service_unavailable'}),
  }));
  await page.getByRole('button',{name:'Export users'}).click();
  const exportAlert=page.getByRole('alert').last();
  await exportAlert.waitFor({timeout:5000});
  assert.ok((await exportAlert.innerText()).trim().length>0,'Export failures must show a readable error');
  await page.unroute('**/api/iam/users/export.csv*');
 }finally{
  await browser?.close();
  if(web&&web.exitCode===null){
   const exited=new Promise<void>(resolveExit=>web!.once('exit',()=>resolveExit()));
   web.kill('SIGTERM');
   await exited;
  }
  await pool.query('DELETE FROM users WHERE email LIKE $1',[`${tag}-%@example.test`]);
  await pool.query('UPDATE users SET locale=$2 WHERE id=$1',[platformAdminId,originalLocale]);
 }
});

test('Platform audit includes organization events and structured details without leaking another organization to org admin',async()=>{
 const first=randomUUID(),second=randomUUID();
 await pool.query(`INSERT INTO audit_events(organization_id,actor_user_id,action,entity_type,entity_id,details)
  VALUES($1,$2,'qa.phase1','organization',$3,'{"previous":"active","new":"suspended"}'),
  ($4,$2,'qa.phase1','organization',$5,'{"reason":"isolated regression"}')`,
 [seeded.fixtures.orgA,seeded.accounts.platform_admin.id,first,seeded.fixtures.orgB,second]);
 const all=await clients.platform_admin.call('/audit');
 assert.equal(all.status,200);
 const own=all.data.find((e:any)=>e.entity_id===first);
 assert.ok(own);assert.equal(own.organization_id,seeded.fixtures.orgA);
 assert.deepEqual(own.details,{previous:'active',new:'suspended'});
 assert.ok(all.data.some((e:any)=>e.entity_id===second));
 const limited=await clients.org_admin.call('/audit');
 assert.equal(limited.status,200);
 assert.ok(limited.data.some((e:any)=>e.entity_id===first));
 assert.equal(limited.data.some((e:any)=>e.entity_id===second),false);
});

test('Approved temporary support context starts on its permitted import screen, not the forbidden grants screen',async()=>{
 const support=clients.support;
 const requested=await support.call('/support/grants','POST',{organizationId:seeded.fixtures.orgA,reason:'Scoped import regression check',permissions:['imports.manage'],hours:1});
 assert.equal(requested.status,201);
 assert.equal((await clients.org_admin.call('/support/grants/'+requested.data.id+'/approve','POST',{})).status,200);
 try{
  assert.equal((await support.call('/auth/context','POST',{id:requested.data.id})).status,200);
  const session=(await support.call('/auth/session')).data;
  const c=session.contexts.find((c:any)=>c.id===session.contextId);
  assert.deepEqual(c.permissions,['imports.manage']);
  assert.equal(c.startRoute,'/console/imports');
  assert.equal(viewRoute('console','overview','support',c),'/console/imports');
  assert.equal((await support.call('/imports')).status,200);
  assert.equal((await support.call('/support/grants')).status,403);
  assert.equal((await support.call('/invoices')).status,403);
  await pool.query("UPDATE support_access_grants SET expires_at=now()-interval '1 minute' WHERE id=$1",[requested.data.id]);
  assert.equal((await support.call('/imports')).status,403);
 }finally{await support.call('/auth/context','POST',{id:support.contextId})}
});

test('Temporary support start routes honor the exact permissions and disabled modules; ordinary support route is preserved',()=>{
 assert.equal(startRoute('support',{organization_id:seeded.fixtures.orgA,permissions:['properties.read']}),'/console/properties');
 assert.equal(startRoute('support',{organization_id:seeded.fixtures.orgA,permissions:['requests.read'],modules:['requests']}),'/console/requests');
 assert.equal(startRoute('support',{organization_id:seeded.fixtures.orgA,permissions:['requests.read'],modules:[]}),'/context');
 assert.equal(startRoute('support',{organization_id:null,permissions:['support.access.request']}),'/console/onboarding');
});

test('Audit rejects UPDATE, DELETE and TRUNCATE at database level, including inside a transaction',async()=>{
 const inserted=(await pool.query("INSERT INTO audit_events(action,entity_type) VALUES('qa.immutable','test') RETURNING id")).rows[0];
 for(const statement of [
  `UPDATE audit_events SET action='changed' WHERE id='${inserted.id}'`,
  `DELETE FROM audit_events WHERE id='${inserted.id}'`,
  'TRUNCATE audit_events CASCADE'
 ]){
  const db=await pool.connect();
  try{await db.query('BEGIN');await assert.rejects(db.query(statement),(e:any)=>e.code==='23514'&&e.message==='Audit events are append-only')}
  finally{await db.query('ROLLBACK');db.release()}
 }
 assert.equal((await pool.query('SELECT action FROM audit_events WHERE id=$1',[inserted.id])).rows[0].action,'qa.immutable');
});

test('Audit pagination and all principal filters are server-side, bounded and tenant-isolated',async()=>{
 const event=(await pool.query(`INSERT INTO audit_events(organization_id,actor_user_id,action,entity_type,entity_id,details)
  VALUES($1,$2,'qa.filtered.failed','test','filter-fixture','{"result":"failure"}') RETURNING id`,
 [seeded.fixtures.orgB,seeded.accounts.platform_admin.id])).rows[0];
 const query=new URLSearchParams({paged:'true',page:'1',pageSize:'1',organizationId:seeded.fixtures.orgB,
  actorId:seeded.accounts.platform_admin.id,action:'qa.filtered.failed',entityType:'test',result:'failure',
  from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+86400000).toISOString(),sort:'created_at',direction:'desc'});
 const filtered=await clients.platform_admin.call('/audit?'+query);
 assert.equal(filtered.status,200);assert.equal(filtered.data.total,1);
 assert.equal(filtered.data.items[0].id,event.id);assert.equal(filtered.data.pageSize,1);
 assert.equal((await clients.org_admin.call('/audit?'+query)).status,403);
 assert.equal((await clients.platform_admin.call('/audit?paged=true&pageSize=1000')).status,400);
});

test('Resend rotates a pending invitation, invalidates the old link and never resurrects a revoked invitation',async()=>{
 const platform=clients.platform_admin;
 const created=await platform.call('/invitations','POST',{email:randomUUID()+'@example.test',role:'org_admin',organizationId:seeded.fixtures.orgA});
 assert.equal(created.status,201);assert.equal(created.data.delivery,'local_only');
 const oldToken=new URL(created.data.url).searchParams.get('token');
 const resent=await platform.call('/invitations/'+created.data.id+'/resend','POST',{});
 assert.equal(resent.status,200);assert.equal(resent.data.delivery,'local_only');
 assert.notEqual(new URL(resent.data.url).searchParams.get('token'),oldToken);
 const invalid=await platform.call('/auth/accept-invitation','POST',{token:oldToken,name:'Invalid old invitation',password:'Temporary-Test-Only-0000'});
 assert.equal(invalid.status,400);assert.equal(invalid.data.error,'token_invalid');
 const rows=(await platform.call('/invitations')).data;
 assert.equal(rows.find((i:any)=>i.id===created.data.id).email_delivery_status,'local');
 assert.equal((await platform.call('/invitations/'+created.data.id,'DELETE')).status,204);
 assert.equal((await platform.call('/invitations/'+created.data.id+'/resend','POST',{})).status,409);
});

test('SMTP abstraction only reports actual server acceptance, never leaks a live token, and forbids production outbox',async()=>{
 const settings={mode:'production',provider:'smtp',host:'smtp.example.test',port:587,from:'noreply@example.test',user:'fake-qa-user',password:'fake-qa-password'};
 const message={to:'recipient@example.test',subject:'QA',text:'Not sent outside the test',url:'https://example.test/accept-invitation?token=test'};
 const delivered=await deliverEmail(message,'invitation-'+randomUUID(),{settings,transport:{sendMail:async()=>({accepted:[message.to],rejected:[]})}});
 assert.equal(delivered.delivery,'smtp_accepted');assert.equal('url' in delivered,false);
 await assert.rejects(deliverEmail(message,'invitation-'+randomUUID(),{settings,transport:{sendMail:async()=>({accepted:[],rejected:[message.to]})}}),(e:any)=>e.code==='email_delivery_failed');
 assert.equal(emailProviderState({mode:'production',provider:'outbox'}),'not_configured');
 assert.equal(emailProviderState({mode:'production',provider:'smtp',host:'smtp.example.test',port:587,from:'noreply@example.test'}),'not_configured');
 await assert.rejects(deliverEmail(message,'invitation-'+randomUUID(),{settings:{mode:'production',provider:'outbox'}}),(e:any)=>e.code==='email_not_configured');
});

test('Plan modules, override reasons, building limit, grace and read-only cancellation are enforced without deleting history',async()=>{
 const platform=clients.platform_admin,org=clients.org_admin,accountant=await new Client().login('accountant');
 const initialCount=Number((await pool.query('SELECT count(*) FROM buildings WHERE organization_id=$1',[seeded.fixtures.orgA])).rows[0].count);
 const plan=await platform.call('/subscription-plans','POST',{name:'Isolated foundation plan',amountMinor:'10000',currency:'AMD',
  buildingLimit:initialCount,allowedModules:['requests'],graceDays:7});
 assert.equal(plan.status,201);
 const day=(offset:number)=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
 const subscription=await platform.call('/subscriptions','POST',{organizationId:seeded.fixtures.orgA,planId:plan.data.id,startsOn:day(-1),endsOn:day(365),status:'trial'});
 assert.equal(subscription.status,201);
 try{
  const policy=(await platform.call('/organizations/'+seeded.fixtures.orgA+'/subscription-policy')).data;
  assert.equal(policy.enforced,true);assert.equal(policy.state,'trial');assert.equal(policy.readOnly,false);
  assert.equal((await accountant.call('/invoices')).status,403);
  assert.equal((await org.call('/properties','POST',{name:'Blocked quota building',address:'Isolated quota test only'})).status,409);
  const allowedModules=await org.call('/modules');
  assert.equal(allowedModules.status,200);
  assert.equal(allowedModules.data.enforced,true);
  assert.deepEqual(allowedModules.data.modules.map((m:any)=>m.module),['requests']);
  assert.equal(allowedModules.data.readOnly,false);
  const requestVersion=allowedModules.data.modules[0].updatedAt;
  const concurrent=await Promise.all([
   org.call('/modules/requests','PATCH',{enabled:false,expectedUpdatedAt:requestVersion}),
   org.call('/modules/requests','PATCH',{enabled:true,expectedUpdatedAt:requestVersion}),
  ]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  const refreshed=await org.call('/modules');
  assert.notEqual(refreshed.data.modules[0].updatedAt,requestVersion);
  assert.equal((await org.call('/modules/requests','PATCH',{enabled:!refreshed.data.modules[0].enabled,expectedUpdatedAt:requestVersion})).status,409);
  assert.equal((await accountant.call('/modules/requests','PATCH',{enabled:false,expectedUpdatedAt:refreshed.data.modules[0].updatedAt})).status,403);
  assert.equal((await org.call('/modules/not-a-core-module','PATCH',{enabled:true,expectedUpdatedAt:refreshed.data.modules[0].updatedAt})).status,400);
  const enabledNow=await org.call('/modules');
  const requestsNow=enabledNow.data.modules[0];
  if(!requestsNow.enabled)assert.equal((await org.call('/modules/requests','PATCH',{enabled:true,expectedUpdatedAt:requestsNow.updatedAt})).status,200);
  const moduleAudit=(await pool.query("SELECT organization_id,details FROM audit_events WHERE action='module.update' AND entity_id='requests' ORDER BY created_at DESC LIMIT 1")).rows[0];
  assert.equal(moduleAudit.organization_id,seeded.fixtures.orgA);
  assert.ok(moduleAudit.details.after);
  const override='/organizations/'+seeded.fixtures.orgA+'/module-overrides/finance';
  assert.equal((await platform.call(override,'PATCH',{state:'enabled',reason:'short'})).status,400);
  assert.equal((await platform.call(override,'PATCH',{state:'enabled',reason:'Explicit isolated override'})).status,200);
  assert.equal((await accountant.call('/invoices')).status,200);
  assert.equal((await org.call('/modules/finance','PATCH',{enabled:true,expectedUpdatedAt:new Date().toISOString()})).status,403);
  assert.equal((await platform.call('/subscriptions/'+subscription.data.id,'PATCH',{status:'past_due',reason:'Test elapsed grace policy',graceUntil:new Date(Date.now()-1000).toISOString()})).status,200);
  const restrictedModules=await org.call('/modules');
  assert.equal(restrictedModules.data.readOnly,true);
  assert.equal((await org.call('/modules/requests','PATCH',{enabled:!restrictedModules.data.modules[0].enabled,expectedUpdatedAt:restrictedModules.data.modules[0].updatedAt})).status,403);
  const blocked=await org.call('/invitations','POST',{email:randomUUID()+'@example.test',role:'manager'});
  assert.equal(blocked.status,403);assert.equal(blocked.data.error,'subscription_restricted');
  assert.equal((await org.call('/invitations')).status,200);
  assert.equal((await platform.call('/subscriptions/'+subscription.data.id,'PATCH',{status:'past_due',reason:'Test active grace policy',graceUntil:new Date(Date.now()+60000).toISOString()})).status,200);
  assert.equal((await org.call('/invitations','POST',{email:randomUUID()+'@example.test',role:'manager'})).status,201);
  const invoices=Number((await pool.query('SELECT count(*) FROM invoices WHERE organization_id=$1',[seeded.fixtures.orgA])).rows[0].count);
  assert.equal((await platform.call('/subscriptions/'+subscription.data.id,'PATCH',{status:'cancelled',reason:'Test no destructive suspension'})).status,200);
  assert.equal((await accountant.call('/invoices')).status,200);
  assert.equal(Number((await pool.query('SELECT count(*) FROM invoices WHERE organization_id=$1',[seeded.fixtures.orgA])).rows[0].count),invoices);
  assert.equal((await platform.call('/subscriptions/'+subscription.data.id,'PATCH',{status:'active',reason:'Forbidden historical resurrection'})).status,409);
  const other=(await platform.call('/organizations/'+seeded.fixtures.orgB+'/subscription-policy')).data;
  assert.equal(other.enforced,false);assert.equal(other.readOnly,false);
 }finally{
  await platform.call('/organizations/'+seeded.fixtures.orgA+'/subscription-policy','PATCH',{enabled:false,reason:'Restore isolated fixture legacy access'});
 }
});

test('Concurrent expiry housekeeping emits one audit event per support grant and no grant survives its deadline',async()=>{
 const support=clients.support;
 const g=await support.call('/support/grants','POST',{organizationId:seeded.fixtures.orgA,reason:'Concurrent expiry regression',permissions:['properties.read'],hours:1});
 assert.equal(g.status,201);
 assert.equal((await clients.org_admin.call('/support/grants/'+g.data.id+'/approve','POST',{})).status,200);
 await pool.query("UPDATE support_access_grants SET expires_at=now()-interval '1 second' WHERE id=$1",[g.data.id]);
 await Promise.all(Array.from({length:8},()=>pool.query('SELECT expire_support_grants($1)',[seeded.accounts.support.id])));
 assert.equal(Number((await pool.query("SELECT count(*) FROM audit_events WHERE action='support.expire' AND entity_id=$1",[g.data.id])).rows[0].count),1);
 const session=(await support.call('/auth/session')).data;
 assert.equal(session.contexts.some((c:any)=>c.id===g.data.id),false);
});

test('Resuming a suspended subscription cannot overlap another contract; explicit null removes grace',async()=>{
 const platform=clients.platform_admin,org=seeded.fixtures.orgB;
 const plan=await platform.call('/subscription-plans','POST',{name:'Isolated overlapping plans',amountMinor:'0',currency:'AMD',buildingLimit:100,allowedModules:['requests'],graceDays:7});
 const body={organizationId:org,planId:plan.data.id,startsOn:new Date(Date.now()-86400000).toISOString().slice(0,10),endsOn:new Date(Date.now()+365*86400000).toISOString().slice(0,10)};
 const first=await platform.call('/subscriptions','POST',body);assert.equal(first.status,201);
 try{
  assert.equal((await platform.call('/subscriptions/'+first.data.id,'PATCH',{status:'suspended',reason:'Isolated contract suspension'})).status,200);
  const second=await platform.call('/subscriptions','POST',body);assert.equal(second.status,201);
  const resume=await platform.call('/subscriptions/'+first.data.id,'PATCH',{status:'active',reason:'Must reject overlapping resumption'});
  assert.equal(resume.status,409);assert.equal(resume.data.error,'subscription_overlap');
  assert.equal((await platform.call('/subscriptions/'+second.data.id,'PATCH',{status:'past_due',reason:'Explicitly remove temporary grace',graceUntil:null})).data.grace_until,null);
  assert.equal((await platform.call('/organizations/'+org+'/subscription-policy')).data.readOnly,true);
 }finally{await platform.call('/organizations/'+org+'/subscription-policy','PATCH',{enabled:false,reason:'Restore isolated fixture legacy access'})}
});
