import {createHash} from 'node:crypto';
import type {Request} from 'express';
import type {PoolClient} from 'pg';
import {pool} from './db.js';
import {ApiError,type Context} from './access.js';
export async function transaction<T>(fn:(db:PoolClient)=>Promise<T>){const db=await pool.connect();try{await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}}
export async function record(db:PoolClient,req:Request,c:Context,action:string,type:string,id:string,details={}){await db.query('INSERT INTO audit_events(organization_id,actor_user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',[c.organization_id,req.user!.id,action,type,id,JSON.stringify(details)])}
export async function notifyPlatformTask(db:PoolClient,userId:string,organizationId:string|null,code:'platform_task_assigned'|'platform_task_deadline_changed',taskId:string,dedupeKey:string,title:string,body:string){
 await db.query(`INSERT INTO notifications(user_id,organization_id,kind,event_code,entity_type,entity_id,dedupe_key,custom_title,custom_body)
  VALUES($1,$2,$3,$3,'platform_task',$4,$5,$6,$7)
  ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
 [userId,organizationId,code,taskId,dedupeKey,title,body]);
}
export async function idempotent(db:PoolClient,req:Request,key:string,body:unknown,run:()=>Promise<any>){const fingerprint=createHash('sha256').update(JSON.stringify([req.path,req.session.contextId,body])).digest('hex');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[req.user!.id+key]);const prior=(await db.query('SELECT * FROM operation_receipts WHERE actor_id=$1 AND key=$2',[req.user!.id,key])).rows[0];if(prior){if(prior.fingerprint!==fingerprint)throw new ApiError(409,'idempotency_conflict');return prior.result}const result=await run();await db.query('INSERT INTO operation_receipts(actor_id,key,fingerprint,result) VALUES($1,$2,$3,$4)',[req.user!.id,key,fingerprint,JSON.stringify(result)]);return result}
export const invoiceAmounts=`i.amount_minor::text,COALESCE((SELECT sum(a.amount_minor) FROM payment_allocations a WHERE a.invoice_id=i.id),0)::text AS paid_minor,COALESCE((SELECT sum(a.amount_minor) FROM adjustments a WHERE a.invoice_id=i.id),0)::text AS adjustment_minor,(i.amount_minor+COALESCE((SELECT sum(a.amount_minor) FROM adjustments a WHERE a.invoice_id=i.id),0)-COALESCE((SELECT sum(a.amount_minor) FROM payment_allocations a WHERE a.invoice_id=i.id),0))::text AS balance_minor`;
