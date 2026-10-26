import type {Request} from 'express';
import {pool} from './db.js';
export async function residentActivation(userId:string,buildingId:string,organizationId:string){
 const r=(await pool.query(`SELECT COALESCE(s.activation_required,false) AS required,
  COALESCE(p.verified_email=lower(u.email) AND p.email_verified_at IS NOT NULL,false) AS "emailVerified",
  (SELECT count(*)::int FROM resident_product_records a WHERE a.organization_id=$3 AND a.building_id=$2
   AND a.kind='agreements' AND a.status='active' AND a.deleted_at IS NULL AND (a.data->>'mandatory')::boolean
   AND NOT EXISTS(SELECT 1 FROM resident_record_marks m WHERE m.record_id=a.id AND m.user_id=$1 AND m.mark='accepted')) AS missing
  FROM users u LEFT JOIN resident_profiles p ON p.user_id=u.id
  LEFT JOIN resident_building_settings s ON s.building_id=$2 AND s.organization_id=$3 WHERE u.id=$1`,
  [userId,buildingId,organizationId])).rows[0];
 return {required:!!r?.required,emailVerified:!!r?.emailVerified,missingAgreements:r?.missing??0,
  ready:!r?.required||!!r.emailVerified&&r.missing===0};
}
export function activationExempt(req:Request){
 if(['GET','HEAD','OPTIONS'].includes(req.method))return true;
 const path=req.originalUrl.split('?')[0];
 return path.startsWith('/api/auth/')||path==='/api/resident/profile'||path==='/api/resident/avatar'||path==='/api/resident/email-verification'||
  path==='/api/resident/notification-settings'||
  /^\/api\/resident\/records\/agreements\/[0-9a-f-]+\/actions$/.test(path)&&req.body?.action==='accept';
}
