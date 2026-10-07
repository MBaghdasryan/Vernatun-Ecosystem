import {z} from 'zod';
import {pool} from './db.js';
import {privateStorageLocation,privateKeyPattern,privateFileLockKey,privateFileMetadata,deletePrivateFileVersion} from './private-files.js';

export const minimumGraceHours=24;
export const defaultGraceHours=72;
const objectSchema=z.object({
  kind:z.enum(['photos','documents']),key:z.string().regex(privateKeyPattern),
  generation:z.string().regex(/^[1-9]\d*$/),metageneration:z.string().regex(/^[1-9]\d*$/),
  created:z.string().datetime(),updated:z.string().datetime(),bytes:z.string().regex(/^\d+$/),
  status:z.enum(['referenced','recent','candidate','unknown']),
}).strict();
export const inventorySchema=z.object({
  version:z.literal(1),scope:z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt:z.string().datetime(),graceHours:z.number().finite().min(minimumGraceHours),
  objects:z.array(objectSchema),ignored:z.number().int().nonnegative(),
}).strict();
export type FileInventory=z.infer<typeof inventorySchema>;
type Entry=FileInventory['objects'][number];

const referenceQuery=`SELECT storage_key FROM request_photos
  UNION SELECT storage_key FROM file_attachments
  UNION SELECT storage_key FROM incident_attachments
  UNION SELECT storage_key FROM documents
  UNION SELECT storage_key FROM document_versions`;
const referencedQuery=`SELECT EXISTS(
  SELECT 1 FROM request_photos WHERE storage_key=$1
  UNION ALL SELECT 1 FROM file_attachments WHERE storage_key=$1
  UNION ALL SELECT 1 FROM incident_attachments WHERE storage_key=$1
  UNION ALL SELECT 1 FROM documents WHERE storage_key=$1
  UNION ALL SELECT 1 FROM document_versions WHERE storage_key=$1
) AS referenced`;
function oldEnough(entry:Entry,now:number,graceHours:number){
  const cutoff=now-graceHours*3600000;
  return Date.parse(entry.created)<=cutoff&&Date.parse(entry.updated)<=cutoff;
}
function snapshot(kind:Entry['kind'],key:string,metadata:Awaited<ReturnType<typeof privateFileMetadata>>){
  return objectSchema.safeParse({
    kind,key,generation:String(metadata.generation??''),metageneration:String(metadata.metageneration??''),
    created:metadata.timeCreated,updated:metadata.updated,bytes:String(metadata.size??''),status:'unknown',
  });
}

// No writes to PostgreSQL, object metadata or bytes. Unknown objects are never candidates.
export async function inventoryPrivateFiles(graceHours=defaultGraceHours,now=Date.now()):Promise<FileInventory>{
  inventorySchema.shape.graceHours.parse(graceHours);
  const {bucket,prefix,scope}=privateStorageLocation();
  const references=new Set<string>((await pool.query(referenceQuery)).rows.map(r=>r.storage_key));
  const [files]=await bucket.getFiles({prefix});
  const report:FileInventory={version:1,scope,generatedAt:new Date(now).toISOString(),graceHours,objects:[],ignored:0};
  for(const file of files){
    const relative=file.name.slice(prefix.length);
    const match=relative.match(/^(photos|documents)\/([^/]+)$/);
    if(!match||!privateKeyPattern.test(match[2]!)){report.ignored++;continue}
    let metadata;
    try{[metadata]=await file.getMetadata()}
    catch(error){if((error as {code?:number}).code===404){report.ignored++;continue}throw error}
    const parsed=snapshot(match[1] as Entry['kind'],match[2]!,metadata);
    if(!parsed.success){report.ignored++;continue}
    const entry=parsed.data;
    entry.status=references.has(entry.key)?'referenced':oldEnough(entry,now,graceHours)?'candidate':'recent';
    report.objects.push(entry);
  }
  report.objects.sort((a,b)=>`${a.kind}/${a.key}`.localeCompare(`${b.kind}/${b.key}`));
  return report;
}

// Only objects approved in the saved report can be considered. Each deletion is
// independently revalidated and committed, so an interrupted pass is repeatable.
export async function cleanPrivateFiles(input:unknown,now=Date.now()){
  const report=inventorySchema.parse(input);
  if(report.scope!==privateStorageLocation().scope)throw new Error('Inventory belongs to a different storage prefix');
  if(Date.parse(report.generatedAt)>now)throw new Error('Inventory is dated in the future');
  const result={deleted:0,missing:0,referenced:0,recent:0,changed:0,busy:0};
  for(const entry of report.objects.filter(e=>e.status==='candidate')){
    const db=await pool.connect();
    try{
      await db.query('BEGIN');
      const lock=await db.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',[privateFileLockKey(entry.kind,entry.key)]);
      if(!lock.rows[0].locked){result.busy++;continue}
      // Protect against new references from other writers/restores as well.
      // NOWAIT skips activity rather than blocking the application.
      await db.query('LOCK TABLE request_photos, file_attachments, incident_attachments, documents, document_versions IN SHARE MODE NOWAIT');
      if((await db.query(referencedQuery,[entry.key])).rows[0].referenced){result.referenced++;continue}
      const parsed=snapshot(entry.kind,entry.key,await privateFileMetadata(entry.kind,entry.key));
      if(!parsed.success){result.changed++;continue}
      const current=parsed.data;
      if(['generation','metageneration','created','updated','bytes'].some(k=>current[k as keyof Entry]!==entry[k as keyof Entry])){
        result.changed++;continue;
      }
      if(!oldEnough(current,now,report.graceHours)){result.recent++;continue}
      await deletePrivateFileVersion(entry.kind,entry.key,entry.generation,entry.metageneration);
      result.deleted++;
      await db.query('COMMIT');
    }catch(error){
      const code=(error as {code?:number|string}).code;
      if(code===404)result.missing++;
      else if(code===412)result.changed++;
      else if(code==='55P03')result.busy++;
      else throw error; // Fail closed on database/storage failures.
    }finally{
      try{await db.query('ROLLBACK')}finally{db.release()}
    }
  }
  return result;
}
