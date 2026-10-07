import {mkdtemp,readFile,writeFile,rm,stat,readdir,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {pool} from './db.js';
import {config} from './config.js';
import {identifier,postgresTool,referencedFiles} from './backup-postgres.js';
import {readPrivateFile,privateFileLockKey} from './private-files.js';
import {operationsCipher} from './operations-encryption.js';
import {backupStorage,backupByteLimit} from './operations-backup-storage.js';
import {apiBuildId} from './system-diagnostics.js';

export const backupKinds=['database','files','full_data','configuration','platform_snapshot'] as const;
const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const component=z.object({name:z.string().regex(/^(database\.dump|configuration\.json|source\.json|(photos|documents)\/[a-f0-9-]{36}(?:\.jpg)?)$/i),mediaType:z.string().max(100).optional(),bytes:z.number().int().nonnegative(),sha256:z.string().regex(/^[a-f0-9]{64}$/),content:z.string()}).strict();
const snapshot=z.object({
 format:z.literal(1),id:z.string().uuid(),kind:z.enum(backupKinds),createdAt:z.string().datetime(),
 build:z.string().nullable(),migration:z.string(),schema:z.string(),
 components:z.array(component).max(5003),
}).strict();
export type Snapshot=z.infer<typeof snapshot>;
export async function sourceRoot(){
 let root=process.cwd();
 for(let i=0;i<5;i++,root=resolve(root,'..')){
  try{await access(join(root,'pnpm-workspace.yaml'));await access(join(root,'artifacts/vernatun/src'));return root}catch{/* Try parent. */}
 }
 throw new Error('Source package unavailable in this runtime');
}
async function sourceBundle(){
 const root=await sourceRoot(),files:{path:string;content:string}[]=[];let size=0;
 async function walk(path:string){
  for(const d of await readdir(join(root,path),{withFileTypes:true})){
   if(d.isSymbolicLink()||d.name.startsWith('.')||['node_modules','tests','dist'].includes(d.name))continue;
   const p=path+'/'+d.name;
   if(d.isDirectory()){await walk(p);continue}
   if(!/\.(ts|tsx|js|mjs|css|json|html|sql|toml|png|jpg|jpeg|svg|webp|woff2?)$/.test(d.name))continue;
   if((await stat(join(root,p))).size>24*1024*1024)throw new Error('Source file exceeds bounded capacity');
   const b=await readFile(join(root,p));size+=b.length;
   if(size>24*1024*1024||files.length>=5000)throw new Error('Source package exceeds bounded capacity');
   files.push({path:p,content:b.toString('base64')});
  }
 }
 for(const path of ['artifacts/vernatun','artifacts/api-server/src','artifacts/api-server/archive/vernatun/server','lib','scripts'])await walk(path);
 for(const path of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','artifacts/api-server/package.json','artifacts/api-server/tsconfig.json','artifacts/api-server/build.mjs']){
  const b=await readFile(join(root,path));files.push({path,content:b.toString('base64')});
 }
 for(const path of (await readdir(root)).filter(p=>/^tsconfig(?:\.[a-z-]+)?\.json$/.test(p))){
  files.push({path,content:(await readFile(join(root,path))).toString('base64')});
 }
 return Buffer.from(JSON.stringify({format:1,files}));
}
async function boundedRead(kind:'photos'|'documents',key:string){
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([readPrivateFile(kind,key),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Storage deadline')),5000);timer.unref()})])}
 finally{if(timer)clearTimeout(timer)}
}
export function unpackSnapshot(bytes:Buffer,id:string):Snapshot{
 const value=snapshot.parse(JSON.parse(gunzipSync(bytes,{maxOutputLength:96*1024*1024}).toString('utf8')));
 if(value.id!==id)throw new Error('Backup identity mismatch');
 const names=new Set<string>();
 for(const c of value.components){
  if(names.has(c.name))throw new Error('Duplicate backup component');names.add(c.name);
  const b=Buffer.from(c.content,'base64');
  if(b.length!==c.bytes||digest(b)!==c.sha256||b.toString('base64')!==c.content)throw new Error('Backup checksum mismatch');
 }
 if(['database','full_data','platform_snapshot'].includes(value.kind)&&!names.has('database.dump'))throw new Error('Database component missing');
 if(['configuration','platform_snapshot'].includes(value.kind)&&!names.has('configuration.json'))throw new Error('Configuration component missing');
 if(value.kind==='platform_snapshot'&&!names.has('source.json'))throw new Error('Source component missing');
 return value;
}
export async function buildSnapshot(id:string,kind:Snapshot['kind']){
 const startedAt=Date.now();
 const db=await pool.connect();const temp=await mkdtemp(join(tmpdir(),'vernatun-snapshot-'));
 const components:Snapshot['components']=[];let total=0;
 const add=(name:string,bytes:Buffer,mediaType?:string)=>{
  total+=bytes.length;if(total>64*1024*1024||components.length>=5003)throw new Error('Backup exceeds bounded worker capacity');
  components.push({name,bytes:bytes.length,sha256:digest(bytes),content:bytes.toString('base64'),...(mediaType?{mediaType}:{})});
 };
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  await db.query("SET LOCAL lock_timeout='1s'");
  await db.query("SET LOCAL statement_timeout='30s'");
  const schema=String((await db.query('SELECT current_schema() AS s')).rows[0].s);
  // Locks ensure the SQL snapshot and referenced immutable bytes form a pair.
  // NOWAIT rejects a busy database rather than queuing a disruptive backup.
  const names=(await db.query(`SELECT tablename FROM pg_tables WHERE schemaname=$1
   AND tablename NOT IN ('session','system_job_runs','system_log_events','operations_backups') ORDER BY tablename`,[schema])).rows.map(r=>String(r.tablename));
  if(names.length)await db.query(`LOCK TABLE ${names.map(n=>`${identifier(schema)}.${identifier(n)}`).join(',')} IN SHARE MODE NOWAIT`);
  const migration=String((await db.query('SELECT max(name) AS name FROM schema_migrations')).rows[0].name??'unknown');
  if(['configuration','platform_snapshot'].includes(kind)){
   const plans=(await db.query('SELECT id,name,amount_minor,currency,building_limit,allowed_modules,grace_days FROM subscription_plans ORDER BY id')).rows;
   const modules=(await db.query('SELECT organization_id,module,enabled,override_state FROM module_entitlements ORDER BY organization_id,module')).rows;
   const permissions=(await db.query('SELECT * FROM role_permissions ORDER BY role_key,permission_key')).rows;
   const backupPolicies=(await db.query('SELECT kind,enabled,frequency,provider,retention_days,keep_last,auto_delete FROM operations_backup_policies ORDER BY kind')).rows;
   add('configuration.json',Buffer.from(JSON.stringify({plans,modules,permissions,backupPolicies})));
  }
  if(['database','full_data','platform_snapshot'].includes(kind)){
   const snapshotId=String((await db.query('SELECT pg_export_snapshot() AS id')).rows[0].id);
   const path=join(temp,'database.dump');
   await postgresTool('pg_dump',config.DATABASE_URL,['--format=custom','--no-owner','--no-acl',
    '--schema='+schema,'--snapshot='+snapshotId,'--exclude-table-data='+schema+'.session',
    '--exclude-table-data='+schema+'.operations_backups','--file='+path],60000);
   if((await stat(path)).size>64*1024*1024)throw new Error('Database backup exceeds bounded capacity');
   add('database.dump',await readFile(path));
  }
  if(['files','full_data','platform_snapshot'].includes(kind)){
   const refs=await referencedFiles(db,schema);
   refs.push(...(await db.query("SELECT 'documents' AS kind,storage_key AS key,media_type FROM document_versions")).rows);
   refs.push(...(await db.query("SELECT 'photos' AS kind,web_branding->>'logo_key' AS key,'image/jpeg' AS media_type FROM organizations WHERE web_branding->>'logo_key' IS NOT NULL")).rows);
   const unique=new Map(refs.map(r=>[r.kind+'/'+r.key,r]));
   if(unique.size>5000)throw new Error('File backup exceeds bounded capacity');
   for(const [name,r] of unique){
    if(Date.now()-startedAt>120000)throw new Error('Snapshot worker deadline');
    if(!(await db.query('SELECT pg_try_advisory_xact_lock($1::bigint) AS ok',[privateFileLockKey(r.kind,r.key)])).rows[0].ok)throw new Error('Private file busy');
    add(name,await boundedRead(r.kind,r.key),r.media_type);
   }
  }
  if(kind==='platform_snapshot')add('source.json',await sourceBundle());
  const result:Snapshot={format:1,id,kind,createdAt:new Date().toISOString(),build:apiBuildId,migration,schema,components};
  const bytes=gzipSync(Buffer.from(JSON.stringify(result)));
  unpackSnapshot(bytes,id);
  await db.query('COMMIT');return {bytes,build:apiBuildId,migration};
 }catch(e){await db.query('ROLLBACK');throw e}finally{db.release();await rm(temp,{recursive:true,force:true})}
}
export async function verifyDatabaseComponent(value:Snapshot){
 const dump=value.components.find(c=>c.name==='database.dump');
 if(!dump)return;
 const temp=await mkdtemp(join(tmpdir(),'vernatun-verify-'));
 try{
  const path=join(temp,'database.dump');
  await writeFile(path,Buffer.from(dump.content,'base64'),{mode:0o600,flag:'wx'});
  // Decode the whole archive to a discarded SQL stream. Never connect to a
  // restore target or execute SQL. This is readability, NOT a recovery drill.
  await postgresTool('pg_restore',config.DATABASE_URL,['--no-owner','--no-acl','--file=/dev/null',path],60000);
 }finally{await rm(temp,{recursive:true,force:true})}
}
export async function verifyStoredBackup(id:string,checksum:string,provider:string){
 const store=backupStorage();
 if(store.name!==provider)throw new Error('Backup storage provider changed');
 const bytes=await store.read(id);
 if(bytes.length>backupByteLimit||digest(bytes)!==checksum)throw new Error('Backup object checksum mismatch');
 const plain=operationsCipher().open(JSON.parse(bytes.toString('utf8')),'backup:'+id);
 const value=unpackSnapshot(plain,id);
 await verifyDatabaseComponent(value);
 return value;
}
export async function runPendingBackup(){
 const lock=await pool.connect();let acquired=false;
 try{
  acquired=!!(await lock.query('SELECT pg_try_advisory_lock(73192842) AS ok')).rows[0].ok;
  if(!acquired)return 0;
  // A previous worker cannot still own this lock. Never present interrupted work as complete.
  await lock.query("UPDATE operations_backups SET status='failed',error_code='worker_interrupted',finished_at=now() WHERE status='running'");
  const row=(await lock.query(`UPDATE operations_backups SET status='running' WHERE id=(
   SELECT id FROM operations_backups WHERE status='pending' ORDER BY created_at LIMIT 1
  ) RETURNING id,kind,provider,created_by`)).rows[0];
  if(!row)return 0;
  let written=false;
  try{
   const cipher=operationsCipher(),store=backupStorage();
   if(store.name!==row.provider)throw new Error('Storage provider changed');
   const built=await buildSnapshot(row.id,row.kind);
   const bytes=Buffer.from(JSON.stringify(cipher.seal(built.bytes,'backup:'+row.id)));
   if(bytes.length>backupByteLimit)throw new Error('Backup exceeds size limit');
   await store.write(row.id,bytes);written=true;
   const checksum=digest(bytes);
   await verifyStoredBackup(row.id,checksum,row.provider);
   await lock.query('BEGIN');
   await lock.query(`UPDATE operations_backups SET status='completed',finished_at=now(),bytes=$2,checksum=$3,
    application_version=$4,migration_version=$5,verification='verified',verified_at=now() WHERE id=$1`,
   [row.id,bytes.length,checksum,built.build,built.migration]);
   await lock.query(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,details)
    VALUES($1,'system.backup.completed','backup',$2,jsonb_build_object('bytes',$3::bigint))`,[row.created_by,row.id,bytes.length]);
   await lock.query('COMMIT');return 1;
  }catch{
   await lock.query('ROLLBACK');
   // Delete only the random object created by this failed job, never a prior snapshot.
   if(written)try{await backupStorage().remove(row.id)}catch{/* Marked failed, never eligible for restore. */}
   await lock.query("UPDATE operations_backups SET status='failed',finished_at=now(),error_code='backup_failed' WHERE id=$1",[row.id]);
   await lock.query("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id) VALUES($1,'system.backup.failed','backup',$2)",[row.created_by,row.id]);
   throw new Error('Backup job failed; see its safe registry status');
  }
 }finally{if(acquired)await lock.query('SELECT pg_advisory_unlock(73192842)');lock.release()}
}
