import {pool} from './db.js';
import {moduleForPermission} from './roles.js';
import {subscriptionPolicy} from './subscription-policy.js';

// Per-assignment grants can restore permissions removed by a custom profile,
// but never add a capability outside the immutable system role.
export const exceptionalGrantAllowlist=['properties.read','people.read','documents.read','announcements.read'] as const;
export async function assignmentPermissions(a:{id:string;role_key:string;permissions:string[];organization_id:string|null;profile_id?:string|null}){
 const base=new Set(a.permissions);
 let permissions=new Set(base),profile:any=null,profileValid=true;
 if(a.profile_id){
  profile=(await pool.query('SELECT id,base_role,organization_id,tenant_allowed,permissions,active FROM iam_profiles WHERE id=$1',[a.profile_id])).rows[0];
  if(!profile?.active||profile.base_role!==a.role_key||
   !(profile.organization_id===a.organization_id||(profile.organization_id===null&&profile.tenant_allowed&&a.organization_id)))
   {permissions=new Set();profileValid=false;}
  else permissions=new Set((profile.permissions as string[]).filter(p=>base.has(p)));
 }
 // Global administration is not implicit authority to move physical devices.
 // A separate administrator must explicitly grant execution to this assignment.
 if(a.role_key==='platform_admin')permissions.delete('edge.commands.execute');
 const rules=(await pool.query('SELECT permission_key,effect,reason,expires_at FROM iam_assignment_rules WHERE assignment_id=$1 AND (expires_at IS NULL OR expires_at>now())',[a.id])).rows;
 for(const r of rules)if(r.effect==='grant'&&base.has(r.permission_key)&&profileValid)permissions.add(r.permission_key);
 for(const r of rules)if(r.effect==='deny')permissions.delete(r.permission_key);
 return {permissions:[...permissions].sort(),basePermissions:[...base].sort(),profile,rules};
}
export async function permissionDecision(c:{permissions:string[];organization_id:string|null},permission:string,method:string){
 if(!c.permissions.includes(permission))return {allowed:false,reason:'forbidden'};
 if(c.organization_id){
  const policy=await subscriptionPolicy(c.organization_id),module=moduleForPermission(permission);
  if(module&&!policy.modules.includes(module))return {allowed:false,reason:'module_disabled'};
  if(policy.readOnly&&!['GET','HEAD','OPTIONS'].includes(method)&&!['support.cases.create','support.access.approve','platform_billing.pay'].includes(permission))
   return {allowed:false,reason:'subscription_restricted'};
 }
 return {allowed:true,reason:'permission_allowed'};
}
export async function permissionCatalog(){
 return (await pool.query('SELECT key FROM permissions ORDER BY key')).rows.map(r=>r.key as string);
}
