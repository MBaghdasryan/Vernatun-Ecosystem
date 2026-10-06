import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fork,type ChildProcess} from 'node:child_process';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import sharp from 'sharp';
import {pool} from '../db.js';
import {config} from '../config.js';
import {migratePrivateFiles} from '../file-migration.js';
import {savePrivateFile,readPrivateFile,deletePrivateFile,privateFileExists} from '../private-files.js';

if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Isolated test database required');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const cli=createRequire(import.meta.url).resolve('tsx/cli');
let server:ChildProcess|undefined,base='';
async function start(){
  server=fork(cli,['server/tests/storage-server.ts'],{stdio:['ignore','inherit','inherit','ipc']});
  const port=await new Promise<number>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Storage test server did not start')),15000);
    server!.once('message',(message:any)=>{clearTimeout(timer);resolve(message.port)});
    server!.once('exit',()=>{clearTimeout(timer);reject(new Error('Storage test server exited before ready'))});
  });
  base=`http://127.0.0.1:${port}/api`;
}
async function stop(){
  if(!server||server.exitCode!==null)return;
  const exited=once(server,'exit');server.kill('SIGTERM');await exited;server=undefined;
}
class Client{
  cookie='';csrf='';
  async call(path:string,method='GET',body?:unknown){
    const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:this.cookie,...(method!=='GET'?{'X-CSRF-Token':this.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
    const data=r.status===204?null:await r.json();if(data?.csrf)this.csrf=data.csrf;
    return {status:r.status,data};
  }
  async login(key:string){
    await this.call('/auth/session');const a=seeded.accounts[key];
    const r=await this.call('/auth/login','POST',{email:a.email,password:a.password});
    assert.equal(r.status,200);
    if(!r.data.contextId)assert.equal((await this.call('/auth/context','POST',{id:r.data.contexts.find((c:any)=>c.role_key===a.role).id})).status,200);
    return this;
  }
  upload(path:string,body:Buffer){
    return fetch(base+path,{method:'POST',headers:{Cookie:this.cookie,'X-CSRF-Token':this.csrf,'Content-Type':'application/octet-stream'},body});
  }
  download(path:string){return fetch(base+path,{headers:{Cookie:this.cookie}})}
}
let org:Client,owner:Client,family:Client,other:Client,developer:Client,contractor:Client;
before(async()=>{
  await pool.query('DELETE FROM auth_rate_limits');await start();
  org=await new Client().login('org_admin');owner=await new Client().login('unit_owner');
  family=await new Client().login('family');other=await new Client().login('second_org');
  developer=await new Client().login('developer');contractor=await new Client().login('contractor');
});
after(async()=>{await stop();await pool.end()});

test('App Storage uploads retain bytes and scoped access after a real server process restart',async()=>{
  const image=await sharp({create:{width:8,height:8,channels:3,background:'#fe980a'}}).png().toBuffer();
  const jpeg=await sharp(image).rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
  const pdf=Buffer.from('%PDF-1.4\npersistent private document\n%%EOF');
  const files:{path:string;body:Buffer;mime:string;allowed:Client;denied:Client[]}[]=[];
  for(const visibility of ['staff','residents','unit_owner']){
    const q=new URLSearchParams({buildingId:seeded.fixtures.ba,unitId:seeded.fixtures.ua,title:`Persistent ${visibility}`,visibility});
    const r=await org.upload('/documents?'+q,pdf);assert.equal(r.status,201);
    const id=(await r.json()).id;
    files.push({path:`/documents/${id}/download`,body:pdf,mime:'application/pdf',allowed:visibility==='staff'?org:owner,denied:visibility==='residents'?[other]:[family,other]});
    const row=(await pool.query('SELECT * FROM documents WHERE id=$1',[id])).rows[0];
    assert.deepEqual(await readPrivateFile('documents',row.storage_key),pdf);
  }
  const created=await owner.call('/requests','POST',{unitId:seeded.fixtures.ua,subject:'Persistent photo',description:'Storage restart test'});
  assert.equal(created.status,201);
  const requestPhoto=await owner.upload(`/requests/${created.data.id}/photos`,image);assert.equal(requestPhoto.status,201);
  files.push({path:'/photos/'+(await requestPhoto.json()).id,body:jpeg,mime:'image/jpeg',allowed:owner,denied:[family,other,contractor]});
  const defect=await developer.call('/defects','POST',{unitId:seeded.fixtures.ua,subject:'Persistent defect photo',location:'Window',contractorId:seeded.accounts.contractor.id,dueOn:'2026-10-15'});
  assert.equal(defect.status,201);
  const defectPhoto=await contractor.upload(`/defects/${defect.data.id}/photos`,image);assert.equal(defectPhoto.status,201);
  files.push({path:'/defect-photos/'+(await defectPhoto.json()).id,body:jpeg,mime:'image/jpeg',allowed:contractor,denied:[family,other]});
  async function verify(){
    for(const f of files){
      const r=await f.allowed.download(f.path);assert.equal(r.status,200);
      assert.equal(r.headers.get('content-type'),f.mime);
      assert.equal(r.headers.get('cache-control'),'private, no-store');
      assert.equal(r.headers.get('x-content-type-options'),'nosniff');
      assert.match(r.headers.get('content-disposition')!,/^attachment;/);
      assert.deepEqual(Buffer.from(await r.arrayBuffer()),f.body);
      for(const c of f.denied)assert.ok([403,404].includes((await c.download(f.path)).status));
      assert.equal((await fetch(base+f.path)).status,401);
    }
  }
  await verify();await stop();await start();await verify();
  // Revoking assignment takes effect even though the bytes remain in storage.
  await pool.query('UPDATE defects SET contractor_id=$1 WHERE id=$2',[seeded.accounts.developer.id,defect.data.id]);
  assert.equal((await contractor.download(files.at(-1)!.path)).status,404);
  const list=(await owner.call('/documents')).data;
  assert.ok(list.every((r:any)=>!('storage_key' in r)));
});

test('Legacy migration verifies bytes, is repeatable, preserves all metadata and never overwrites',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vernatun-files-'));
  const key=randomUUID(),photoKey=randomUUID()+'.jpg',defectKey=randomUUID()+'.jpg';
  const pdf=Buffer.from('%PDF-1.4\nlegacy bytes\n%%EOF');
  const photo=await sharp({create:{width:8,height:8,channels:3,background:'#ffffff'}}).jpeg().toBuffer();
  const doc=(await pool.query(`INSERT INTO documents(organization_id,building_id,unit_id,title,visibility,storage_key,media_type,uploaded_by) VALUES($1,$2,$3,'Legacy','unit_owner',$4,'application/pdf',$5) RETURNING *`,[seeded.fixtures.orgA,seeded.fixtures.ba,seeded.fixtures.ua,key,seeded.accounts.org_admin.id])).rows[0];
  const request=(await pool.query('SELECT id FROM resident_requests LIMIT 1')).rows[0].id;
  const defect=(await pool.query('SELECT id FROM defects LIMIT 1')).rows[0].id;
  const p=(await pool.query('INSERT INTO request_photos(request_id,author_id,storage_key) VALUES($1,$2,$3) RETURNING *',[request,seeded.accounts.unit_owner.id,photoKey])).rows[0];
  const d=(await pool.query('INSERT INTO file_attachments(defect_id,author_id,storage_key) VALUES($1,$2,$3) RETURNING *',[defect,seeded.accounts.developer.id,defectKey])).rows[0];
  try{
    await mkdir(join(root,'private-documents'));await mkdir(join(root,'private-photos'));
    await writeFile(join(root,'private-documents',key),pdf);
    await writeFile(join(root,'private-photos',photoKey),photo);await writeFile(join(root,'private-photos',defectKey),photo);
    assert.equal((await migratePrivateFiles(root)).pending,3);
    assert.equal((await migratePrivateFiles(root,true)).copied,3);
    assert.equal((await migratePrivateFiles(root,true)).copied,0);
    assert.deepEqual(await readPrivateFile('documents',key),pdf);
    assert.deepEqual(await readPrivateFile('photos',photoKey),photo);
    assert.deepEqual(await readPrivateFile('photos',defectKey),photo);
    assert.deepEqual((await pool.query('SELECT * FROM documents WHERE id=$1',[doc.id])).rows[0],doc);
    assert.deepEqual((await pool.query('SELECT * FROM request_photos WHERE id=$1',[p.id])).rows[0],p);
    assert.deepEqual((await pool.query('SELECT * FROM file_attachments WHERE id=$1',[d.id])).rows[0],d);
    assert.deepEqual(await readFile(join(root,'private-documents',key)),pdf);
    await writeFile(join(root,'private-documents',key),Buffer.from('different'));
    await assert.rejects(migratePrivateFiles(root,true),/checksum mismatch/);
    assert.deepEqual(await readPrivateFile('documents',key),pdf);
    await deletePrivateFile('documents',key);await rm(join(root,'private-documents',key));
    assert.equal((await migratePrivateFiles(root)).missing,1);
    await assert.rejects(readPrivateFile('documents',key),{status:404});
    await assert.rejects(privateFileExists('photos','../file'),/Invalid private storage key/);
    await assert.rejects(savePrivateFile('photos',photoKey,Buffer.from('overwrite'),'image/jpeg'));
    assert.deepEqual(await readPrivateFile('photos',photoKey),photo);
  }finally{await rm(root,{recursive:true,force:true})}
});
