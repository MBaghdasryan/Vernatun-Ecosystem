import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pool} from '../db.js';
import {config} from '../config.js';
import {inventoryPrivateFiles,cleanPrivateFiles,minimumGraceHours,type FileInventory} from '../file-inventory.js';
import {savePrivateFile,saveAndCommitPrivateFile,readPrivateFile,privateFileExists,privateFileMetadata,deletePrivateFile,
  deletePrivateFileVersion,privateStorageLocation,type FileKind} from '../private-files.js';

if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Isolated test database required');
const location=privateStorageLocation();
assert.match(location.prefix,/\/vernatun-test\/qa_[a-f0-9]{20}\/$/);
const fixtures=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const body=Buffer.from('%PDF-1.4\norphan cleanup test\n%%EOF');
const owned:{kind:FileKind;key:string}[]=[];
const future=()=>Date.now()+96*3600000; // Age without modifying any object metadata.
const only=(report:FileInventory,key:string)=>({...report,objects:report.objects.filter(e=>e.key===key)});
async function create(kind:FileKind='documents'){
  const key=randomUUID()+(kind==='photos'?'.jpg':'');
  owned.push({kind,key});
  await savePrivateFile(kind,key,body,kind==='photos'?'image/jpeg':'application/pdf');
  return key;
}
async function insertDocument(db:{query:typeof pool.query},key:string){
  return db.query(`INSERT INTO documents(organization_id,building_id,unit_id,title,visibility,storage_key,media_type,uploaded_by)
    VALUES($1,$2,$3,'Cleanup test','unit_owner',$4,'application/pdf',$5) RETURNING *`,
    [fixtures.fixtures.orgA,fixtures.fixtures.ba,fixtures.fixtures.ua,key,fixtures.accounts.org_admin.id]);
}
async function metadataRows(){
  const rows=[];
  for(const table of ['request_photos','file_attachments','documents','platform_task_attachments']){
    rows.push((await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows);
  }
  return rows;
}
after(async()=>{
  try{for(const f of owned)await deletePrivateFile(f.kind,f.key)}
  finally{await pool.end()}
});

test('Inventory is read-only; grace period, all three tables, exact namespace and repeatable deletion',async()=>{
  const orphan=await create(),recent=await create();
  const doc=await create(),photo=await create('photos'),attachment=await create('photos'),taskFile=await create();
  await insertDocument(pool,doc);
  const admin=fixtures.accounts.platform_admin.id;
  const task=(await pool.query(`INSERT INTO platform_tasks(title,created_by,updated_by)
    VALUES('Inventory test task',$1,$1) RETURNING id`,[admin])).rows[0];
  await pool.query(`INSERT INTO platform_task_attachments(task_id,storage_key,file_name,media_type,byte_size,uploaded_by)
    VALUES($1,$2,'task-file.pdf','application/pdf',$3,$4)`,[task.id,taskFile,body.length,admin]);
  await pool.query('INSERT INTO request_photos(request_id,author_id,storage_key) SELECT id,$1,$2 FROM resident_requests LIMIT 1',[fixtures.accounts.unit_owner.id,photo]);
  await pool.query('INSERT INTO file_attachments(defect_id,author_id,storage_key) SELECT id,$1,$2 FROM defects LIMIT 1',[fixtures.accounts.developer.id,attachment]);
  const unknown=location.bucket.file(location.prefix+'photos/not-a-managed-key');
  await unknown.save(body,{resumable:false});
  try{
    const before=await metadataRows();
    const objectBefore=await privateFileMetadata('documents',doc);
    const report=await inventoryPrivateFiles();
    assert.equal(report.graceHours,72);
    for(const key of [orphan,recent])assert.equal(report.objects.find(e=>e.key===key)!.status,'recent');
    for(const key of [doc,photo,attachment,taskFile])assert.equal(report.objects.find(e=>e.key===key)!.status,'referenced');
    assert.ok(report.ignored>=1);
    assert.equal((await cleanPrivateFiles(only(report,recent))).deleted,0);
    assert.ok(await privateFileExists('documents',recent));
    const now=future(),oldReport=await inventoryPrivateFiles(72,now);
    assert.equal(oldReport.objects.find(e=>e.key===orphan)!.status,'candidate');
    assert.equal((await cleanPrivateFiles(only(oldReport,orphan),now)).deleted,1);
    assert.equal((await cleanPrivateFiles(only(oldReport,orphan),now)).missing,1);
    assert.deepEqual(await metadataRows(),before);
    assert.deepEqual(await privateFileMetadata('documents',doc),objectBefore);
    for(const key of [doc,photo,attachment,taskFile]){
      // Even a manually marked candidate cannot override a live reference.
      const selected=only(oldReport,key);selected.objects[0]!.status='candidate';
      assert.equal((await cleanPrivateFiles(selected,now)).referenced,1);
    }
    assert.deepEqual(await readPrivateFile('documents',doc),body);
    assert.deepEqual(await readPrivateFile('documents',taskFile),body);
    assert.deepEqual(await readPrivateFile('photos',photo),body);
    assert.deepEqual(await readPrivateFile('photos',attachment),body);
    assert.ok((await unknown.exists())[0]);
    await assert.rejects(inventoryPrivateFiles(minimumGraceHours-1));
    await assert.rejects(cleanPrivateFiles({...oldReport,scope:'0'.repeat(64)},now),/different storage prefix/);
    await assert.rejects(cleanPrivateFiles({...oldReport,graceHours:0},now));
    await assert.rejects(cleanPrivateFiles({...oldReport,objects:[{...oldReport.objects[0],key:'../escape'}]},now));
  }finally{await unknown.delete({ignoreNotFound:true})}
});

test('A new reference after the report and uncommitted inserts are never deleted',async()=>{
  const key=await create(),now=future();
  const report=only(await inventoryPrivateFiles(72,now),key);
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    await insertDocument(db,key);
    assert.equal((await cleanPrivateFiles(report,now)).busy,1);
    assert.ok(await privateFileExists('documents',key));
    await db.query('COMMIT');
    assert.equal((await cleanPrivateFiles(report,now)).referenced,1);
  }finally{await db.query('ROLLBACK');db.release()}
});

test('Pending uploads keep their lock until metadata commits, including an arbitrarily long pause',async()=>{
  const key=randomUUID();owned.push({kind:'documents',key});
  let ready!:()=>void,finish!:()=>void;
  const saved=new Promise<void>(resolve=>{ready=resolve});
  const release=new Promise<void>(resolve=>{finish=resolve});
  const upload=saveAndCommitPrivateFile('documents',key,body,'application/pdf',async db=>{
    ready();await release;return insertDocument(db,key);
  });
  try{
    await saved;
    const now=future(),report=only(await inventoryPrivateFiles(72,now),key);
    assert.equal(report.objects[0]!.status,'candidate');
    assert.equal((await cleanPrivateFiles(report,now)).busy,1);
    assert.ok(await privateFileExists('documents',key));
    finish();await upload;
    assert.equal((await cleanPrivateFiles(report,now)).referenced,1);
  }finally{finish();await upload}
});

test('Failed metadata transaction leaves a recoverable orphan instead of deleting ambiguous committed bytes',async()=>{
  const key=randomUUID();owned.push({kind:'documents',key});
  await assert.rejects(saveAndCommitPrivateFile('documents',key,body,'application/pdf',async db=>{
    await insertDocument(db,key);throw new Error('Simulated failure before COMMIT');
  }),/Simulated failure/);
  assert.equal((await pool.query('SELECT 1 FROM documents WHERE storage_key=$1',[key])).rowCount,0);
  assert.ok(await privateFileExists('documents',key));
  const recent=only(await inventoryPrivateFiles(),key);
  assert.equal(recent.objects[0]!.status,'recent');
  const now=future(),report=only(await inventoryPrivateFiles(72,now),key);
  assert.equal((await cleanPrivateFiles(report,now)).deleted,1);
});

test('Replacement generations, conditional deletion and parallel cleanup passes are safe',async()=>{
  const key=await create(),now=future();
  const report=only(await inventoryPrivateFiles(72,now),key),entry=report.objects[0]!;
  await deletePrivateFile('documents',key);
  await savePrivateFile('documents',key,Buffer.from('replacement'),'application/pdf');
  assert.equal((await cleanPrivateFiles(report,now)).changed,1);
  await assert.rejects(deletePrivateFileVersion('documents',key,entry.generation,entry.metageneration),{code:412});
  assert.deepEqual(await readPrivateFile('documents',key),Buffer.from('replacement'));
  const parallelKey=await create('photos'),parallel=only(await inventoryPrivateFiles(72,now),parallelKey);
  const results=await Promise.all([cleanPrivateFiles(parallel,now),cleanPrivateFiles(parallel,now)]);
  assert.equal(results.reduce((n,r)=>n+r.deleted,0),1);
  assert.equal(results.reduce((n,r)=>n+r.busy+r.missing,0),1);
});
