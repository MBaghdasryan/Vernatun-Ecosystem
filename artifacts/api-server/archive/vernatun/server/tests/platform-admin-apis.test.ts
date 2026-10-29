import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
import {setPlatformCampaignEmailDeliveryForTests} from '../platform-communications.js';

if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))
 throw new Error('Platform API tests require an isolated vernatun_test database');

const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
let base='';
const server=app.listen(0,'127.0.0.1');

class Client{
 cookie='';csrf='';
 async call(path:string,method='GET',body?:unknown){
  const response=await fetch(base+'/api'+path,{method,
   headers:{'Content-Type':'application/json',...(this.cookie?{Cookie:this.cookie}:{}),
    ...(method!=='GET'&&this.csrf?{'X-CSRF-Token':this.csrf}:{})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const cookies=response.headers.getSetCookie();
  if(cookies.length)this.cookie=cookies.map(value=>value.split(';')[0]).join('; ');
  const data=response.status===204?null:await response.json();
  if(data?.csrf)this.csrf=data.csrf;
  return {status:response.status,data};
 }
 async raw(path:string){
  const response=await fetch(base+'/api'+path,{headers:this.cookie?{Cookie:this.cookie}:{}});
  const cookies=response.headers.getSetCookie();
  if(cookies.length)this.cookie=cookies.map(value=>value.split(';')[0]).join('; ');
  return {status:response.status,contentType:response.headers.get('content-type')??'',text:await response.text()};
 }
 async login(key:string){
  await this.call('/auth/session');
  const account=seeded.accounts[key];
  const response=await this.call('/auth/login','POST',{email:account.email,password:account.password});
  assert.equal(response.status,200,`Seed account ${key} should sign in`);
  const context=response.data.contexts.find((item:any)=>item.role_key===account.role);
  assert.ok(context,`Seed account ${key} should have its expected role`);
  if(response.data.contextId!==context.id){
   assert.equal((await this.call('/auth/context','POST',{id:context.id})).status,200);
  }
  return this;
 }
}

let platform:Client,organizationAdmin:Client,manager:Client,orgA:string,orgB:string,buildingA:string,buildingB:string;

before(async()=>{
 const timezone=await pool.query("SELECT current_setting('TimeZone') AS timezone");
 assert.equal(timezone.rows[0].timezone,'Asia/Yerevan','platform analytics regression must run with a non-UTC database session');
 await pool.query('DELETE FROM auth_rate_limits');
 await new Promise<void>(resolve=>server.listening?resolve():server.once('listening',resolve));
 base='http://127.0.0.1:'+ (server.address() as {port:number}).port;
 platform=await new Client().login('platform_admin');
 organizationAdmin=await new Client().login('org_admin');
 manager=await new Client().login('manager');
 orgA=seeded.fixtures.orgA;
 buildingA=seeded.fixtures.ba;
 buildingB=seeded.fixtures.bb;
 orgB=(await pool.query('SELECT organization_id FROM buildings WHERE id=$1',[buildingB])).rows[0].organization_id;
});

after(async()=>{
 server.close();
 server.closeAllConnections();
 await pool.end();
});

async function createEmailCampaign(subject:string){
 const target={type:'organization',id:orgA};
 const preview=await platform.call('/platform/communications/preview','POST',{target});
 assert.equal(preview.status,200);
 assert.ok(preview.data.count>0&&preview.data.count<=25,'The isolated organization fits in one dispatch batch');
 const response=await platform.call('/platform/email/campaigns','POST',{
  target,subject,body:'Isolated dispatch test; delivery is replaced by a safe fake.',
  expectedRecipients:preview.data.count,idempotencyKey:randomUUID(),
 });
 assert.equal(response.status,201);
 return {id:response.data.id,recipientCount:preview.data.count};
}

test('public session and login remain available beside the protected platform APIs',async()=>{
 const anonymous=new Client();
 const session=await anonymous.call('/auth/session');
 assert.equal(session.status,200);
 assert.equal(session.data.user,null);
 const login=await anonymous.call('/auth/login','POST',{
  email:seeded.accounts.family.email,password:seeded.accounts.family.password,
 });
 assert.equal(login.status,200);
 assert.ok(login.data.user?.id);
 assert.equal((await new Client().call('/platform/analytics')).status,401);
 assert.equal((await new Client().call('/platform/email/campaigns')).status,401);
});

test('platform analytics and server CSV preserve month boundaries in a non-UTC session',async()=>{
 const adminId=seeded.accounts.platform_admin.id;
 const from='2040-06-15',to='2040-07-14';
 const monthBoundaryInstants=[
  '2040-05-31T23:59:59.999Z',
  '2040-05-31T22:00:00.000Z',
  '2040-06-01T00:00:00.000Z',
  '2040-06-15T12:00:00.000Z',
  '2040-06-30T23:59:59.999Z',
  '2040-07-01T00:00:00.000Z',
  '2040-07-31T23:59:59.999Z',
  '2040-08-01T00:00:00.000Z',
 ];
 for(const [index,createdAt] of monthBoundaryInstants.entries()){
  if(index===0)await pool.query('UPDATE organizations SET created_at=$2 WHERE id=$1',[orgA,createdAt]);
  else if(index===1)await pool.query('UPDATE organizations SET created_at=$2 WHERE id=$1',[orgB,createdAt]);
  else await pool.query('INSERT INTO organizations(name,created_at) VALUES($1,$2)',
   [`Month-boundary analytics ${randomUUID()}`,createdAt]);
  await pool.query(`INSERT INTO support_cases(organization_id,created_by,subject,body,created_at)
   VALUES($1,$2,$3,'Month-boundary analytics fixture',$4)`,
   [orgA,adminId,`Month-boundary support ${index} ${randomUUID()}`,createdAt]);
 }
 const currencies={
  AMD:{lower:100,upper:200,before:1000,after:2000},
  RUB:{lower:10,upper:20,before:100,after:200},
  USD:{lower:1000,upper:2000,before:10000,after:20000},
 };
 const plans=new Map<string,string>();
 for(const currency of Object.keys(currencies)){
  const planId=(await pool.query(`INSERT INTO subscription_plans(name,amount_minor,currency,building_limit)
   VALUES($1,1,$2,1) RETURNING id`,[`Isolated analytics ${currency}`,currency])).rows[0].id;
  plans.set(currency,planId);
 }

 for(const [currency,amounts] of Object.entries(currencies)){
  const invoices=[
   {period:'2040-05-01',issued:'2040-06-14T23:59:59.999Z',amount:amounts.before,status:'paid'},
   {period:'2040-06-01',issued:'2040-06-15T00:00:00.000Z',amount:amounts.lower,status:'paid'},
   {period:'2040-07-01',issued:'2040-07-14T23:59:59.999Z',amount:amounts.upper,status:'issued'},
   {period:'2040-08-01',issued:'2040-07-15T00:00:00.000Z',amount:amounts.after,status:'paid'},
  ];
  for(const invoice of invoices){
   const organizationId=currency==='AMD'?orgA:orgB;
   const subscriptionId=(await pool.query(`INSERT INTO subscriptions(organization_id,plan_id,starts_on,ends_on,status,created_by)
    VALUES($1,$2,'2040-01-01','2040-12-31','active',$3) RETURNING id`,
    [organizationId,plans.get(currency),adminId])).rows[0].id;
   await pool.query(`INSERT INTO platform_invoices(subscription_id,organization_id,billing_period,amount_minor,currency,status,issued_at,due_at,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,'2040-12-31',$8)`,
    [subscriptionId,organizationId,invoice.period,invoice.amount,currency,invoice.status,invoice.issued,adminId]);
  }
 }

 function parseCsvRow(line:string){
  const values:string[]=[];
  let value='',quoted=false;
  for(let i=0;i<line.length;i++){
   const char=line[i];
   if(char==='"'&&quoted&&line[i+1]==='"'){value+='"';i++}
   else if(char==='"')quoted=!quoted;
   else if(char===','&&!quoted){values.push(value);value=''}
   else value+=char;
  }
  values.push(value);
  return values;
 }
 for(const [currency,amounts] of Object.entries(currencies)){
  const query=`from=${from}&to=${to}&currency=${currency}`;
  const json=await platform.call(`/platform/analytics?${query}`);
  assert.equal(json.status,200);
  assert.equal(typeof json.data.generatedAt,'string');
  assert.ok(Number.isFinite(Date.parse(json.data.generatedAt)));
  assert.equal(new Date(json.data.generatedAt).toISOString(),json.data.generatedAt);
  assert.deepEqual(json.data.period,{from,to,currency});
  assert.equal(json.data.metrics.billedMinor,String(amounts.lower+amounts.upper));
  assert.equal(json.data.metrics.paidMinor,String(amounts.lower));
  assert.equal(json.data.metrics.invoiceCount,2);
  assert.equal(json.data.metrics.openInvoices,1);
  assert.deepEqual(json.data.monthly.map((month:any)=>month.month),['2040-06-01','2040-07-01']);
   assert.deepEqual(json.data.monthly.map((month:any)=>month.organizations),[3,2]);
   assert.deepEqual(json.data.monthly.map((month:any)=>month.support_cases),[3,2]);
  assert.deepEqual(json.data.monthly.map((month:any)=>month.billed_minor),[String(amounts.lower),String(amounts.upper)]);
  assert.deepEqual(json.data.monthly.map((month:any)=>month.paid_minor),[String(amounts.lower),'0']);

  const exportStartedAt=Date.now();
  const csv=await platform.raw(`/platform/analytics/export.csv?${query}`);
  const exportFinishedAt=Date.now();
  assert.equal(csv.status,200);
  assert.match(csv.contentType,/text\/csv/);
  const rows=csv.text.replace(/^\uFEFF/,'').trimEnd().split(/\r?\n/).map(parseCsvRow);
  const metricHeader=rows.findIndex(row=>row[0]==='metric');
  assert.ok(metricHeader>0,'CSV metadata must precede the report data');
  const metadata=new Map(rows.slice(0,metricHeader).filter(row=>row.length>=2).map(row=>[row[0],row[1]]));
  const exportedAt=metadata.get('report_generated_at_utc');
  assert.ok(exportedAt,'CSV must include the API-generated report timestamp');
  assert.equal(new Date(exportedAt).toISOString(),exportedAt,'export timestamp must be ISO-formatted UTC');
  assert.ok(Date.parse(exportedAt)>=exportStartedAt&&Date.parse(exportedAt)<=exportFinishedAt,
   'export timestamp must be generated during this export request');
  assert.equal(metadata.get('reporting_timezone'),'UTC');
  const metricEnd=rows.findIndex((row,index)=>index>metricHeader&&row[0]==='');
  const metricRows=rows.slice(metricHeader+1,metricEnd);
  const metricValues=new Map(metricRows.map(row=>[row[0],row[1]]));
  const metricFields:{
   [csvName:string]:keyof typeof json.data.metrics
  }={
   organizations:'total',active_organizations:'active',pilot_organizations:'pilot',
   paused_organizations:'paused',buildings:'buildings',billed_minor:'billedMinor',
   paid_minor:'paidMinor',open_invoices:'openInvoices',invoice_count:'invoiceCount',
   open_support_cases:'openSupport',urgent_support_cases:'urgentSupport',
   onboarding_total:'onboardingTotal',onboarding_completed:'onboardingCompleted',
   onboarding_open:'onboardingOpen',onboarding_overdue:'onboardingOverdue',
  };
  assert.deepEqual(Object.fromEntries(metricValues),
   Object.fromEntries(Object.entries(metricFields).map(([csvName,jsonName])=>[
    csvName,String(json.data.metrics[jsonName]),
   ])));
  assert.ok(metricRows.every(row=>row[3]===from&&row[4]===to));
  assert.ok(metricRows.filter(row=>row[0]==='billed_minor'||row[0]==='paid_minor')
   .every(row=>row[2]===currency));
  const monthlyHeader=rows.findIndex(row=>row[0]==='month');
  const csvMonthly=rows.slice(monthlyHeader+1).map(row=>row.slice(0,5));
  const jsonMonthly=json.data.monthly.map((month:any)=>[
   month.month,String(month.organizations),month.billed_minor,month.paid_minor,String(month.support_cases),
  ]);
  assert.deepEqual(csvMonthly,jsonMonthly);
  assert.ok(rows.filter(row=>row[0]==='billed_minor').every(row=>row[2]===currency));
 }

 for(const currency of Object.keys(currencies)){
  const empty=await platform.call(`/platform/analytics?from=2041-01-01&to=2041-01-31&currency=${currency}`);
  assert.equal(empty.status,200);
  assert.equal(empty.data.metrics.billedMinor,'0');
  assert.equal(empty.data.metrics.paidMinor,'0');
  assert.equal(empty.data.metrics.invoiceCount,0);
  assert.equal(empty.data.metrics.openInvoices,0);
  assert.equal(empty.data.monthly.length,1);
  assert.equal(empty.data.monthly[0].month,'2041-01-01');
  assert.equal(empty.data.monthly[0].billed_minor,'0');
  assert.equal(empty.data.monthly[0].paid_minor,'0');
 }

 assert.equal((await platform.call(`/platform/analytics?from=${from}&to=${to}&currency=EUR`)).status,400);
});

test('platform analytics and CSV keep leap-day records in the correct UTC month in a non-UTC session',async()=>{
 const adminId=seeded.accounts.platform_admin.id;
 const records=[
  '2040-02-28T23:59:59.999Z',
  '2040-02-29T23:59:59.999Z',
  '2040-03-01T00:00:00.000Z',
 ];
 for(const [index,createdAt] of records.entries()){
  await pool.query('INSERT INTO organizations(name,created_at) VALUES($1,$2)',
   [`Leap-year analytics ${index} ${randomUUID()}`,createdAt]);
  await pool.query(`INSERT INTO support_cases(organization_id,created_by,subject,body,created_at)
   VALUES($1,$2,$3,'Leap-year analytics fixture',$4)`,
   [orgA,adminId,`Leap-year support ${index} ${randomUUID()}`,createdAt]);
 }

 const query='from=2040-02-01&to=2040-03-31&currency=AMD';
 const json=await platform.call(`/platform/analytics?${query}`);
 assert.equal(json.status,200);
 assert.deepEqual(json.data.monthly.map((month:any)=>month.month),['2040-02-01','2040-03-01']);
 assert.deepEqual(json.data.monthly.map((month:any)=>month.organizations),[2,1]);
 assert.deepEqual(json.data.monthly.map((month:any)=>month.support_cases),[2,1]);

 const csv=await platform.raw(`/platform/analytics/export.csv?${query}`);
 assert.equal(csv.status,200);
 assert.match(csv.contentType,/text\/csv/);
 const rows=csv.text.replace(/^\uFEFF/,'').trimEnd().split(/\r?\n/).map(line=>{
  const values:string[]=[];
  let value='',quoted=false;
  for(let i=0;i<line.length;i++){
   const char=line[i];
   if(char==='"'&&quoted&&line[i+1]==='"'){value+='"';i++}
   else if(char==='"')quoted=!quoted;
   else if(char===','&&!quoted){values.push(value);value=''}
   else value+=char;
  }
  values.push(value);
  return values;
 });
 const monthlyHeader=rows.findIndex(row=>row[0]==='month');
 const csvMonthly=rows.slice(monthlyHeader+1).map(row=>row.slice(0,5));
 const jsonMonthly=json.data.monthly.map((month:any)=>[
  month.month,String(month.organizations),month.billed_minor,month.paid_minor,String(month.support_cases),
 ]);
 assert.deepEqual(csvMonthly,jsonMonthly);
 assert.deepEqual(csvMonthly.map(row=>[row[0],row[1],row[4]]),[
  ['2040-02-01','2','2'],
  ['2040-03-01','1','1'],
 ]);
});

test('non-platform roles and platform users without the required permission are denied',async()=>{
 for(const client of [organizationAdmin,manager]){
  assert.equal((await client.call('/platform/analytics')).status,403);
  assert.equal((await client.call('/platform/analytics/export.csv')).status,403);
  assert.equal((await client.call('/platform/communications/targets/organizations')).status,403);
  assert.equal((await client.call('/platform/notifications')).status,403);
  assert.equal((await client.call('/platform/email/campaigns')).status,403);
 }
 await pool.query(`DELETE FROM role_permissions WHERE role_key='platform_admin'
  AND permission_key IN('organizations.manage','organizations.read','platform.communications.manage')`);
 try{
  const limited=await new Client().login('platform_admin');
  assert.equal((await limited.call('/platform/analytics')).status,403);
  assert.equal((await limited.call('/platform/analytics/export.csv')).status,403);
  assert.equal((await limited.call('/platform/notifications')).status,403);
  assert.equal((await limited.call('/platform/email/campaigns')).status,403);
 }finally{
  await pool.query(`INSERT INTO role_permissions(role_key,permission_key)
   VALUES('platform_admin','organizations.manage'),('platform_admin','organizations.read'),
         ('platform_admin','platform.communications.manage') ON CONFLICT DO NOTHING`);
 }
});

test('platform and manager sends reject a mismatched or foreign building target',async()=>{
 const wrongTarget={type:'building',id:buildingB,organizationId:orgA};
 const preview=await platform.call('/platform/communications/preview','POST',{target:wrongTarget});
 assert.equal(preview.status,404);
 const beforeNotices=Number((await pool.query('SELECT count(*)::int AS n FROM platform_notification_batches')).rows[0].n);
 const beforeEmails=Number((await pool.query('SELECT count(*)::int AS n FROM platform_email_campaigns')).rows[0].n);
 const idempotencyKey=randomUUID();
 const invalidNotification=await platform.call('/platform/notifications','POST',{
  target:wrongTarget,title:'Invalid scope',body:'This must not be sent.',expectedRecipients:1,idempotencyKey,
 });
 assert.equal(invalidNotification.status,404);
 const invalidEmail=await platform.call('/platform/email/campaigns','POST',{
  target:wrongTarget,subject:'Invalid scope',body:'This must not be sent.',expectedRecipients:1,idempotencyKey:randomUUID(),
 });
 assert.equal(invalidEmail.status,404);
 assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM platform_notification_batches')).rows[0].n),beforeNotices);
 assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM platform_email_campaigns')).rows[0].n),beforeEmails);

 // The dedicated notification-center browser suite creates a manager with an
 // explicit building assignment and covers that route's foreign-user denial.
});

test('platform notifications and email campaigns safely replay concurrent requests once',async()=>{
 const target={type:'organization',id:orgA};
 const preview=await platform.call('/platform/communications/preview','POST',{target});
 assert.equal(preview.status,200);
 assert.ok(preview.data.count>0);
 const notificationKey=randomUUID();
 const notification={target,title:'Isolated admin notice',body:'A single in-app notice.',expectedRecipients:preview.data.count,idempotencyKey:notificationKey};
 const noticeResponses=await Promise.all([
  platform.call('/platform/notifications','POST',notification),
  platform.call('/platform/notifications','POST',notification),
 ]);
 assert.deepEqual(noticeResponses.map(r=>r.status).sort(),[200,201]);
 assert.equal(new Set(noticeResponses.map(r=>r.data.id)).size,1);
 assert.deepEqual(noticeResponses.map(r=>r.data.replayed).sort(),[false,true]);
 assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM platform_notification_batches WHERE idempotency_key=$1',[notificationKey])).rows[0].n),1);
 const batchId=noticeResponses[0].data.id;
 assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM notifications WHERE manual_batch_id=$1',[batchId])).rows[0].n),preview.data.count);
 const conflictingNotice=await platform.call('/platform/notifications','POST',{...notification,body:'Different content'});
 assert.equal(conflictingNotice.status,409);

 const emailKey=randomUUID();
 const email={target,subject:'Isolated admin email campaign',body:'Queued once; no provider dispatch in this test.',expectedRecipients:preview.data.count,idempotencyKey:emailKey};
 const emailResponses=await Promise.all([
  platform.call('/platform/email/campaigns','POST',email),
  platform.call('/platform/email/campaigns','POST',email),
 ]);
 assert.deepEqual(emailResponses.map(r=>r.status).sort(),[200,201]);
 assert.equal(new Set(emailResponses.map(r=>r.data.id)).size,1);
 assert.deepEqual(emailResponses.map(r=>r.data.replayed).sort(),[false,true]);
 assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM platform_email_campaigns WHERE idempotency_key=$1',[emailKey])).rows[0].n),1);
 assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM platform_email_campaign_recipients WHERE campaign_id=$1',[emailResponses[0].data.id])).rows[0].n),preview.data.count);
 const conflictingEmail=await platform.call('/platform/email/campaigns','POST',{...email,subject:'Different subject'});
 assert.equal(conflictingEmail.status,409);
});

test('parallel platform email dispatches claim a recipient only once',async()=>{
 const campaign=await createEmailCampaign('Parallel dispatch isolation');
 let calls=0;
 const deliveredTo:string[]=[];
 let signalStarted!:()=>void;
 let releaseDelivery!:()=>void;
 const started=new Promise<void>(resolve=>{signalStarted=resolve});
 const gate=new Promise<void>(resolve=>{releaseDelivery=resolve});
 setPlatformCampaignEmailDeliveryForTests(async(message)=>{
  calls++;
  deliveredTo.push(message.to);
  signalStarted();
  await gate;
  return {delivery:'resend_accepted',provider:'safe-test-fake',messageId:'fake-accepted-1'};
 });
 const firstPromise=platform.call(`/platform/email/campaigns/${campaign.id}/dispatch`,'POST',{});
 try{
  await started;
  const second=await platform.call(`/platform/email/campaigns/${campaign.id}/dispatch`,'POST',{});
  assert.equal(second.status,200);
  assert.equal(second.data.status,'sending');
  assert.equal(second.data.processed,0);
  assert.equal(second.data.remaining,campaign.recipientCount);
  releaseDelivery();
  const first=await firstPromise;
  assert.equal(first.status,200);
  assert.equal(first.data.status,'accepted');
  assert.equal(calls,campaign.recipientCount);
  assert.equal(new Set(deliveredTo).size,campaign.recipientCount);

  const recipient=(await pool.query(`SELECT count(*)::int AS total,
   count(*) FILTER(WHERE status='accepted' AND provider_message_id='fake-accepted-1' AND failure_code IS NULL)::int AS accepted
   FROM platform_email_campaign_recipients WHERE campaign_id=$1`,[campaign.id])).rows[0];
  assert.deepEqual(recipient,{total:campaign.recipientCount,accepted:campaign.recipientCount});
  const finalCampaign=(await pool.query('SELECT status,finished_at FROM platform_email_campaigns WHERE id=$1',[campaign.id])).rows[0];
  assert.equal(finalCampaign.status,'accepted');
  assert.ok(finalCampaign.finished_at);

  const events=(await pool.query(`SELECT details FROM audit_events WHERE action='platform.email.campaign.dispatch'
   AND entity_type='platform_email_campaign' AND entity_id=$1`,[campaign.id])).rows.map((row:any)=>row.details);
  assert.equal(events.length,2);
  assert.ok(events.some((details:any)=>details.processed===0&&details.remaining===campaign.recipientCount&&details.status==='sending'));
  assert.ok(events.some((details:any)=>details.processed===campaign.recipientCount&&details.remaining===0&&details.status==='accepted'));
 }finally{
  releaseDelivery();
  await firstPromise.catch(()=>undefined);
  setPlatformCampaignEmailDeliveryForTests(null);
 }
});

test('uncertain and interrupted platform email deliveries stay terminal on retry',async()=>{
 const uncertain=await createEmailCampaign('Uncertain delivery isolation');
 let uncertainCalls=0;
 const uncertainRecipients:string[]=[];
 setPlatformCampaignEmailDeliveryForTests(async(message)=>{
  uncertainCalls++;
  uncertainRecipients.push(message.to);
  throw Object.assign(new Error('Provider acceptance could not be confirmed'),{code:'email_receipt_unrecorded'});
 });
 try{
  const first=await platform.call(`/platform/email/campaigns/${uncertain.id}/dispatch`,'POST',{});
  assert.equal(first.status,200);
  assert.equal(first.data.status,'unknown');
  assert.equal(first.data.unknown,uncertain.recipientCount);
  const retry=await platform.call(`/platform/email/campaigns/${uncertain.id}/dispatch`,'POST',{});
  assert.equal(retry.status,200);
  assert.equal(retry.data.status,'unknown');
  assert.equal(retry.data.processed,0);
  assert.equal(uncertainCalls,uncertain.recipientCount);
  assert.equal(new Set(uncertainRecipients).size,uncertain.recipientCount);

  const uncertainState=(await pool.query(`SELECT r.status,r.failure_code,c.status AS campaign_status,c.finished_at
   FROM platform_email_campaign_recipients r JOIN platform_email_campaigns c ON c.id=r.campaign_id
   WHERE r.campaign_id=$1`,[uncertain.id])).rows[0];
  assert.deepEqual(uncertainState.status,'unknown');
  assert.equal(uncertainState.failure_code,'email_receipt_unrecorded');
  assert.equal(uncertainState.campaign_status,'unknown');
  assert.ok(uncertainState.finished_at);
  const uncertainEvents=(await pool.query(`SELECT details FROM audit_events WHERE action='platform.email.campaign.dispatch'
   AND entity_type='platform_email_campaign' AND entity_id=$1`,[uncertain.id])).rows.map((row:any)=>row.details);
  assert.equal(uncertainEvents.length,2);
  assert.ok(uncertainEvents.some((details:any)=>details.processed===uncertain.recipientCount&&details.remaining===0&&details.status==='unknown'));
  assert.ok(uncertainEvents.some((details:any)=>details.processed===0&&details.remaining===0&&details.status==='unknown'));
 }finally{
  setPlatformCampaignEmailDeliveryForTests(null);
 }

 const interrupted=await createEmailCampaign('Interrupted delivery isolation');
 await pool.query(`UPDATE platform_email_campaign_recipients SET status='sending',updated_at=now()-interval '6 minutes'
  WHERE campaign_id=$1`,[interrupted.id]);
 let interruptedCalls=0;
 setPlatformCampaignEmailDeliveryForTests(async()=>{
  interruptedCalls++;
  return {delivery:'resend_accepted',provider:'safe-test-fake',messageId:'must-not-be-sent'};
 });
 try{
  const recovered=await platform.call(`/platform/email/campaigns/${interrupted.id}/dispatch`,'POST',{});
  assert.equal(recovered.status,200);
  assert.equal(recovered.data.status,'unknown');
  assert.equal(recovered.data.processed,0);
  assert.equal(recovered.data.unknown,interrupted.recipientCount);
  assert.equal(interruptedCalls,0);
  const interruptedState=(await pool.query(`SELECT r.status,r.failure_code,c.status AS campaign_status,c.finished_at
   FROM platform_email_campaign_recipients r JOIN platform_email_campaigns c ON c.id=r.campaign_id
   WHERE r.campaign_id=$1`,[interrupted.id])).rows[0];
  const interruptedRecipients=(await pool.query(`SELECT status,failure_code,count(*)::int AS total
   FROM platform_email_campaign_recipients WHERE campaign_id=$1 GROUP BY status,failure_code`,[interrupted.id])).rows;
  assert.deepEqual(interruptedRecipients,[{status:'unknown',failure_code:'dispatch_interrupted',total:interrupted.recipientCount}]);
  assert.equal(interruptedState.campaign_status,'unknown');
  assert.ok(interruptedState.finished_at);
 }finally{
  setPlatformCampaignEmailDeliveryForTests(null);
 }
});
