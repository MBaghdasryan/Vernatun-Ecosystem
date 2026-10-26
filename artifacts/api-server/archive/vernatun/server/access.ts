import {allowedProducts,primaryProduct,startRoute} from '../shared/products.js';
import type {Request,Response,NextFunction} from 'express';
import {pool} from './db.js';
import {activationExempt,residentActivation} from './resident-activation.js';
import {moduleForPermission} from './roles.js';
import {subscriptionPolicy} from './subscription-policy.js';
import {activeLeasePredicate} from './lease-policy.js';
import {assertMfaContext} from './mfa-policy.js';
import {assignmentPermissions,permissionDecision} from './iam-evaluator.js';
import {scopedUnitRow,unitReadDecision} from './iam-resource.js';
export class ApiError extends Error{constructor(public status:number,public code:string){super(code)}}
export type Context={id:string;role_key:string;shell:string;organization_id:string|null;organization_name:string|null;brand_color?:string;building_id:string|null;building_name?:string|null;unit_id:string|null;unit_number?:string|null;expires_at:string|null;permissions:string[];product?:string;products?:string[];startRoute?:string;modules?:string[]};
declare global{namespace Express{interface User{id:string;email:string;name:string;locale:'hy'|'ru'|'en';currency:'AMD'|'RUB'|'USD';mustChangePassword:boolean}}}
declare module 'express-session'{interface SessionData{csrf:string;contextId?:string;createdAt?:string;issuedAt?:string;lastSeenAt?:string;device?:string;passport?:{user:string}}}
export async function contexts(userId:string):Promise<Context[]>{if(!(await pool.query('SELECT id FROM users WHERE id=$1 AND NOT blocked',[userId])).rowCount)return [];await pool.query('SELECT expire_support_grants($1)',[userId]);const r=await pool.query(`SELECT a.id,a.role_key,a.profile_id,r.shell,a.organization_id,o.name AS organization_name,o.brand_color,o.web_branding AS branding,a.building_id,a.unit_id,a.expires_at,b.name AS building_name,u.number AS unit_number,
 COALESCE((SELECT to_json(d.permission_keys) FROM resident_delegations d WHERE d.assignment_id=a.id),(SELECT json_agg(permission_key ORDER BY permission_key) FROM role_permissions WHERE role_key=a.role_key),'[]') AS permissions
 FROM role_assignments a JOIN roles r ON r.key=a.role_key LEFT JOIN organizations o ON o.id=a.organization_id
 LEFT JOIN units u ON u.id=a.unit_id AND u.organization_id=a.organization_id
 LEFT JOIN buildings b ON b.id=COALESCE(a.building_id,u.building_id) AND b.organization_id=a.organization_id
 LEFT JOIN memberships m ON m.user_id=a.user_id AND m.organization_id=a.organization_id
 WHERE a.user_id=$1 AND a.active AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now())
 AND (a.organization_id IS NULL OR (m.active=true AND o.status='active'))
 AND ${activeLeasePredicate('a')}
 AND NOT EXISTS(SELECT 1 FROM resident_delegations d WHERE d.assignment_id=a.id AND (d.revoked_at IS NOT NULL OR d.expires_at<=now() OR NOT EXISTS(SELECT 1 FROM role_assignments owner JOIN memberships om ON om.user_id=owner.user_id AND om.organization_id=owner.organization_id JOIN users ou ON ou.id=owner.user_id WHERE owner.id=d.owner_assignment_id AND owner.active AND om.active AND NOT ou.blocked AND owner.starts_at<=now() AND (owner.expires_at IS NULL OR owner.expires_at>now())))) ORDER BY r.shell,a.role_key`,[userId]);const grants=await pool.query(`SELECT g.id,'support' AS role_key,'platform' AS shell,g.organization_id,o.name AS organization_name,NULL AS building_id,NULL AS unit_id,g.expires_at,to_json(g.permission_keys) AS permissions FROM support_access_grants g JOIN organizations o ON o.id=g.organization_id WHERE o.status='active' AND g.support_user_id=$1 AND g.approved_at IS NOT NULL AND g.revoked_at IS NULL AND g.expires_at>now() AND EXISTS(SELECT 1 FROM role_assignments a WHERE a.user_id=$1 AND a.role_key='support' AND a.active AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now()))`,[userId]);const all=[...r.rows,...grants.rows];const ids=[...new Set(all.map(c=>c.organization_id).filter(Boolean))];const policies=new Map(await Promise.all(ids.map(async id=>[id,await subscriptionPolicy(id)] as const)));return Promise.all(all.map(async original=>{const {permissions}=await assignmentPermissions(original);const c={...original,permissions};const policy=policies.get(c.organization_id);const modules=policy?.modules??[];return {...c,modules,subscription:policy?{enforced:policy.enforced,state:policy.state,readOnly:policy.readOnly,grace:policy.grace}:null,product:primaryProduct(c.role_key),products:allowedProducts({...c,modules}),startRoute:startRoute(c.role_key,{...c,modules})}}));}
export function requireAuth(req:Request,_res:Response,next:NextFunction){
 if(!req.user)return next(new ApiError(401,'unauthenticated'));
 if((req.get('X-Hayat-User')&&req.get('X-Hayat-User')!==req.user.id)||
    (req.get('X-Hayat-Context')&&req.get('X-Hayat-Context')!==req.session.contextId)){
  return next(new ApiError(403,'scope_changed'));
 }
 next();
}
export async function context(req:Request):Promise<Context>{if(!req.user)throw new ApiError(401,'unauthenticated');const available=await contexts(req.user.id);const c=available.find(c=>c.id===req.session.contextId);if(!c)throw new ApiError(403,'context_required');await assertMfaContext(req,c);return c;}
export async function requirePermission(req:Request,permission:string){const c=await context(req);const decision=await permissionDecision(c,permission,req.method);if(!decision.allowed)throw new ApiError(403,decision.reason);
 if(c.shell==='home'&&c.building_id&&c.organization_id&&!activationExempt(req)&&
  !(await residentActivation(req.user!.id,c.building_id,c.organization_id)).ready)throw new ApiError(403,'resident_activation_required');
 return c;}
export async function scopedUnit(c:Context,id:string){if(!c.organization_id)throw new ApiError(403,'forbidden');const unit=await scopedUnitRow(c,id);if(!unit)throw new ApiError(404,'not_found');return unit;}
export async function requireUnitRead(req:Request,id:string){
 const result=await unitReadDecision(await context(req),id);
 if(!result.allowed)throw new ApiError(result.reason==='not_found'?404:403,result.reason);
 return result.unit;
}
