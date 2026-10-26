import {Router} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,requireAuth,requirePermission} from './access.js';
import {transaction,record} from './operations.js';
import {ownScope} from './resident-continuity-store.js';
import {residentScope,writable,type ResidentScope} from './resident-policy.js';
import {requireRecentAuthentication} from './recent-auth.js';
import {day,uuid} from './finance-shared.js';

export const residentPayerResponsibility=Router();residentPayerResponsibility.use(requireAuth);
const period=day.refine(v=>v.endsWith('-01'));
const proposal=z.object({payerAssignmentId:uuid,recipientId:uuid,startsOn:period,endsOn:period.optional(),clientId:uuid}).strict();
const columns=`d.id,d.payer_assignment_id AS "payerAssignmentId",d.owner_user_id AS "ownerId",
 d.recipient_id AS "recipientId",ou.name AS "ownerName",ru.name AS "recipientName",s.name AS "serviceName",
 d.starts_on::text AS "startsOn",d.ends_on::text AS "endsOn",d.status,d.version`;
async function currentDate(db:typeof pool|Parameters<Parameters<typeof transaction>[0]>[0],s:ResidentScope){
 return (await db.query(`SELECT (now() AT TIME ZONE timezone)::date::text AS today,
 (date_trunc('month',now() AT TIME ZONE timezone)+interval '1 month')::date::text AS next
 FROM organizations WHERE id=$1`,[s.organizationId])).rows[0] as {today:string;next:string};
}
async function assertFuture(db:Parameters<Parameters<typeof transaction>[0]>[0],s:ResidentScope,starts:string){
 if(starts<=(await currentDate(db,s)).today)throw new ApiError(409,'future_period_required');
}
async function lockSource(db:Parameters<Parameters<typeof transaction>[0]>[0],s:ResidentScope,id:string){
 const p=(await db.query(`SELECT p.*,p.starts_on::text,p.ends_on::text FROM payer_assignments p
 WHERE p.id=$1 AND p.organization_id=$2 AND p.unit_id=$3 FOR UPDATE`,[id,s.organizationId,s.unitId])).rows[0];
 if(!p)throw new ApiError(404,'not_found');return p;
}
async function allowed(db:Parameters<Parameters<typeof transaction>[0]>[0],s:ResidentScope,serviceId:string){
 const r=(await db.query(`SELECT enabled FROM resident_payer_policy WHERE building_id=$1 AND service_id=$2
 AND organization_id=$3 FOR SHARE`,[s.buildingId,serviceId,s.organizationId])).rows[0];
 if(!r?.enabled)throw new ApiError(409,'payer_delegation_disabled');
}
async function recipient(db:Parameters<Parameters<typeof transaction>[0]>[0],s:ResidentScope,id:string,starts:string){
 if(!(await db.query('SELECT resident_payer_recipient_valid($1,$2,$3,$4::date) AS ok',[s.organizationId,s.unitId,id,starts])).rows[0].ok)
  throw new ApiError(409,'recipient_not_eligible');
}
async function unbilled(db:Parameters<Parameters<typeof transaction>[0]>[0],id:string,starts:string,ends:string|null){
 if((await db.query(`SELECT id FROM charges WHERE payer_assignment_id=$1 AND period>=$2 AND($3::date IS NULL OR period<=$3)
 LIMIT 1`,[id,starts,ends])).rowCount)throw new ApiError(409,'period_already_calculated');
}
residentPayerResponsibility.get('/payer-policy',async(req,res)=>{
 const s=await residentScope(req);
 if(!s.administrative)throw new ApiError(403,'forbidden');
 res.json((await pool.query(`SELECT v.id AS "serviceId",v.name AS "serviceName",COALESCE(p.enabled,false) AS enabled,
 COALESCE(p.version,0) AS version FROM services v LEFT JOIN resident_payer_policy p
 ON p.service_id=v.id AND p.building_id=$2 AND p.organization_id=v.organization_id
 WHERE v.organization_id=$1 ORDER BY v.name,v.id`,[s.organizationId,s.buildingId])).rows);
});
residentPayerResponsibility.put('/payer-policy/:serviceId',async(req,res)=>{
 const s=await residentScope(req);if(!s.administrative)throw new ApiError(403,'forbidden');
 writable(s);requireRecentAuthentication(req);
 const serviceId=uuid.parse(req.params.serviceId),b=z.object({enabled:z.boolean(),version:z.number().int().nonnegative()}).strict().parse(req.body);
 res.json(await transaction(async db=>{
  if(!(await db.query('SELECT id FROM services WHERE id=$1 AND organization_id=$2',[serviceId,s.organizationId])).rowCount)throw new ApiError(404,'not_found');
  await db.query(`INSERT INTO resident_payer_policy(building_id,service_id,organization_id) VALUES($1,$2,$3)
  ON CONFLICT(building_id,service_id) DO NOTHING`,[s.buildingId,serviceId,s.organizationId]);
  const r=(await db.query(`UPDATE resident_payer_policy SET enabled=$4,version=version+1
  WHERE building_id=$1 AND service_id=$2 AND organization_id=$3 AND version=$5
  RETURNING service_id AS "serviceId",enabled,version`,[s.buildingId,serviceId,s.organizationId,b.enabled,b.version])).rows[0];
  if(!r)throw new ApiError(409,'stale_version');
  await record(db,req,s.c,'payer_policy.update','service',serviceId,{buildingId:s.buildingId,enabled:b.enabled});return r;
 }));
});
residentPayerResponsibility.get('/payer-responsibilities',async(req,res)=>{
 const s=await ownScope(req),user=req.user!.id,dates=await currentDate(pool,s);
 const canPropose=s.c.role_key==='unit_owner'&&s.c.permissions.includes('billing.own');
 const assignments=canPropose?(await pool.query(`SELECT p.id,p.service_id AS "serviceId",v.name AS "serviceName",
 p.starts_on::text AS "startsOn",p.ends_on::text AS "endsOn",COALESCE(pol.enabled,false) AS enabled
 FROM payer_assignments p JOIN services v ON v.id=p.service_id
 LEFT JOIN resident_payer_policy pol ON pol.building_id=$4 AND pol.service_id=p.service_id AND pol.organization_id=p.organization_id
 WHERE p.organization_id=$1 AND p.unit_id=$2 AND p.payer_user_id=$3 AND(p.ends_on IS NULL OR p.ends_on>=$5)
 ORDER BY v.name,p.id`,[s.organizationId,s.unitId,user,s.buildingId,dates.next])).rows:[];
 const recipients=canPropose?(await pool.query(`SELECT u.id,u.name FROM users u WHERE u.id<>$3
 AND resident_payer_recipient_valid($1,$2,u.id,$4::date) ORDER BY u.name,u.id`,
 [s.organizationId,s.unitId,user,dates.next])).rows:[];
 const delegations=(await pool.query(`SELECT ${columns},
 (d.recipient_id=$3 AND d.status='pending') AS "canAccept",
 ((d.owner_user_id=$3 OR d.recipient_id=$3) AND d.status IN('pending','accepted')) AS "canRevoke"
 FROM resident_payer_delegations d JOIN payer_assignments p ON p.id=d.payer_assignment_id
 JOIN services s ON s.id=p.service_id JOIN users ou ON ou.id=d.owner_user_id JOIN users ru ON ru.id=d.recipient_id
 WHERE d.organization_id=$1 AND d.unit_id=$2 AND(d.owner_user_id=$3 OR d.recipient_id=$3)
 ORDER BY d.created_at DESC,d.id LIMIT 100`,[s.organizationId,s.unitId,user])).rows;
 // This read-only view does not grant billing.own, expose anyone else's bills,
 // or create a new checkout. Existing provider authorization stays untouched.
 const invoices=(await pool.query(`SELECT id,period::text,amount_minor::text AS "amountMinor",currency,status
 FROM invoices WHERE organization_id=$1 AND unit_id=$2 AND payer_user_id=$3 AND status='published'
 ORDER BY period DESC,id LIMIT 100`,[s.organizationId,s.unitId,user])).rows;
 res.json({canPropose,nextPeriod:dates.next,assignments,recipients,delegations,invoices});
});
residentPayerResponsibility.post('/payer-responsibilities',async(req,res)=>{
 const s=await ownScope(req);await requirePermission(req,'billing.own');
 if(s.c.role_key!=='unit_owner')throw new ApiError(403,'owner_required');
 writable(s);requireRecentAuthentication(req);const b=proposal.parse(req.body),user=req.user!.id;
 if(b.recipientId===user||b.endsOn&&b.endsOn<b.startsOn)throw new ApiError(400,'validation_error');
 res.status(201).json(await transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['payer-proposal:'+user+':'+b.clientId]);
  const old=(await db.query('SELECT *,request=$3::jsonb AS same FROM resident_payer_delegations WHERE owner_user_id=$1 AND client_id=$2',[user,b.clientId,JSON.stringify(b)])).rows[0];
  if(old){if(!old.same)throw new ApiError(409,'idempotency_conflict');if(old.unit_id!==s.unitId)throw new ApiError(404,'not_found');return {id:old.id,status:old.status,version:old.version}}
  const p=await lockSource(db,s,b.payerAssignmentId);
  if(p.payer_user_id!==user)throw new ApiError(403,'owner_required');
  await assertFuture(db,s,b.startsOn);await allowed(db,s,p.service_id);await recipient(db,s,b.recipientId,b.startsOn);
  if(b.startsOn<p.starts_on||p.ends_on&&(!b.endsOn||b.endsOn>p.ends_on))throw new ApiError(409,'outside_payer_period');
  await unbilled(db,p.id,b.startsOn,b.endsOn??null);
  if((await db.query(`SELECT id FROM resident_payer_delegations WHERE payer_assignment_id=$1 AND status IN('pending','accepted')
  AND starts_on<=COALESCE($3::date,'infinity'::date) AND COALESCE(ends_on,'infinity'::date)>=$2::date`,
  [p.id,b.startsOn,b.endsOn??null])).rowCount)throw new ApiError(409,'payer_delegation_overlap');
  const r=(await db.query(`INSERT INTO resident_payer_delegations(organization_id,unit_id,payer_assignment_id,
  owner_assignment_id,owner_user_id,recipient_id,starts_on,ends_on,client_id,request)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,status,version`,
  [s.organizationId,s.unitId,p.id,s.c.id,user,b.recipientId,b.startsOn,b.endsOn??null,b.clientId,JSON.stringify(b)])).rows[0];
  await record(db,req,s.c,'payer_responsibility.propose','payer_responsibility',r.id,{serviceId:p.service_id,startsOn:b.startsOn,endsOn:b.endsOn??null});return r;
 }));
});
residentPayerResponsibility.put('/payer-responsibilities/:id',async(req,res)=>{
 const s=await ownScope(req),user=req.user!.id,id=uuid.parse(req.params.id);
 writable(s);requireRecentAuthentication(req);
 const b=z.object({action:z.enum(['accept','decline','revoke']),version:z.number().int().positive()}).strict().parse(req.body);
 const initial=(await pool.query(`SELECT payer_assignment_id FROM resident_payer_delegations WHERE id=$1
 AND organization_id=$2 AND unit_id=$3 AND(owner_user_id=$4 OR recipient_id=$4)`,[id,s.organizationId,s.unitId,user])).rows[0];
 if(!initial)throw new ApiError(404,'not_found');
 res.json(await transaction(async db=>{
  const p=await lockSource(db,s,initial.payer_assignment_id);
  const d=(await db.query('SELECT *,starts_on::text,ends_on::text FROM resident_payer_delegations WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(b.action!=='revoke'&&d.recipient_id!==user)throw new ApiError(403,'recipient_required');
  const target={accept:'accepted',decline:'declined',revoke:'revoked'}[b.action];
  if(d.status===target)return {id:d.id,status:d.status,version:d.version};
  if(d.version!==b.version)throw new ApiError(409,'stale_version');
  if(b.action==='revoke'?!['pending','accepted'].includes(d.status):d.status!=='pending')throw new ApiError(409,'invalid_transition');
  if(b.action==='accept'){
   await assertFuture(db,s,d.starts_on);await allowed(db,s,p.service_id);await recipient(db,s,user,d.starts_on);
   const owner=(await db.query(`SELECT a.id FROM role_assignments a JOIN users u ON u.id=a.user_id
    JOIN memberships m ON m.user_id=u.id AND m.organization_id=a.organization_id
    WHERE a.id=$1 AND a.user_id=$2 AND a.organization_id=$3 AND a.unit_id=$4 AND a.role_key='unit_owner'
    AND a.active AND m.active AND NOT u.blocked AND a.starts_at<=now() AND(a.expires_at IS NULL OR a.expires_at>now())`,
    [d.owner_assignment_id,d.owner_user_id,s.organizationId,s.unitId])).rowCount;
   if(!owner||p.payer_user_id!==d.owner_user_id)throw new ApiError(409,'owner_not_eligible');
   await unbilled(db,p.id,d.starts_on,d.ends_on);
  }
  const r=(await db.query(`UPDATE resident_payer_delegations SET status=$2,version=version+1,
  accepted_at=CASE WHEN $2='accepted' THEN now() ELSE accepted_at END,
  closed_at=CASE WHEN $2 IN('revoked','declined') THEN now() ELSE NULL END
  WHERE id=$1 RETURNING id,status,version`,[id,target])).rows[0];
  await record(db,req,s.c,'payer_responsibility.'+b.action,'payer_responsibility',id);return r;
 }));
});
