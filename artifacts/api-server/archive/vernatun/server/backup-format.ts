import {z} from 'zod';
import {createHash} from 'node:crypto';
import {privateKeyPattern,privateStorageLocation} from './private-files.js';

export const sha256=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export const backupIdPattern=/^backup_[a-f0-9]{20}$/;
const checksum=z.string().regex(/^[a-f0-9]{64}$/);
export const backupManifestSchema=z.object({
  version:z.literal(1),id:z.string().regex(backupIdPattern),
  createdAt:z.string().datetime(),retainUntil:z.string().datetime(),
  schema:z.string().regex(/^[a-z_][a-z0-9_]*$/),
  sourceScope:checksum,
  dump:z.object({sha256:checksum,bytes:z.number().int().nonnegative()}).strict(),
  tables:z.array(z.object({name:z.string().regex(/^[a-z_][a-z0-9_]*$/),rows:z.number().int().nonnegative(),sha256:checksum}).strict()),
  files:z.array(z.object({
    kind:z.enum(['photos','documents']),key:z.string().regex(privateKeyPattern),
    mediaType:z.string(),sha256:checksum,bytes:z.number().int().nonnegative(),
    generation:z.string().regex(/^[1-9]\d*$/),
    metadata:z.record(z.string()),
  }).strict()),
}).strict();
export type BackupManifest=z.infer<typeof backupManifestSchema>;
export function backupLocation(id:string){
  if(!backupIdPattern.test(id))throw new Error('Invalid backup ID');
  const location=privateStorageLocation();
  // Sibling of live namespace, never included in the live-file cleanup inventory.
  const parent=location.prefix.replace(/\/vernatun(?:-test\/qa_[a-f0-9]{20})?\/$/,'');
  return {bucket:location.bucket,prefix:`${parent}/vernatun-backups/${id}/`};
}
export function validateManifest(input:unknown){
  const m=backupManifestSchema.parse(input);
  const files=new Set(m.files.map(f=>`${f.kind}/${f.key}`));
  if(files.size!==m.files.length||new Set(m.tables.map(t=>t.name)).size!==m.tables.length)
    throw new Error('Duplicate backup entries');
  if(Date.parse(m.retainUntil)-Date.parse(m.createdAt)!==30*86400000)
    throw new Error('Invalid backup retention');
  return m;
}
