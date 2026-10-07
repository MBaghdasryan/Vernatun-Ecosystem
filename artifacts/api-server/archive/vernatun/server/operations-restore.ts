import pg from 'pg';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config} from './config.js';
import {pool} from './db.js';
import {identifier,postgresTool,tableFingerprints,referencedFiles} from './backup-postgres.js';
import {verifyStoredBackup,type Snapshot} from './operations-backups.js';

export async function loadRecoverySnapshot(id:string){
 const row=(await pool.query("SELECT checksum,provider FROM operations_backups WHERE id=$1 AND status='completed'",[id])).rows[0];
 if(!row)throw new Error('Backup unavailable');
 return verifyStoredBackup(id,row.checksum,row.provider);
}
export function recoverySummary(s:Snapshot,currentMigration:string){
 const files=s.components.filter(c=>/^(photos|documents)\//.test(c.name));
 const database=s.components.some(c=>c.name==='database.dump');
 return {id:s.id,kind:s.kind,createdAt:s.createdAt,build:s.build,migration:s.migration,currentMigration,
  migrationMatches:s.migration===currentMigration,database,files:files.length,
  fileBytes:files.reduce((n,c)=>n+c.bytes,0),configuration:s.components.some(c=>c.name==='configuration.json'),
  source:s.components.some(c=>c.name==='source.json'),fingerprints:!!s.tables?.length,
  isolatedDrillSupported:config.NODE_ENV!=='production'&&database&&!!s.tables?.length&&s.migration===currentMigration,
  restoreMode:'isolated_cli_only' as const};
}

// The only target is a freshly generated disposable database. Never accepts a
// database name/URL, uploads, raw SQL, or a working private-storage destination.
export async function drillEncryptedBackup(id:string){
 if(config.NODE_ENV==='production')throw new Error('Production drill disabled');
 const s=await loadRecoverySnapshot(id);
 const current=String((await pool.query('SELECT max(name) AS name FROM schema_migrations')).rows[0].name);
 if(!recoverySummary(s,current).isolatedDrillSupported)throw new Error('New matching-version database backup required');
 identifier(s.schema);
 const name='vernatun_restore_'+randomBytes(10).toString('hex');
 const target=new URL(config.DATABASE_URL);target.pathname='/'+name;
 target.searchParams.set('options',`-c search_path=${s.schema},public`);
 const admin=new pg.Client({connectionString:config.DATABASE_URL});
 const db=new pg.Client({connectionString:target.toString()});
 const work=await mkdtemp(join(tmpdir(),'vernatun-encrypted-drill-'));
 let created=false,connected=false,adminConnected=false;
 let result:{tables:number;files:number;paired:boolean}|undefined;
 try{
  const dump=s.components.find(c=>c.name==='database.dump')!;
  const path=join(work,'database.dump');
  await writeFile(path,Buffer.from(dump.content,'base64'),{flag:'wx',mode:0o600});
  await admin.connect();adminConnected=true;
  await admin.query(`CREATE DATABASE ${identifier(name)} TEMPLATE template0`);created=true;
  await db.connect();connected=true;
  if(s.schema==='public'){
   const count=(await db.query("SELECT count(*)::int AS n FROM pg_class WHERE relnamespace='public'::regnamespace")).rows[0].n;
   if(count!==0)throw new Error('Scratch target is not empty');
   await db.query('DROP SCHEMA public');
  }
  await postgresTool('pg_restore',target.toString(),['--exit-on-error','--single-transaction','--no-owner','--no-acl','--dbname='+name,path],120000);
  const names=(await db.query(`SELECT tablename FROM pg_tables WHERE schemaname=$1
   AND tablename NOT IN('session','operations_backups') ORDER BY tablename`,[s.schema])).rows.map(r=>String(r.tablename));
  if(JSON.stringify(await tableFingerprints(db,s.schema,names))!==JSON.stringify(s.tables))throw new Error('Restored table mismatch');
  const empty=(await db.query(`SELECT (SELECT count(*) FROM ${identifier(s.schema)}.session)
   +(SELECT count(*) FROM ${identifier(s.schema)}.operations_backups) AS n`)).rows[0].n;
  if(Number(empty)!==0)throw new Error('Excluded operational rows unexpectedly restored');
  const paired=['full_data','platform_snapshot'].includes(s.kind);
  const files=s.components.filter(c=>/^(photos|documents)\//.test(c.name));
  if(paired){
   const refs=await referencedFiles(db,s.schema);
   refs.push(...(await db.query("SELECT 'documents' AS kind,storage_key AS key,media_type FROM document_versions")).rows);
   refs.push(...(await db.query("SELECT 'photos' AS kind,web_branding->>'logo_key' AS key,'image/jpeg' AS media_type FROM organizations WHERE web_branding->>'logo_key' IS NOT NULL")).rows);
   const expected=new Set(refs.map(r=>r.kind+'/'+r.key));
   if(expected.size!==files.length||files.some(f=>!expected.has(f.name)))throw new Error('Restored references do not match private files');
   for(const f of files){
    const dest=join(work,f.name);await mkdir(join(work,f.name.split('/')[0]),{recursive:true,mode:0o700});
    await writeFile(dest,Buffer.from(f.content,'base64'),{flag:'wx',mode:0o600});
    const bytes=await readFile(dest);
    if(bytes.length!==f.bytes||createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw new Error('Restored private bytes mismatch');
   }
  }
  result={tables:names.length,files:paired?files.length:0,paired};
 }finally{
  // Attempt every cleanup even if one fails; never claim success with leftovers.
  const errors:unknown[]=[];
  if(connected)try{await db.end()}catch(e){errors.push(e)}
  if(created)try{await admin.query(`DROP DATABASE ${identifier(name)} WITH (FORCE)`)}catch(e){errors.push(e)}
  if(adminConnected)try{await admin.end()}catch(e){errors.push(e)}
  try{await rm(work,{recursive:true,force:true})}catch(e){errors.push(e)}
  if(errors.length)throw new Error('Isolated recovery cleanup incomplete');
 }
 return result!;
}
