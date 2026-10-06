import {spawn} from 'node:child_process';
import type {PoolClient,Client} from 'pg';
import {sha256} from './backup-format.js';

export function identifier(name:string){
  if(!/^[a-z_][a-z0-9_]*$/.test(name))throw new Error('Invalid SQL identifier');
  return `"${name}"`;
}
// Credentials are child environment only, never process arguments or diagnostics.
export async function postgresTool(tool:'pg_dump'|'pg_restore',connectionString:string,args:string[]){
  const url=new URL(connectionString);
  const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',
    PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),
    PGDATABASE:decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE:url.searchParams.get('sslmode')||'prefer',PGOPTIONS:url.searchParams.get('options')||''};
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(tool,args,{env,stdio:['ignore','ignore','pipe']});
    // pg diagnostics can contain private table values; intentionally don't log them.
    child.stderr.resume();
    child.once('error',()=>reject(new Error(`${tool} could not start`)));
    child.once('close',code=>code===0?resolve():reject(new Error(`${tool} failed (exit ${code}); check tool version, connection and schema dependencies`)));
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
  return (await db.query(`
    SELECT 'photos' AS kind,storage_key AS key,'image/jpeg' AS media_type FROM ${s}.request_photos
    UNION SELECT 'photos',storage_key,'image/jpeg' FROM ${s}.file_attachments
    UNION SELECT 'documents',storage_key,media_type FROM ${s}.documents
    ORDER BY kind,key,media_type`)).rows as {kind:'photos'|'documents';key:string;media_type:string}[];
}
