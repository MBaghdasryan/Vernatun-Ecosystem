import {Router} from 'express';
import {z} from 'zod';
import {randomBytes,createHash} from 'node:crypto';
import {pool} from './db.js';
import {requireAuth,requirePermission,ApiError} from './access.js';
import {transaction,record} from './operations.js';
import {requireRecentAuthentication} from './recent-auth.js';
import {assertEmailConfigured} from './email.js';
import {sendInvitation} from './invitation-delivery.js';
export const residentLifecycle=Router();residentLifecycle.use(requireAuth);
const uuid=z.string().uuid(),version=z.number().int().positive(),time=z.string().datetime();
const hash=(token:string)=>createHash('sha256').update(token).digest('hex');
function expiry(value:string,ownerExpiry:string|null){
 if(Date.parse(value)<=Date.now()||Date.parse(value)>Date.now()+366*86400000||ownerExpiry&&Date.parse(value)>Date.parse(ownerExpiry))throw new ApiError(400,'invalid_expiration');
}
residentLifecycle.post('/delegations',async(req,res)=>{
 const c=await requirePermission(req,'residents.delegate');requireRecentAuthentication(req);
 if(c.role_key!=='unit_owner'||!c.unit_id)throw new ApiError(403,'forbidden');
 const b=z.object({email:z.string().email().max(254),phone:z.string().trim().regex(/^\+?[0-9 ()-]{7,30}$/).optional(),expiresAt:time,permissions:z.array(z.enum(['requests.own','requests.create','announcements.read','properties.own','access.create'])).min(1).max(5)}).strict().parse(req.body);
 expiry(b.expiresAt,c.expires_at);
 if(b.permissions.some(p=>!c.permissions.includes(p))||b.permissions.includes('requests.create')&&!b.permissions.includes('requests.own'))throw new ApiError(400,'validation_error');
 assertEmailConfigured();
 const token=randomBytes(32).toString('hex');
 const created=await transaction(async db=>{
  const d=(await db.query('INSERT INTO resident_delegations(organization_id,owner_assignment_id,unit_id,permission_keys,expires_at,contact_phone) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,version',[c.organization_id,c.id,c.unit_id,[...new Set(b.permissions)],b.expiresAt,b.phone??null])).rows[0];
  const i=(await db.query(`INSERT INTO invitations(organization_id,email,role_key,building_id,unit_id,token_hash,invited_by,expires_at,delegation_id) VALUES($1,$2,'family',$3,$4,$5,$6,LEAST($7::timestamptz,now()+interval '48 hours'),$8) RETURNING id`,[c.organization_id,b.email.toLowerCase(),c.building_id,c.unit_id,hash(token),req.user!.id,b.expiresAt,d.id])).rows[0];
  await record(db,req,c,'delegation.create','resident_delegation',d.id);return {...d,invitationId:i.id};
 });
 res.status(201).json({...created,...await sendInvitation(req,c,created.invitationId,token)});
});
residentLifecycle.post('/resident/owner-renter-invitations',async(req,res)=>{
 const c=await requirePermission(req,'residents.delegate');requireRecentAuthentication(req);
 if(c.role_key!=='unit_owner'||!c.unit_id||!c.building_id||!c.organization_id)throw new ApiError(403,'forbidden');
 const b=z.object({
  email:z.string().email().max(254),
  phone:z.string().trim().regex(/^\+?[0-9 ()-]{7,30}$/).optional(),
  expiresAt:time,
  permissions:z.array(z.enum(['requests.own','requests.create','announcements.read','properties.own','access.create'])).min(1).max(5),
 }).strict().parse(req.body);
 expiry(b.expiresAt,c.expires_at);
 if(b.permissions.some(p=>!c.permissions.includes(p))||
  b.permissions.includes('requests.create')&&!b.permissions.includes('requests.own'))throw new ApiError(400,'validation_error');
 assertEmailConfigured();
 const token=randomBytes(32).toString('hex');
 const created=await transaction(async db=>{
  const delegation=(await db.query(`INSERT INTO resident_delegations
   (organization_id,owner_assignment_id,unit_id,permission_keys,expires_at,contact_phone)
   VALUES($1,$2,$3,$4,$5,$6) RETURNING id,version`,
   [c.organization_id,c.id,c.unit_id,[...new Set(b.permissions)],b.expiresAt,b.phone??null])).rows[0];
  const invitation=(await db.query(`INSERT INTO invitations
   (organization_id,email,role_key,building_id,unit_id,token_hash,invited_by,expires_at,delegation_id)
   VALUES($1,$2,'renter',$3,$4,$5,$6,LEAST($7::timestamptz,now()+interval '48 hours'),$8)
   RETURNING id`,
   [c.organization_id,b.email.toLowerCase(),c.building_id,c.unit_id,hash(token),req.user!.id,b.expiresAt,delegation.id])).rows[0];
  await record(db,req,c,'resident.renter_invitation.create','resident_delegation',delegation.id,{invitationId:invitation.id});
  return {...delegation,invitationId:invitation.id};
 });
 res.status(201).json({...created,...await sendInvitation(req,c,created.invitationId,token)});
});
residentLifecycle.post('/delegations/:id/expiration',async(req,res)=>{
 const c=await requirePermission(req,'residents.delegate');requireRecentAuthentication(req);
 const b=z.object({version,expiresAt:time}).strict().parse(req.body);expiry(b.expiresAt,c.expires_at);
 res.json(await transaction(async db=>{
  const d=(await db.query('SELECT * FROM resident_delegations WHERE id=$1 AND owner_assignment_id=$2 AND organization_id=$3 FOR UPDATE',[uuid.parse(req.params.id),c.id,c.organization_id])).rows[0];
  if(!d)throw new ApiError(404,'not_found');
  if(d.version!==b.version)throw new ApiError(409,'stale_version');
  if(d.revoked_at||new Date(d.expires_at).getTime()<=Date.now())throw new ApiError(409,'invalid_transition');
  const r=(await db.query('UPDATE resident_delegations SET expires_at=$2,version=version+1 WHERE id=$1 RETURNING *',[d.id,b.expiresAt])).rows[0];
  if(d.assignment_id)await db.query('UPDATE role_assignments SET expires_at=$2 WHERE id=$1',[d.assignment_id,b.expiresAt]);
  await db.query('UPDATE invitations SET expires_at=LEAST(expires_at,$2::timestamptz) WHERE delegation_id=$1 AND accepted_at IS NULL',[d.id,b.expiresAt]);
  await record(db,req,c,'delegation.expiration','resident_delegation',d.id);return r;
 }));
});
residentLifecycle.post('/delegations/:id/resend',async(req,res)=>{
 const c=await requirePermission(req,'residents.delegate');requireRecentAuthentication(req);
 const b=z.object({version}).strict().parse(req.body);assertEmailConfigured();
 const token=randomBytes(32).toString('hex');
 const i=await transaction(async db=>{
  const d=(await db.query('SELECT * FROM resident_delegations WHERE id=$1 AND owner_assignment_id=$2 AND organization_id=$3 FOR UPDATE',[uuid.parse(req.params.id),c.id,c.organization_id])).rows[0];
  if(!d)throw new ApiError(404,'not_found');
  if(d.version!==b.version)throw new ApiError(409,'stale_version');
  if(d.revoked_at||d.assignment_id||new Date(d.expires_at).getTime()<=Date.now())throw new ApiError(409,'invalid_transition');
  const invitation=(await db.query('SELECT * FROM invitations WHERE delegation_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE',[d.id])).rows[0];
  if(!invitation)throw new ApiError(409,'invalid_transition');
  await db.query("UPDATE invitations SET token_hash=$2,expires_at=LEAST($3::timestamptz,now()+interval '48 hours'),email_delivery_status='unknown',email_delivery_at=NULL WHERE id=$1",[invitation.id,hash(token),d.expires_at]);
  await db.query('UPDATE resident_delegations SET version=version+1 WHERE id=$1',[d.id]);
  await record(db,req,c,'delegation.resend','resident_delegation',d.id);return invitation;
 });
 res.json({id:i.delegation_id,...await sendInvitation(req,c,i.id,token)});
});
residentLifecycle.post('/delegations/:id/revoke',async(req,res,next)=>{await requirePermission(req,'residents.delegate');requireRecentAuthentication(req);next()});
residentLifecycle.post('/leases/:id/:action',async(req,res)=>{
 const c=await requirePermission(req,'leases.manage');
 const action=z.enum(['extend','cancel']).parse(req.params.action);
 const b=z.object({version,endsOn:z.string().date().optional(),reason:z.string().trim().min(3).max(1000).optional()}).strict().parse(req.body);
 res.json(await transaction(async db=>{
   // All period-changing operations take the unit lock before lease rows,
   // matching billing's unit -> payer-assignment lock order.
   const ref=(await db.query(`SELECT l.unit_id FROM leases l JOIN units u ON u.id=l.unit_id
    WHERE l.id=$1 AND l.organization_id=$2 AND ($3::uuid IS NULL OR u.building_id=$3)
    AND ($4::uuid IS NULL OR u.id=$4)`,[uuid.parse(req.params.id),c.organization_id,c.building_id,c.unit_id])).rows[0];
   if(!ref)throw new ApiError(404,'not_found');
   await db.query('SELECT id FROM units WHERE id=$1 FOR UPDATE',[ref.unit_id]);
  const l=(await db.query('SELECT l.*,l.ends_on::text AS ends_on FROM leases l JOIN units u ON u.id=l.unit_id WHERE l.id=$1 AND l.organization_id=$2 AND ($3::uuid IS NULL OR u.building_id=$3) AND ($4::uuid IS NULL OR u.id=$4) FOR UPDATE OF l',[uuid.parse(req.params.id),c.organization_id,c.building_id,c.unit_id])).rows[0];
  if(!l)throw new ApiError(404,'not_found');
  if(l.version!==b.version)throw new ApiError(409,'stale_version');
  if(l.cancelled_at)throw new ApiError(409,'invalid_transition');
  if(action==='extend'){
   if(!b.endsOn||b.endsOn<=l.ends_on)throw new ApiError(400,'invalid_dates');
   if((await db.query('SELECT id FROM leases WHERE id<>$1 AND unit_id=$2 AND cancelled_at IS NULL AND starts_on<=$3 AND ends_on>=$4',[l.id,l.unit_id,b.endsOn,l.starts_on])).rowCount)throw new ApiError(409,'lease_overlap');
   await db.query('UPDATE leases SET ends_on=$2,version=version+1 WHERE id=$1',[l.id,b.endsOn]);
   await db.query('UPDATE occupancies SET ends_on=$4 WHERE organization_id=$1 AND unit_id=$2 AND user_id=$3 AND starts_on=$5 AND ends_on=$6',[l.organization_id,l.unit_id,l.renter_id,b.endsOn,l.starts_on,l.ends_on]);
  }else{
   if(!b.reason)throw new ApiError(400,'reason_required');
   await db.query('UPDATE leases SET cancelled_at=now(),cancelled_by=$2,cancellation_reason=$3,version=version+1 WHERE id=$1',[l.id,req.user!.id,b.reason]);
  }
  await record(db,req,c,'lease.'+action,'lease',l.id);
  return (await db.query('SELECT * FROM leases WHERE id=$1',[l.id])).rows[0];
 }));
});
