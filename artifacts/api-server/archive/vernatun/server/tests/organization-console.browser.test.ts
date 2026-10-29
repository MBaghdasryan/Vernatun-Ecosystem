import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,type ChildProcess} from 'node:child_process';
import {readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {chromium,type Browser} from 'playwright';
import {app} from '../app.js';
import {pool} from '../db.js';

const port=4193;
const origin=`http://127.0.0.1:${port}`;

async function waitForServer(url:string,process?:ChildProcess){
 const started=Date.now();
 while(Date.now()-started<30000){
  if(process?.exitCode!==null&&process?.exitCode!==undefined)throw new Error(`Vite exited with code ${process.exitCode}`);
  try{if((await fetch(url)).ok)return}catch{}
  await new Promise(resolveWait=>setTimeout(resolveWait,200));
 }
 throw new Error(`Server did not become ready: ${url}`);
}

test('platform admin can create and manage organizations in the signed-in console', {timeout:120000}, async()=>{
 const tag=randomUUID();
 const developerName=`Browser QA developer ${tag}`;
 const managementName=`Browser QA management ${tag}`;
 const updatedManagementName=`Browser QA managed profile ${tag}`;
 const seed=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
 const account=seed.accounts.platform_admin;
 const targetDay=(await pool.query("SELECT (now() AT TIME ZONE 'Asia/Yerevan')::date::text AS day")).rows[0].day as string;
 await pool.query(
  `INSERT INTO organizations(name,currency,is_demo,company_type)
   SELECT 'Browser QA pagination '||g,'AMD',false,'management_company'
   FROM generate_series(1,28) AS g`,
 );

 const api=createServer(app);
 await new Promise<void>((resolveListen,reject)=>api.listen(0,'127.0.0.1',error=>error?reject(error):resolveListen()));
 const apiPort=(api.address() as {port:number}).port;
 const webDir=resolve(process.cwd(),'../../../vernatun');
 const viteBin=resolve(webDir,'node_modules/vite/bin/vite.js');
 let web:ChildProcess|undefined;
 let browser:Browser|undefined;
 let apiClosed=false;
 try{
  web=spawn(process.execPath,[viteBin,'--host','127.0.0.1','--port',String(port),'--strictPort'],{
   cwd:webDir,
   env:{...process.env,PORT:String(port),BASE_PATH:'/',API_PROXY_TARGET:`http://127.0.0.1:${apiPort}`},
   stdio:'ignore',
  });
  await waitForServer(origin+'/login',web);
  browser=await chromium.launch({headless:true,executablePath:process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
  const context=await browser.newContext({acceptDownloads:true});
  const page=await context.newPage();
  const browserErrors:string[]=[];
  page.on('pageerror',error=>browserErrors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')browserErrors.push(message.text())});
  page.setDefaultTimeout(12000);
  await page.goto(origin+'/login');
  await page.locator('.p-auth-side .p-selectors select').first().selectOption('en');
  await page.locator('input[name="email"]').fill(account.email);
  await page.locator('input[name="password"]').fill(account.password);
  await page.locator('.p-auth-form button.p-button').click();
  await page.waitForFunction(()=>document.querySelector('.p-context-page')||document.querySelector('.p-sidebar nav')||document.querySelector('[role="alert"]'),null,{timeout:20000});
  if(await page.locator('[role="alert"]').count()){
   throw new Error(`Platform admin sign-in failed: ${await page.locator('[role="alert"]').first().innerText()}`);
  }
  if(await page.locator('.p-context-page').count()){
   await page.getByRole('button').filter({hasText:/admin|ադմին|админ/i}).click();
  }
  await page.locator('.p-sidebar nav').waitFor();
  await page.locator('.p-topbar .p-selectors select').first().selectOption('en');
  const organizationsLink=page.locator('.p-sidebar nav a[href*="/organizations"]').first();
  await organizationsLink.waitFor();
  await organizationsLink.click();
  await page.getByRole('heading',{name:'Organization record'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Invite user',exact:true}).count(),0,'Invite User should be replaced by Add Organization on this page');
  const addButton=page.getByRole('button',{name:'Add organization',exact:true});
  assert.equal(await addButton.count(),1);

  async function createOrganization(name:string,companyType:string,modules:string[]){
   await addButton.click();
   const dialog=page.getByRole('dialog',{name:'Add organization'});
   await dialog.waitFor({state:'visible'});
   await dialog.getByLabel('Organization type').selectOption(companyType);
   await dialog.getByLabel('Name',{exact:true}).fill(name);
   await dialog.getByLabel('Legal name').fill(`${name} Legal`);
   await dialog.getByLabel('Tax ID').fill('QA-217');
   await dialog.getByLabel('Contact e-mail').fill('qa@example.test');
   await dialog.getByLabel('Contact phone').fill('+37400000000');
   await dialog.getByLabel('Address').fill('Yerevan');
   for(const module of modules)await dialog.getByLabel(module,{exact:true}).check();
   await dialog.getByRole('button',{name:'Create',exact:true}).click();
   await dialog.waitFor({state:'hidden'});
   const detail=page.locator('.p5-org-console .p5-split > section').nth(1);
   await detail.getByRole('heading',{name,exact:true}).waitFor();
   for(const module of modules){
    const key=module==='Smart building'?'smart_building':module==='Requests & work orders'?'requests':module.toLowerCase();
    await detail.locator('ul.p5-list li').filter({hasText:key}).first().waitFor();
   }
   return detail;
  }

  await createOrganization(developerName,'developer',['Requests & work orders','Smart building']);
  const managementDetail=await createOrganization(managementName,'management_company',['Finance','Documents']);
  await managementDetail.getByLabel('Name',{exact:true}).fill(updatedManagementName);
  await managementDetail.getByRole('button',{name:'Save',exact:true}).click();
  await managementDetail.getByRole('heading',{name:updatedManagementName,exact:true}).waitFor();

  await page.reload();
  const firstSection=page.locator('.p5-org-console .p5-split > section').first();
  await firstSection.getByRole('button',{name:new RegExp(updatedManagementName)}).click();
  const reloadedDetail=page.locator('.p5-org-console .p5-split > section').nth(1);
  await reloadedDetail.getByRole('heading',{name:updatedManagementName,exact:true}).waitFor();
  assert.equal(await reloadedDetail.getByLabel('Name',{exact:true}).inputValue(),updatedManagementName,'profile changes should persist after reload');

  const from=page.getByLabel('Created from');
  const to=page.getByLabel('Created to');
  await from.fill('2099-01-01');
  await page.waitForFunction(()=>!document.querySelector('.p5-org-console .p5-split > section:first-of-type ul.p5-list'));
  await from.fill(targetDay);
  await to.fill(targetDay);
  const orgRows=firstSection.locator('ul.p5-list li');
  await page.waitForFunction(()=>Number(document.querySelector('.p5-org-console .p5-split > section:first-of-type .p5-row span.p5-muted')?.textContent?.match(/^(\d+)/)?.[1]??0)>25);
  assert.equal(await orgRows.count(),25,'the first page should contain 25 filtered organizations');
  assert.match(await firstSection.innerText(),/Page 1 \/ [2-9]\d*/);
  await firstSection.getByRole('button',{name:'Next',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.p5-org-console .p5-split > section')?.textContent?.includes('Page 2 /'));

  await page.getByLabel('Search organizations').fill(tag);
  await page.waitForFunction(()=>document.querySelectorAll('.p5-org-console .p5-split > section:first-of-type ul.p5-list li').length===2);
  const downloadWait=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export list as CSV'}).click();
  const download=await downloadWait;
  assert.equal(download.suggestedFilename(),'vernatun-organizations.csv');
  const file=resolve('/tmp',`org-console-${tag}.csv`);
  try{
   await download.saveAs(file);
   const csv=await readFile(file,'utf8');
   assert.ok(csv.includes(developerName));
   assert.ok(csv.includes(updatedManagementName));
   assert.ok(csv.includes('smart_building'));
   assert.ok(csv.includes('documents'));
  }finally{await rm(file,{force:true})}

  async function openSection(view:string,heading:string,inviteExpected=false){
   const link=page.locator(`.p-sidebar nav a[href="/console/${view}"]`);
   await link.waitFor({state:'visible'});
   await link.click();
   await page.getByRole('heading',{name:heading,exact:true}).first().waitFor();
   assert.equal(await page.locator('.p-page-heading').getByRole('button',{name:'Invite user',exact:true}).count(),inviteExpected?1:0,`Invite user availability is incorrect on ${view}`);
   assert.equal(await page.getByRole('alert').count(),0,`${view} should load without an error notice`);
  }
  async function checkNoNarrowOverflow(){
   const width=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth}));
   assert.ok(width.content<=width.viewport+1,`Unexpected horizontal page overflow: ${JSON.stringify(width)} at ${page.url()}`);
  }

  await openSection('overview','Platform overview',true);
  await openSection('analytics','Platform analytics');
  const analyticsResponse=await page.evaluate(async()=>{
   const response=await fetch('/api/platform/analytics?currency=AMD',{credentials:'include'});
   return {status:response.status,body:await response.text()};
  });
  assert.equal(analyticsResponse.status,200,`Platform analytics API failed: ${analyticsResponse.body}`);
  const analyticsData=JSON.parse(analyticsResponse.body);
  assert.ok(analyticsData.monthly.every((row:{month:string})=>/^\d{4}-\d{2}-\d{2}$/.test(row.month)),'Monthly analytics dates must be ISO-formatted');
  assert.equal(await page.locator('.p-platform-analytics').count(),1,`Platform analytics view did not render at ${page.url()}: ${await page.locator('body').innerText()} Browser errors: ${browserErrors.join(' | ')}`);
  assert.equal(await page.getByLabel('From',{exact:true}).count(),1);
  assert.equal(await page.getByLabel('To',{exact:true}).count(),1);
  await page.locator('.p-platform-analytics .p-metrics').waitFor();
  const analyticsDownload=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export CSV',exact:true}).click();
  assert.equal((await analyticsDownload).suggestedFilename(),'vernatun-platform-analytics.csv');

  await openSection('payments','Company payments');
  await page.getByLabel('Search by company, plan or type').fill('no matching platform payment');
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await page.getByText('No company payments found.',{exact:true}).waitFor();

  await openSection('notifications','Platform notifications');
  await page.getByLabel('Search notifications').last().fill('no matching platform notification');
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await page.getByText('No notifications found.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Send in app',exact:true}).count(),1,'Notification compose action should be available without sending');

  await openSection('email','Email campaigns');
  await page.getByLabel('Search campaigns').fill('no matching campaign');
  await page.getByRole('search').getByRole('button',{name:'Apply',exact:true}).click();
  await page.getByText('No campaigns found.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Start sending',exact:false}).count(),0,'Opening the campaign console must not start delivery');

  await openSection('audit','Audit log');
  const auditDownload=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export CSV',exact:true}).click();
  assert.equal((await auditDownload).suggestedFilename(),'audit-events.csv');

  await openSection('invitations','Invitations',true);

  await page.setViewportSize({width:390,height:844});
  await checkNoNarrowOverflow();
  for(const [view,heading] of [
   ['organizations','Organization record'],
   ['analytics','Platform analytics'],
   ['payments','Company payments'],
   ['notifications','Platform notifications'],
   ['email','Email campaigns'],
   ['audit','Audit log'],
   ['invitations','Invitations'],
  ] as const){
   await page.locator('.p-menu').click();
   await page.locator(`.p-sidebar.mobile-open nav a[href="/console/${view}"]`).click();
   await page.getByRole('heading',{name:heading,exact:true}).first().waitFor();
   await checkNoNarrowOverflow();
  }
  assert.deepEqual(browserErrors,[],'The authenticated admin session should have no browser errors');
  await context.close();
 }finally{
  await browser?.close();
  if(web&&!web.killed){
   web.kill('SIGTERM');
   await new Promise<void>(resolveExit=>web!.once('exit',()=>resolveExit()));
  }
  if(!apiClosed){await new Promise<void>(resolveClose=>api.close(()=>resolveClose()));apiClosed=true}
  await pool.end();
 }
});
