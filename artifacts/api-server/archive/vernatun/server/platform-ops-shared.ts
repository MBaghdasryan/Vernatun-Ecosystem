import {z} from 'zod';
import type {PoolClient} from 'pg';
import {ApiError,type Context} from './access.js';
export {uuid,day} from './finance-shared.js';
export const title=z.string().trim().min(2).max(200),text=z.string().trim().min(1).max(8000);
export function globalAdmin(c:Context){return !c.organization_id&&c.permissions.includes('organizations.manage')}
export function globalSupport(c:Context){return !c.organization_id&&c.permissions.includes('support.cases')}
export function globalQueueLead(c:Context){return !c.organization_id&&c.permissions.includes('support.assign')}
export async function operator(db:PoolClient,id:string,role?:string){
 const r=await db.query(`SELECT u.id,u.name FROM users u WHERE u.id=$1 AND NOT u.blocked AND EXISTS(
 SELECT 1 FROM role_assignments a WHERE a.user_id=u.id AND a.organization_id IS NULL AND a.active
 AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now()) AND
 (a.role_key=$2 OR ($2 IS NULL AND a.role_key IN ('support','platform_admin'))))`,[id,role??null]);
 if(!r.rowCount)throw new ApiError(400,'invalid_operator');return r.rows[0];
}
export function version(row:any,n:number){if(row.version!==n)throw new ApiError(409,'stale_version')}
