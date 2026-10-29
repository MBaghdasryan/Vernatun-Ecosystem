import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fork,type ChildProcess} from 'node:child_process';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import sharp from 'sharp';
import {pool} from '../db.js';
import {createPrivateBackup} from '../file-backup.js';
import {withIsolatedRestore} from '../file-restore.js';
import {backupLocation,validateManifest} from '../backup-format.js';
import {privateStorageLocation,deletePrivateFile,savePrivateFile,readPrivateFile} from '../private-files.js';
import {referencedFiles,tableFingerprints} from '../backup-postgres.js';

if(process.env.NODE_ENV!=='test'||new URL(process.env.DATABASE_URL!).pathname!=='/vernatun_test')throw new Error('Isolated fixtures required');
const seed=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const cli=createRequire(import.meta.url).resolve('tsx/cli');
let server:ChildProcess|undefined,base='';
async function start(script:string,env=process.env){
  server=fork(cli,[script],{env,stdio:['ignore','inherit','inherit','ipc']});
  const port=await new Promise<number>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Test server timeout')),15000);
    server!.once('message',(message:any)=>{clearTimeout(timer);resolve(message.port)});
    server!.once('exit',()=>{clearTimeout(timer);reject(new Error('Test server failed'))});
  });
  base=`http://127.0.0.1:${port}/api`;
}
async function stop(){
  if(!server||server.exitCode!==null)return;
  const done=once(server,'exit');server.kill('SIGTERM');await done;server=undefined;
}
class Client{
  cookie='';csrf='';
  async call(path:string,method='GET',body?:unknown){
    const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:this.cookie,
      ...(method!=='GET'?{'X-CSRF-Token':this.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
    const data=r.status===204?null:await r.json();if(data?.csrf)this.csrf=data.csrf;
    return {status:r.status,data};
  }
  async login(key:string){
    await this.call('/auth/session');const account=seed.accounts[key];
    const r=await this.call('/auth/login','POST',{email:account.email,password:account.password});
    assert.equal(r.status,200);
    if(!r.data.contextId)assert.equal((await this.call('/auth/context','POST',{id:r.data.contexts.find((c:any)=>c.role_key===account.role).id})).status,200);
    return this;
  }
  upload(path:string,body:Buffer,fileName?:string){return fetch(base+path,{method:'POST',headers:{Cookie:this.cookie,'X-CSRF-Token':this.csrf,'Content-Type':'application/octet-stream',...(fileName?{'X-File-Name':encodeURIComponent(fileName)}:{})},body})}
  download(path:string){return fetch(base+path,{headers:{Cookie:this.cookie}})}
}
after(async()=>{await stop();await pool.end()});

test('Complete SQL + App Storage backup restores original keys, bytes and business permissions in isolation',async()=>{
  await pool.query('DELETE FROM auth_rate_limits');
  await start('server/tests/storage-server.ts');
  const org=await new Client().login('org_admin'),owner=await new Client().login('unit_owner');
  const developer=await new Client().login('developer'),contractor=await new Client().login('contractor');
  const pdf=Buffer.from('%PDF-1.4\nisolated backup fixture\n%%EOF');
  const png=await sharp({create:{width:8,height:8,channels:3,background:'#00aa55'}}).png().toBuffer();
  const jpeg=await sharp(png).rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
  const checks:{path:string;body:Buffer;allowed:string;denied:string[]}[]=[];
  for(const visibility of ['staff','residents','unit_owner']){
    const query=new URLSearchParams({buildingId:seed.fixtures.ba,unitId:seed.fixtures.ua,title:'Backup fixture',visibility});
    const r=await org.upload('/documents?'+query,pdf);assert.equal(r.status,201);
    checks.push({path:`/documents/${(await r.json()).id}/download`,body:pdf,allowed:visibility==='staff'?'org_admin':'unit_owner',
      denied:visibility==='residents'?['second_org']:['family','second_org']});
  }
  const request=await owner.call('/requests','POST',{unitId:seed.fixtures.ua,subject:'Backup fixture',description:'Restore photo'});
  assert.equal(request.status,201);
  const photo=await owner.upload(`/requests/${request.data.id}/photos`,png);assert.equal(photo.status,201);
  checks.push({path:'/photos/'+(await photo.json()).id,body:jpeg,allowed:'unit_owner',denied:['family','second_org','contractor']});
  const defect=await developer.call('/defects','POST',{unitId:seed.fixtures.ua,subject:'Backup fixture',location:'Window',contractorId:seed.accounts.contractor.id,dueOn:'2026-10-15'});
  assert.equal(defect.status,201);
  const attachment=await contractor.upload(`/defects/${defect.data.id}/photos`,png);assert.equal(attachment.status,201);
  const attachmentPath='/defect-photos/'+(await attachment.json()).id;
  checks.push({path:attachmentPath,body:jpeg,allowed:'contractor',denied:['family','second_org']});
  const platform=await new Client().login('platform_admin');
  const task=await platform.call('/platform/tasks','POST',{title:'Backup task attachment fixture'});
  assert.equal(task.status,201);
  const taskFile=await platform.upload(`/platform/tasks/${task.data.id}/attachments`,pdf,'task-notes.pdf');
  assert.equal(taskFile.status,201);
  const taskAttachment=await taskFile.json();
  checks.push({
    path:`/platform/tasks/${task.data.id}/attachments/${taskAttachment.id}`,body:pdf,
    allowed:'platform_admin',denied:['org_admin','unit_owner','family','second_org','contractor'],
  });
  await stop();
  const schema=(await pool.query('SELECT current_schema() AS name')).rows[0].name;
  const db=await pool.connect();
  const names=(await db.query('SELECT tablename AS name FROM pg_tables WHERE schemaname=$1',[schema])).rows.map(r=>r.name);
  const before=await tableFingerprints(db,schema,names);
  const refs=await referencedFiles(db,schema);db.release();
  const backup=await createPrivateBackup();
  const dest=backupLocation(backup.id);
  try{
    assert.equal(backup.files.length,refs.length);
    assert.equal(Date.parse(backup.retainUntil)-Date.parse(backup.createdAt),30*86400000);
    const sourceDb=await pool.connect();
    try{assert.deepEqual(await tableFingerprints(sourceDb,schema,names),before)}finally{sourceDb.release()}
    // Simulate lost bytes ONLY in runner-owned source fixtures.
    const lost=backup.files.find(f=>f.kind==='documents')!;
    await deletePrivateFile(lost.kind,lost.key);
    await withIsolatedRestore(backup.id,async context=>{
      assert.notEqual(context.connectionString,process.env.DATABASE_URL);
      assert.notEqual(context.testRun,process.env.PRIVATE_FILES_TEST_RUN);
      await context.db.query(`DELETE FROM "${schema}".auth_rate_limits`);
      await start('server/tests/backup-server.ts',{...process.env,NODE_ENV:'test',DATABASE_URL:context.connectionString,PRIVATE_FILES_TEST_RUN:context.testRun});
      try{
        const clients=new Map<string,Client>();
        for(const key of ['org_admin','unit_owner','family','second_org','contractor','platform_admin'])clients.set(key,await new Client().login(key));
        for(const check of checks){
          const r=await clients.get(check.allowed)!.download(check.path);assert.equal(r.status,200);
          assert.equal(r.headers.get('cache-control'),'private, no-store');
          assert.deepEqual(Buffer.from(await r.arrayBuffer()),check.body);
          for(const key of check.denied)assert.ok([403,404].includes((await clients.get(key)!.download(check.path)).status));
          assert.equal((await fetch(base+check.path)).status,401);
        }
        await context.db.query(`UPDATE "${schema}".defects SET contractor_id=$1 WHERE id=$2`,[seed.accounts.developer.id,defect.data.id]);
        assert.equal((await clients.get('contractor')!.download(attachmentPath)).status,404);
      }finally{await stop()}
    });
    // Restore this test fixture so subsequent suites can still read their source DB.
    const original=(await dest.bucket.file(`${dest.prefix}files/${lost.kind}/${lost.key}`).download())[0];
    await savePrivateFile(lost.kind,lost.key,original,lost.mediaType);
    assert.deepEqual(await readPrivateFile(lost.kind,lost.key),pdf);
    await withIsolatedRestore(backup.id,async()=>{}); // repeatable; never overwrites targets
    const checkDb=await pool.connect();
    try{assert.deepEqual(await tableFingerprints(checkDb,schema,names),before)}finally{checkDb.release()}
    // Corruption and incomplete copies are refused before allocating a target DB.
    const dumpObject=dest.bucket.file(dest.prefix+'database.dump');
    const originalDump=(await dumpObject.download())[0];
    await dumpObject.save(Buffer.from('corrupted'),{resumable:false});
    await assert.rejects(withIsolatedRestore(backup.id,async()=>assert.fail('Must not inspect corrupt copy')),/checksum mismatch/);
    await dumpObject.save(originalDump,{resumable:false});
    await assert.rejects(withIsolatedRestore('backup_'+'0'.repeat(20),async()=>assert.fail()));
    assert.throws(()=>validateManifest({...backup,files:[...backup.files,backup.files[0]]}),/Duplicate/);
    assert.throws(()=>validateManifest({...backup,files:[{...backup.files[0],key:'../escape'}]}));
    assert.throws(()=>backupLocation('../live'));
    const storage=privateStorageLocation();
    assert.notEqual(storage.prefix,dest.prefix);
  }finally{
    await stop();
    // Only the backup created by this test, never other copies.
    const [objects]=await dest.bucket.getFiles({prefix:dest.prefix});
    for(const object of objects)await object.delete();
  }
});

test('Missing referenced bytes cannot publish a complete backup',async()=>{
  const db=await pool.connect();const schema=(await db.query('SELECT current_schema() AS name')).rows[0].name;
  const refs=await referencedFiles(db,schema);db.release();
  const file=refs[0]!;const body=await readPrivateFile(file.kind,file.key);
  await deletePrivateFile(file.kind,file.key);
  try{await assert.rejects(createPrivateBackup())}
  finally{await savePrivateFile(file.kind,file.key,body,file.media_type)}
});
