import {systemQuery} from './system-query.js';
import {backupStorage} from './operations-backup-storage.js';
import {operationsEncryptionState} from './operations-encryption.js';

type Metric={key:string;value:string|null;status:'healthy'|'degraded'|'down'|'unavailable'|'not_configured'};
export async function backupHealthMetrics():Promise<Metric[]>{
 const encryption=operationsEncryptionState();
 const result:Metric[]=[{key:'backup_encryption',value:encryption,status:encryption==='configured'?'healthy':'not_configured'}];
 // Configuration is not a network/storage health probe.
 try{result.push({key:'backup_storage',value:backupStorage().name,status:'unavailable'})}
 catch{result.push({key:'backup_storage',value:null,status:'not_configured'})}
 try{
  const row=(await systemQuery({text:`SELECT finished_at,kind,bytes,
   greatest(0,floor(extract(epoch FROM now()-finished_at)))::text AS age
   FROM operations_backups WHERE status='completed' AND verification='verified'
   ORDER BY finished_at DESC,id DESC LIMIT 1`,query_timeout:3000})).rows[0];
  result.push(
   {key:'last_backup',value:row?new Date(row.finished_at).toISOString():null,status:row?'healthy':'unavailable'},
   {key:'backup_type',value:row?.kind??null,status:row?'healthy':'unavailable'},
   {key:'backup_bytes',value:row?.bytes==null?null:String(row.bytes),status:row?'healthy':'unavailable'},
   {key:'backup_age_seconds',value:row?.age??null,status:row?'healthy':'unavailable'},
  );
 }catch{result.push({key:'last_backup',value:null,status:'unavailable'})}
 return result;
}
