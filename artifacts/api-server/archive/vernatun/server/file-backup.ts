import {mkdtemp,readFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {pool} from './db.js';
import {privateStorageLocation,privateFileLockKey,privateKeyPattern} from './private-files.js';
import {backupLocation,sha256,validateManifest,type BackupManifest} from './backup-format.js';
import {identifier,postgresTool,referencedFiles,tableFingerprints} from './backup-postgres.js';

// This command only supports the current development/test environment.
// It does not configure scheduled Replit backups or mutate application rows.
export async function createPrivateBackup(){
  if(process.env.NODE_ENV==='production')throw new Error('Production backup requires a separately approved operations procedure');
  const connection=process.env.DATABASE_URL;
  if(!connection)throw new Error('DATABASE_URL required');
  const id=`backup_${randomBytes(10).toString('hex')}`;
  const storage=privateStorageLocation(),dest=backupLocation(id);
  const work=await mkdtemp(join(tmpdir(),'vernatun-backup-'));
  await chmod(work,0o700);
  const db=await pool.connect();
  try{
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await db.query("SET LOCAL lock_timeout='5s'");
    await db.query("SET LOCAL idle_in_transaction_session_timeout='15min'");
    const schema=(await db.query('SELECT current_schema() AS name')).rows[0].name as string;
    identifier(schema);
    const names=(await db.query(`SELECT tablename AS name FROM pg_tables WHERE schemaname=$1 ORDER BY tablename`,[schema])).rows.map(r=>r.name as string);
    if(!names.includes('documents')||!names.includes('request_photos')||!names.includes('file_attachments'))throw new Error('Not a Vernatun schema');
    // Freeze application writes while SQL and objects are captured. Abort on contention.
    await db.query(`LOCK TABLE ${names.map(n=>`${identifier(schema)}.${identifier(n)}`).join(',')} IN SHARE MODE`);
    const refs=await referencedFiles(db,schema);
    const seen=new Set<string>();
    for(const file of refs){
      if(!privateKeyPattern.test(file.key))throw new Error('Invalid private storage key');
      const name=`${file.kind}/${file.key}`;
      if(seen.has(name))throw new Error('Conflicting file reference metadata');
      seen.add(name);
      // Coordinate with reviewed cleanup and server uploads.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[privateFileLockKey(file.kind,file.key)]);
    }
    const snapshot=(await db.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    const dumpPath=join(work,'database.dump');
    await postgresTool('pg_dump',connection,['--format=custom','--no-owner','--no-acl',`--schema=${schema}`,`--snapshot=${snapshot}`,`--file=${dumpPath}`]);
    const dump=await readFile(dumpPath);
    const createdAt=new Date().toISOString();
    const manifest:BackupManifest={version:1,id,createdAt,retainUntil:new Date(Date.parse(createdAt)+30*86400000).toISOString(),
      schema,sourceScope:storage.scope,dump:{sha256:sha256(dump),bytes:dump.length},
      tables:await tableFingerprints(db,schema,names),files:[]};
    const save=async(name:string,bytes:Buffer)=>{
      const object=dest.bucket.file(dest.prefix+name);
      await object.save(bytes,{resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},
        metadata:{contentType:'application/octet-stream',cacheControl:'private, no-store'}});
      if(sha256((await object.download())[0])!==sha256(bytes))throw new Error('Backup write checksum mismatch');
    };
    await save('database.dump',dump);
    for(const file of refs){
      const source=storage.bucket.file(`${storage.prefix}${file.kind}/${file.key}`);
      const [metadata]=await source.getMetadata();
      if(!metadata.generation)throw new Error('Object generation missing');
      const bytes=(await storage.bucket.file(source.name,{generation:metadata.generation}).download())[0];
      await save(`files/${file.kind}/${file.key}`,bytes);
      manifest.files.push({kind:file.kind,key:file.key,mediaType:file.media_type,sha256:sha256(bytes),
        bytes:bytes.length,generation:String(metadata.generation),metadata:metadata.metadata as Record<string,string>||{}});
    }
    validateManifest(manifest);
    if((await db.query('COMMIT')).command!=='COMMIT')throw new Error('Backup snapshot transaction did not commit');
    // Manifest is the completion marker. Partial copies cannot be restored.
    await save('manifest.json',Buffer.from(JSON.stringify(manifest)));
    return manifest;
  }catch(error){
    await db.query('ROLLBACK').catch(()=>{});
    // This new, randomly generated backup has no valid completion marker.
    // Remove only its own partial copies, never source bytes/rows or older backups.
    try{
      const [objects]=await dest.bucket.getFiles({prefix:dest.prefix});
      for(const object of objects)await object.delete({ignoreNotFound:true});
    }catch{/* Failed partial cleanup does not turn an incomplete set into a backup. */}
    throw error;
  }finally{db.release();await rm(work,{recursive:true,force:true})}
}
