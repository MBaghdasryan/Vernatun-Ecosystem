import type {Request} from 'express';
import type {PoolClient} from 'pg';
import {pool} from './db.js';
import {ApiError} from './access.js';
import {enabled,residentScope,type ResidentScope} from './resident-policy.js';
import {activeLeasePredicate} from './lease-policy.js';

export async function ownScope(req:Request){
 const s=await residentScope(req);if(s.administrative)throw new ApiError(403,'resident_context_required');return s;
}
export const chatEnabled=(s:ResidentScope)=>!!(s.settings.directory&&enabled(s,'conversations'));
// Directory consent is necessary but not sufficient: occupancy/membership/lease are live.
export async function neighbors(s:ResidentScope,userId:string,db:PoolClient|typeof pool=pool){
 if(!chatEnabled(s))return [];
 return (await db.query(`SELECT DISTINCT u.id,u.name FROM users u
  JOIN resident_profiles p ON p.user_id=u.id JOIN role_assignments a ON a.user_id=u.id
  JOIN memberships m ON m.user_id=u.id AND m.organization_id=a.organization_id
  WHERE a.organization_id=$1 AND a.building_id=$2 AND a.unit_id IS NOT NULL
  AND a.role_key IN('unit_owner','renter','family') AND a.active AND m.active AND NOT u.blocked
  AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now()) AND ${activeLeasePredicate('a')}
  AND p.show_name AND p.allow_messages AND u.id<>$3
  AND NOT EXISTS(SELECT 1 FROM resident_delegations d WHERE d.assignment_id=a.id)
  ORDER BY u.name,u.id`,[s.organizationId,s.buildingId,userId])).rows;
}
export async function requireChat(req:Request,id:string,db:PoolClient|typeof pool=pool,lock=false){
 const s=await ownScope(req),user=req.user!.id;
 if(!chatEnabled(s))throw new ApiError(403,'feature_disabled');
 const r=(await db.query(`SELECT * FROM resident_direct_threads WHERE id=$1 AND organization_id=$2
  AND building_id=$3 AND $4 IN(left_user,right_user) ${lock?'FOR UPDATE':''}`,[id,s.organizationId,s.buildingId,user])).rows[0];
 if(!r)throw new ApiError(404,'not_found');
 const peer=r.left_user===user?r.right_user:r.left_user;
 if(!(await neighbors(s,user,db)).some(p=>p.id===peer))throw new ApiError(404,'not_found');
 return {s,r,peer,user};
}
export const bookingColumns=`id,title,starts_at AS "startsAt",ends_at AS "endsAt",note,status,version,request_id AS "requestId"`;
export async function notificationSettings(userId:string){
 return (await pool.query(`SELECT email_enabled AS "emailEnabled",in_app_enabled AS "inAppEnabled",
  quiet_enabled AS "quietEnabled",quiet_start AS "quietStart",quiet_end AS "quietEnd",timezone,version
  FROM notification_preferences WHERE user_id=$1`,[userId])).rows[0]??{
  emailEnabled:true,inAppEnabled:true,quietEnabled:false,quietStart:'22:00',quietEnd:'08:00',timezone:'Asia/Yerevan',version:0};
}
