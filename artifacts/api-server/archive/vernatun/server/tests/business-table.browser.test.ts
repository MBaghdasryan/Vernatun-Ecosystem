import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {spawn,type ChildProcess} from 'node:child_process';
import {resolve} from 'node:path';
import {test} from 'node:test';
import {chromium} from 'playwright';

async function freePort(){
 const server=createServer();
 await new Promise<void>((resolveListen,reject)=>server.listen(0,'127.0.0.1',error=>error?reject(error):resolveListen()));
 const port=(server.address() as {port:number}).port;
 await new Promise<void>((resolveClose,reject)=>server.close(error=>error?reject(error):resolveClose()));
 return port;
}

test('BusinessTable keeps discussion-title search through status and priority filters and page changes',async()=>{
 const webDir=resolve(process.cwd(),'../../../vernatun');
 const viteBin=resolve(webDir,'node_modules/vite/bin/vite.js');
 const port=await freePort();
 let web:ChildProcess|undefined;
 let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
 try{
  web=spawn(process.execPath,[viteBin,'--host','127.0.0.1','--port',String(port),'--strictPort'],{
   cwd:webDir,
   env:{...process.env,PORT:String(port),BASE_PATH:'/',API_PROXY_TARGET:'http://127.0.0.1:1'},
   stdio:'ignore',
  });
  const started=Date.now();
  while(Date.now()-started<30000){
   if(web.exitCode!==null)throw new Error(`Vite exited with code ${web.exitCode}`);
   try{if((await fetch(`http://127.0.0.1:${port}/tests/business-table.html`)).ok)break}catch{}
   await new Promise(resolveWait=>setTimeout(resolveWait,200));
  }
  assert.ok(Date.now()-started<30000,'Vite fixture server did not become ready');
  browser=await chromium.launch({
   headless:true,
   executablePath:process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE,
   args:['--no-sandbox'],
  });
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/tests/business-table.html`);
  const search=page.getByRole('textbox',{name:'Search'});
  const pagination=page.locator('.p-pagination span');

  await assert.doesNotReject(page.getByRole('button',{name:'Next'}).click());
  assert.match(await pagination.innerText(),/2\/3$/);
  await search.fill('lObBy DoOr');
  assert.match(await pagination.innerText(),/1 · 1\/1$/);
  assert.equal(await page.locator('tbody tr').count(),1);
  assert.match(await page.locator('tbody tr').innerText(),/A discussion-origin repair request/);

  await page.getByRole('combobox',{name:'Status'}).selectOption('new');
  await page.getByRole('combobox',{name:'Priority'}).selectOption('urgent');
  assert.match(await pagination.innerText(),/1 · 1\/1$/);
  assert.match(await page.locator('tbody tr').innerText(),/A discussion-origin repair request/);

  await page.getByRole('combobox',{name:'Priority'}).selectOption('');
  assert.match(await page.locator('tbody tr').innerText(),/A discussion-origin repair request/);
  await search.fill('');
  assert.match(await pagination.innerText(),/11 · 1\/2$/);
  await page.getByRole('combobox',{name:'Priority'}).selectOption('urgent');
  assert.match(await pagination.innerText(),/10 · 1\/2$/);
  await page.getByRole('button',{name:'Next'}).click();
  assert.match(await pagination.innerText(),/10 · 2\/2$/);
  await page.getByRole('combobox',{name:'Priority'}).selectOption('');
  assert.match(await pagination.innerText(),/11 · 1\/2$/);
  await page.getByRole('combobox',{name:'Priority'}).selectOption('urgent');
  assert.match(await pagination.innerText(),/10 · 1\/2$/);
  await page.getByRole('button',{name:'Next'}).click();
  assert.match(await pagination.innerText(),/10 · 2\/2$/);
  await search.fill('Independent plumbing');
  assert.match(await pagination.innerText(),/1 · 1\/1$/);
  assert.equal(await page.locator('tbody tr').count(),1);
  assert.match(await page.locator('tbody tr').innerText(),/Independent plumbing issue/);
  await search.fill('');
  assert.match(await pagination.innerText(),/10 · 1\/2$/);
 }finally{
  await browser?.close();
  if(web&&!web.killed)web.kill('SIGTERM');
 }
});
