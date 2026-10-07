import type {Request} from 'express';
import {Router} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,contexts,requireAuth,type Context} from './access.js';
import {transaction,record} from './operations.js';
import {subscriptionPolicy} from './subscription-policy.js';
declare module 'express-session'{interface SessionData{mfaVerifiedAt?:string}}
export async function policyState(req:Request,c?:Context){
 const row=c&&['platform_admin','org_admin'].includes(c.role_key)
  ?(await pool.query('SELECT required,enforce_after,version FROM mfa_policies WHERE role_key=$1 AND organization_id IS NOT DISTINCT FROM $2::uuid',[c.role_key,c.organization_id])).rows[0]:undefined;
 const enrolled=!!(await pool.query('SELECT enabled FROM mfa_credentials WHERE user_id=$1',[req.user!.id])).rows[0]?.enabled;
 const verified=enrolled&&!!req.session.mfaVerifiedAt;
 const required=!!row?.required,enforceAfter=row?.enforce_after??null;
 return {policy:{required,enforceAfter,version:row?.version??0},enrolled,verified,
  enforced:required&&!!enforceAfter&&new Date(enforceAfter)<=new Date()};
}
export async function assertMfaContext(req:Request,c:Context){
 if(!['platform_admin','org_admin'].includes(c.role_key))return;
 const s=await policyState(req,c);
 if(s.enforced&&!s.enrolled)throw new ApiError(403,'mfa_enrollment_required');
 if(s.enforced&&!s.verified)throw new ApiError(403,'mfa_verification_required');
}
async function selected(req:Request){return (await contexts(req.user!.id)).find(c=>c.id===req.session.contextId)}
function canManage(c?:Context){return !!c&&!c.building_id&&!c.unit_id&&
 ((c.role_key==='platform_admin'&&c.organization_id===null&&c.permissions.includes('organizations.manage'))||
 (c.role_key==='org_admin'&&!!c.organization_id&&c.permissions.includes('organization.settings')))}
export const mfaPolicy=Router();mfaPolicy.use(requireAuth);
mfaPolicy.get('/policy',async(req,res)=>{const c=await selected(req),s=await policyState(req,c);res.json({...s,verified:s.verified&&Date.now()-new Date(req.session.mfaVerifiedAt!).getTime()<=15*60000,canManage:canManage(c)})});
mfaPolicy.put('/policy',async(req,res)=>{
 const c=await selected(req);if(!canManage(c))throw new ApiError(403,'forbidden');
 const b=z.object({required:z.boolean(),enforceAfter:z.string().datetime({offset:true}).nullable(),version:z.number().int().min(0),
  reason:z.string().trim().min(8).max(1000)}).strict().parse(req.body);
 const s=await policyState(req,c);if(!s.verified||Date.now()-new Date(req.session.mfaVerifiedAt!).getTime()>15*60000)throw new ApiError(403,'recent_mfa_required');
 if(b.required&&(!b.enforceAfter||new Date(b.enforceAfter).getTime()<Date.now()+24*60*60000))throw new ApiError(400,'mfa_rollout_grace_required');
 if(c!.organization_id&&(await subscriptionPolicy(c!.organization_id)).readOnly)throw new ApiError(403,'subscription_restricted');
 res.json(await transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['mfa-policy:'+c!.role_key+':'+(c!.organization_id??'platform')]);
  const old=(await db.query('SELECT * FROM mfa_policies WHERE role_key=$1 AND organization_id IS NOT DISTINCT FROM $2::uuid FOR UPDATE',[c!.role_key,c!.organization_id])).rows[0];
  if((old?.version??0)!==b.version)throw new ApiError(409,'version_conflict');
  const args=[b.required,b.required?b.enforceAfter:null,c!.role_key,c!.organization_id];
  const row=old?(await db.query('UPDATE mfa_policies SET required=$1,enforce_after=$2,version=version+1,updated_at=now() WHERE role_key=$3 AND organization_id IS NOT DISTINCT FROM $4::uuid RETURNING required,enforce_after,version',args)).rows[0]
   :(await db.query('INSERT INTO mfa_policies(required,enforce_after,role_key,organization_id) VALUES($1,$2,$3,$4) RETURNING required,enforce_after,version',args)).rows[0];
  await record(db,req,c!,'mfa.policy.update','mfa_policy',old?.id??null,{required:row.required,enforceAfter:row.enforce_after,reason:b.reason});
  return {required:row.required,enforceAfter:row.enforce_after,version:row.version};
 }));
});
export async function preventRequiredDisable(req:Request){
 const all=await contexts(req.user!.id);
 for(const c of all)if((await policyState(req,c)).policy.required)throw new ApiError(403,'mfa_required_by_policy');
}
