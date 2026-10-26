import {spawn} from 'node:child_process';
import type {PoolClient,Client} from 'pg';
import {sha256} from './backup-format.js';

export function identifier(name:string){
  if(!/^[a-z_][a-z0-9_]*$/.test(name))throw new Error('Invalid SQL identifier');
  return `"${name}"`;
}
// Credentials are child environment only, never process arguments or diagnostics.
export async function postgresTool(tool:'pg_dump'|'pg_restore',connectionString:string,args:string[],timeoutMs=0){
  const url=new URL(connectionString);
  const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',
    PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),
    PGDATABASE:decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE:url.searchParams.get('sslmode')||'prefer',PGOPTIONS:url.searchParams.get('options')||''};
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(tool,args,{env,stdio:['ignore','ignore','pipe']});
    const deadline=timeoutMs?setTimeout(()=>child.kill('SIGKILL'),timeoutMs):undefined;
    deadline?.unref();
    child.once('close',()=>{if(deadline)clearTimeout(deadline)});
    child.once('error',()=>{if(deadline)clearTimeout(deadline)});
    // Diagnostics may contain private values. Report only a fixed classification.
    let publicSchemaExists=false;
    child.stderr.on('data',chunk=>{
      if(String(chunk).includes('schema "public" already exists'))publicSchemaExists=true;
    });
    child.once('error',()=>reject(new Error(`${tool} could not start`)));
    child.once('close',code=>code===0?resolve():reject(new Error(`${tool} failed (exit ${code}); ${publicSchemaExists?'empty target public schema already exists':'check tool version, connection and schema dependencies'}`)));
  });
}
export async function tableFingerprints(db:PoolClient|Client,schema:string,names:string[]){
  const result=[];
  for(const name of [...names].sort()){
    // JSON text sorted server-side gives stable hashes regardless of physical row order.
    const rows=(await db.query(`SELECT row_to_json(t)::text AS value FROM ${identifier(schema)}.${identifier(name)} t ORDER BY row_to_json(t)::text COLLATE "C"`)).rows;
    result.push({name,rows:rows.length,sha256:sha256(Buffer.from(rows.map(r=>r.value).join('\n')))});
  }
  return result;
}
export async function referencedFiles(db:PoolClient|Client,schema:string){
  const s=identifier(schema);
  const hasIncidents=(await db.query("SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name='incident_attachments'",[schema])).rowCount;
  const hasAvatars=(await db.query("SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name='resident_avatars'",[schema])).rowCount;
  const hasListings=(await db.query("SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name='resident_listing_photos'",[schema])).rowCount;
  return (await db.query(`
    SELECT 'photos' AS kind,storage_key AS key,'image/jpeg' AS media_type FROM ${s}.request_photos
    ${hasAvatars?`UNION SELECT 'photos',storage_key,'image/jpeg' FROM ${s}.resident_avatars`:''}
    UNION SELECT 'photos',storage_key,'image/jpeg' FROM ${s}.file_attachments
    ${hasIncidents?`UNION SELECT 'photos',storage_key,'image/jpeg' FROM ${s}.incident_attachments`:''}
    ${hasListings?`UNION SELECT 'photos',storage_key,'image/jpeg' FROM ${s}.resident_listing_photos`:''}
    UNION SELECT 'documents',storage_key,media_type FROM ${s}.documents
    ORDER BY kind,key,media_type`)).rows as {kind:'photos'|'documents';key:string;media_type:string}[];
}
