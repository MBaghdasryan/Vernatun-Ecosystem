import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import {resolve} from 'node:path';
import {chromium,type Browser,type Page} from 'playwright';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';

if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Isolated database required');
const seed=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const server=app.listen(0,'127.0.0.1');
let base='';
let org='',building='',unit='',familyOrg='',familyUnit='',foreignOrg='',foreignUnit='';
let ownerNotices:{id:string;code:string;label:string;destination:string}[]=[];
let deniedNotice='',racingNotice='',racingInvoice='',familyNotice='',ownerUnreadBefore=0,familyUnreadBefore=0;
let web:ChildProcess|undefined,browser:Browser|undefined;
const webPort=4192;

const countFor=async(userId:string)=>Number((await pool.query(
 'SELECT count(*) FROM notifications WHERE user_id=$1 AND in_app_enabled AND read_at IS NULL AND (visible_after IS NULL OR visible_after<=now())',[userId],
)).rows[0].count);

async function signIn(page:Page,account:{email:string;password:string},contextLabel:string){
 await page.addInitScript(()=>localStorage.setItem('vernatun.language','en'));
 await page.goto(`http://127.0.0.1:${webPort}/login`,{waitUntil:'domcontentloaded'});
 await page.locator('input[name="email"]').fill(account.email);
 await page.locator('input[name="password"]').fill(account.password);
 await page.getByRole('button',{name:'Sign in'}).click();
 await page.waitForFunction(()=>location.pathname!=='/login',{timeout:15000});
 if(await page.locator('.p-context-grid').count()){
  await page.locator('.p-context-grid').getByRole('button').filter({hasText:contextLabel}).first().click();
  await page.waitForFunction(()=>!document.querySelector('.p-context-grid'));
 }
}

async function unread(page:Page){
 return page.evaluate(async()=>{
  const response=await fetch('/api/notifications/unread-count');
  if(!response.ok)throw new Error(`Unread count failed: ${response.status}`);
  return (await response.json()).unread as number;
 });
}

async function openNotifications(page:Page){
 await page.getByRole('button',{name:/Notifications/}).click();
 await page.locator('dialog[open]').getByRole('heading',{name:'Notifications'}).first().waitFor();
}

before(async()=>{
 await new Promise<void>(r=>server.listening?r():server.once('listening',r));
 base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 const ownerId=seed.accounts.unit_owner.id,familyId=seed.accounts.family.id;
 const ownerAssignment=(await pool.query(`SELECT organization_id,building_id,unit_id FROM role_assignments
  WHERE user_id=$1 AND role_key='unit_owner' AND active AND unit_id IS NOT NULL ORDER BY id LIMIT 1`,[ownerId])).rows[0];
 const familyAssignment=(await pool.query(`SELECT organization_id,building_id,unit_id FROM role_assignments
  WHERE user_id=$1 AND role_key='family' AND active AND unit_id IS NOT NULL ORDER BY id LIMIT 1`,[familyId])).rows[0];
 assert.ok(ownerAssignment,'Seeded unit owner assignment is required');
 assert.ok(familyAssignment,'Seeded family assignment is required');
 org=ownerAssignment.organization_id;building=ownerAssignment.building_id;unit=ownerAssignment.unit_id;
 familyOrg=familyAssignment.organization_id;familyUnit=familyAssignment.unit_id;
 await pool.query("UPDATE users SET locale='en' WHERE id=ANY($1::uuid[])",[[ownerId,familyId]]);
 const foreign=(await pool.query(`SELECT u.organization_id,u.id AS unit_id FROM units u
  WHERE u.organization_id<>$1 ORDER BY u.id LIMIT 1`,[org])).rows[0];
 assert.ok(foreign,'A foreign unit is required for the denied-destination fixture');
 foreignOrg=foreign.organization_id;foreignUnit=foreign.unit_id;
 const requestId=(await pool.query(`INSERT INTO resident_requests(organization_id,unit_id,author_user_id,subject)
  VALUES($1,$2,$3,'Notification navigation QA request') RETURNING id`,[org,unit,ownerId])).rows[0].id;
 const invoiceId=(await pool.query(`INSERT INTO invoices(organization_id,unit_id,payer_user_id,period,amount_minor,currency,status)
  VALUES($1,$2,$3,current_date,12345,'AMD','draft') RETURNING id`,[org,unit,ownerId])).rows[0].id;
 const deniedInvoiceId=(await pool.query(`INSERT INTO invoices(organization_id,unit_id,payer_user_id,period,amount_minor,currency,status)
  VALUES($1,$2,$3,current_date,23456,'AMD','draft') RETURNING id`,[foreignOrg,foreignUnit,ownerId])).rows[0].id;
 const ownerEvents=[
  {code:'request_created',kind:'request.created',type:'request',entity:requestId,label:'Request created',destination:`/imtun/requests?requestId=${requestId}`},
  {code:'new_charge',kind:'new_charge',type:'invoice',entity:invoiceId,label:'New charge',destination:'/imtun/finance'},
  {code:'account_security',kind:'account_security',type:'system',entity:null,label:'Account security',destination:'/imtun/settings'},
 ];
 for(const event of ownerEvents){
  const row=(await pool.query(`INSERT INTO notifications(user_id,organization_id,kind,event_code,entity_type,entity_id)
   VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[ownerId,org,event.kind,event.code,event.type,event.entity])).rows[0];
  ownerNotices.push({...event,id:row.id});
 }
 deniedNotice=(await pool.query(`INSERT INTO notifications(user_id,organization_id,kind,event_code,entity_type,entity_id)
  VALUES($1,$2,'new_charge','new_charge','invoice',$3) RETURNING id`,[ownerId,org,deniedInvoiceId])).rows[0].id;
 familyNotice=(await pool.query(`INSERT INTO notifications(user_id,organization_id,kind,event_code,entity_type)
  VALUES($1,$2,'account_security','account_security','system') RETURNING id`,[familyId,familyOrg])).rows[0].id;
 ownerUnreadBefore=await countFor(ownerId);
 familyUnreadBefore=await countFor(familyId);

 web=spawn(process.execPath,[resolve('../../../vernatun/node_modules/vite/bin/vite.js'),'--host','127.0.0.1'],{
  cwd:resolve('../../../vernatun'),
  env:{...process.env,PORT:String(webPort),BASE_PATH:'/',API_PROXY_TARGET:base},
  stdio:'ignore',
 });
 const started=Date.now();
 while(Date.now()-started<30000){
  if(web.exitCode!==null)throw new Error(`Vite exited with code ${web.exitCode}`);
  try{if((await fetch(`http://127.0.0.1:${webPort}/`)).ok)break}catch{}
  await new Promise(r=>setTimeout(r,200));
 }
 assert.ok(Date.now()-started<30000,'Vite UI server did not become ready');
 browser=await chromium.launch({headless:true,executablePath:process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
});

after(async()=>{
 await browser?.close();
 if(web&&!web.killed)web.kill('SIGTERM');
 await new Promise<void>(r=>server.close(()=>r()));
 await pool.end();
});

test('notification destinations mark request, finance and system events read; denied links preserve role and location',async()=>{
 const page=await browser!.newPage();
 try{
  const ownerAccount=seed.accounts.unit_owner;
  const ownerUnitNumber=(await pool.query('SELECT number FROM units WHERE id=$1',[unit])).rows[0].number;
  await signIn(page,ownerAccount,ownerUnitNumber);
  await openNotifications(page);
  const initialContext=(await page.evaluate(async()=>await (await fetch('/api/auth/session')).json())).contextId;
  assert.ok(initialContext);
  assert.equal(await unread(page),ownerUnreadBefore);

  let remaining=ownerUnreadBefore;
  for(const notice of ownerNotices){
    const card=page.locator('.p-message').filter({hasText:notice.label,hasNotText:'Access denied'}).first();
   await card.waitFor();
   const openButton=card.getByRole('button',{name:/Open as:/});
   assert.ok(await openButton.count(),`${notice.code} should have an authorized destination: ${await card.innerText()}`);
   await openButton.click();
   await page.waitForURL(url=>url.pathname+url.search===notice.destination,{timeout:10000});
   const readAt=(await pool.query('SELECT read_at FROM notifications WHERE id=$1',[notice.id])).rows[0].read_at;
   assert.ok(readAt,`${notice.code} should be marked read before navigation completes`);
   remaining--;
   assert.equal(await unread(page),remaining,`${notice.code} should decrement unread count`);
   await openNotifications(page);
  }

  await page.locator('dialog[open] button[aria-label="Close"]').click();
  await page.locator('dialog[open]').waitFor({state:'hidden'});
  racingInvoice=(await pool.query(`INSERT INTO invoices(organization_id,unit_id,payer_user_id,period,amount_minor,currency,status)
   VALUES($1,$2,$3,current_date,34567,'AMD','draft') RETURNING id`,[org,unit,ownerAccount.id])).rows[0].id;
  racingNotice=(await pool.query(`INSERT INTO notifications(user_id,organization_id,kind,event_code,entity_type,entity_id)
   VALUES($1,$2,'new_charge','new_charge','invoice',$3) RETURNING id`,[ownerAccount.id,org,racingInvoice])).rows[0].id;
  remaining++;
  assert.equal(await unread(page),remaining);
  await openNotifications(page);
  const pathBeforeRace=page.url();
  const contextBeforeRace=(await page.evaluate(async()=>await (await fetch('/api/auth/session')).json())).contextId;
   const racingCard=page.locator('.p-message').filter({hasText:'New charge',hasNotText:'Access denied'})
    .filter({hasText:'Mark as read'}).first();
  const racingOpen=racingCard.getByRole('button',{name:/Open as:/});
   await racingOpen.waitFor({state:'visible',timeout:10000});
  assert.ok(await racingOpen.count(),'The notification should initially show its authorized destination');
  await pool.query('UPDATE invoices SET organization_id=$2,unit_id=$3 WHERE id=$1',[racingInvoice,foreignOrg,foreignUnit]);
  await racingOpen.click();
  await page.getByRole('alert').waitFor();
  assert.equal(page.url(),pathBeforeRace,'A destination revoked after the list loads must not navigate');
  assert.equal((await page.evaluate(async()=>await (await fetch('/api/auth/session')).json())).contextId,contextBeforeRace,
   'A destination revoked after the list loads must not switch the active role');
  assert.equal((await pool.query('SELECT read_at FROM notifications WHERE id=$1',[racingNotice])).rows[0].read_at,null,
   'A destination that fails revalidation must remain unread');
  assert.equal(await unread(page),remaining,'A destination that fails revalidation must not decrement unread count');

  const denied=page.locator('.p-message').filter({hasText:'Access denied'}).first();
  await denied.waitFor();
  assert.equal(await denied.getByRole('button',{name:/Open as:/}).count(),0);
  const deniedResponse=await page.evaluate(async(id)=>{
   const response=await fetch(`/api/notifications/${id}/destination`);
   return response.status;
  },deniedNotice);
  assert.equal(deniedResponse,403);
  await denied.getByRole('button',{name:'Mark as read'}).click();
  const pathBeforeDeniedAction=page.url();
  await page.waitForFunction(path=>location.href===path,pathBeforeDeniedAction);
  const contextAfter=(await page.evaluate(async()=>await (await fetch('/api/auth/session')).json())).contextId;
  assert.equal(contextAfter,initialContext,'A denied destination must not switch the active role');
  assert.equal(page.url(),pathBeforeDeniedAction,'A denied destination must not navigate');
  assert.ok((await pool.query('SELECT read_at FROM notifications WHERE id=$1',[deniedNotice])).rows[0].read_at);
  assert.equal(await unread(page),remaining-1);
 }finally{
  await page.close();
 }
});

test('family role can open and read an in-app system notification',async()=>{
 const page=await browser!.newPage();
 try{
  const familyAccount=seed.accounts.family;
  const unitNumber=(await pool.query('SELECT number FROM units WHERE id=$1',[familyUnit])).rows[0].number;
  await signIn(page,familyAccount,unitNumber);
  await openNotifications(page);
  assert.equal(await unread(page),familyUnreadBefore);
  const card=page.locator('.p-message').filter({hasText:'Account security'}).first();
  await card.getByRole('button',{name:/Open as:/}).click();
  await page.waitForURL(url=>url.pathname==='/imtun/settings',{timeout:10000});
  assert.ok((await pool.query('SELECT read_at FROM notifications WHERE id=$1',[familyNotice])).rows[0].read_at);
  assert.equal(await unread(page),familyUnreadBefore-1);
 }finally{
  await page.close();
 }
});

