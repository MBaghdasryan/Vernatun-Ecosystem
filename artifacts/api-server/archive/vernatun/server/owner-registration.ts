import {createHmac,randomInt,randomUUID,timingSafeEqual} from 'node:crypto';
import {Router,type Request} from 'express';
import {rateLimit} from 'express-rate-limit';
import {z} from 'zod';
import bcrypt from 'bcryptjs';
import type {Pool,PoolClient} from 'pg';
import {pool} from './db.js';
import {config} from './config.js';
import {ApiError,requireAuth,requirePermission,type Context} from './access.js';
import {PostgresRateStore} from './rate-limit.js';
import {transaction,record} from './operations.js';
import {assertEmailConfigured,deliverEmail} from './email.js';
import {subscriptionPolicy} from './subscription-policy.js';

export const ownerRegistrationAuth=Router();
export const ownerRegistrationAdmin=Router();

const uuid=z.string().uuid();
const locale=z.enum(['hy','ru','en']);
const password=z.string().min(12).max(72).refine(value=>Buffer.byteLength(value,'utf8')<=72,'password_too_long');
const registrationBody=z.object({
 name:z.string().trim().min(2).max(100),
 email:z.string().trim().email().max(254),
 password,
 unitId:uuid,
 locale:locale.optional(),
}).strict();
const claimBody=z.object({unitId:uuid}).strict();
const decisionBody=z.object({
 decision:z.enum(['approve','reject']),
 note:z.string().trim().max(500).optional(),
}).strict();
const verificationCode=z.string().regex(/^[0-9]{6}$/);
const ownerRegistrationLimit=rateLimit({windowMs:15*60*1000,limit:15,store:new PostgresRateStore('owner-registration'),standardHeaders:'draft-7',legacyHeaders:false,message:{error:'rate_limited'}});

function codeDigest(userId:string,email:string,code:string){
 return createHmac('sha256',config.SESSION_SECRET).update(userId+'\0'+email+'\0'+code).digest('hex');
}
function validCustomerUnitQuery(where:string){
 return `SELECT u.id AS unit_id,u.number AS unit_number,b.id AS building_id,b.name AS building_name,
  b.address AS building_address,o.id AS organization_id,o.name AS organization_name
  FROM units u JOIN buildings b ON b.id=u.building_id AND b.organization_id=u.organization_id
  JOIN organizations o ON o.id=u.organization_id
  JOIN LATERAL(
   SELECT s.status,s.starts_on,s.ends_on,p.allowed_modules
   FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id
   WHERE s.organization_id=o.id
   ORDER BY (s.starts_on<=(now() AT TIME ZONE 'Asia/Yerevan')::date) DESC,
    s.starts_on DESC,s.created_at DESC,s.id DESC LIMIT 1
  ) current_subscription ON true
  JOIN module_entitlements e ON e.organization_id=o.id AND e.module='community'
  WHERE ${where}
   AND o.status='active' AND o.is_demo=false AND o.subscription_enforced
   AND b.is_demo=false AND u.is_demo=false
   AND current_subscription.status IN ('active','trial')
   AND current_subscription.starts_on<=(now() AT TIME ZONE 'Asia/Yerevan')::date
   AND current_subscription.ends_on>=(now() AT TIME ZONE 'Asia/Yerevan')::date
   AND CASE WHEN e.override_state='enabled' THEN true
    WHEN e.override_state='disabled' THEN false
    ELSE e.enabled AND 'community'=ANY(current_subscription.allowed_modules) END`;
}

async function verifiedEmail(userId:string,email:string,db:Pool|PoolClient=pool){
 const row=(await db.query('SELECT verified_email,email_verified_at FROM resident_profiles WHERE user_id=$1',[userId])).rows[0];
 return row?.verified_email===email&&!!row.email_verified_at;
}

async function storeVerificationCode(db:any,userId:string,email:string){
 const prior=(await db.query('SELECT sent_at FROM resident_email_challenges WHERE user_id=$1 FOR UPDATE',[userId])).rows[0];
 if(prior&&Date.now()-new Date(prior.sent_at).getTime()<60_000)throw new ApiError(429,'rate_limited');
 const code=String(randomInt(100000,1_000_000));
 await db.query(`INSERT INTO resident_email_challenges(user_id,email,code_hash,expires_at,attempts,consumed_at,sent_at)
  VALUES($1,$2,$3,now()+interval '10 minutes',0,NULL,now())
  ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,code_hash=excluded.code_hash,
   expires_at=excluded.expires_at,attempts=0,consumed_at=NULL,sent_at=now()`,
  [userId,email,codeDigest(userId,email,code)]);
 return code;
}

async function sendVerification(userId:string,email:string,code:string,language:'hy'|'ru'|'en'){
 const subject=language==='hy'?'ImTun · հաստատման կոդ':language==='ru'?'ImTun · код подтверждения':'ImTun · verification code';
 const text=language==='hy'
  ?`Ձեր ImTun հաստատման կոդը՝ ${code}։ Այն ուժի մեջ է 10 րոպե։`
  :language==='ru'
   ?`Код подтверждения ImTun: ${code}. Он действует 10 минут.`
   :`Your ImTun verification code is ${code}. It expires in 10 minutes.`;
 await deliverEmail({to:email,subject,text,url:config.APP_ORIGIN},`owner-registration-${userId}-${randomUUID()}`);
}

async function customerCatalog(){
 const rows=(await pool.query(validCustomerUnitQuery('true')+`
  ORDER BY o.name,b.name,u.number,u.id LIMIT 5000`)).rows;
 const byBuilding=new Map<string,{organizationId:string;organizationName:string;buildingId:string;buildingName:string;address:string;units:{id:string;number:string}[]}>();
 for(const row of rows){
  let building=byBuilding.get(row.building_id);
  if(!building){
   building={organizationId:row.organization_id,organizationName:row.organization_name,buildingId:row.building_id,
    buildingName:row.building_name,address:row.building_address,units:[]};
   byBuilding.set(row.building_id,building);
  }
  building.units.push({id:row.unit_id,number:row.unit_number});
 }
 return [...byBuilding.values()];
}

async function createClaim(userId:string,unitId:string,req:Request,existing?:{email:string;name?:string}){
 return transaction(async db=>{
  const unit=(await db.query(validCustomerUnitQuery('u.id=$1'),[unitId])).rows[0];
  if(!unit)throw new ApiError(404,'customer_building_not_found');
  const user=(await db.query('SELECT id,email,name,blocked FROM users WHERE id=$1 FOR UPDATE',[userId])).rows[0];
  if(!user||user.blocked)throw new ApiError(403,'forbidden');
  const prior=(await db.query(`SELECT id,status FROM resident_owner_access_requests
   WHERE user_id=$1 AND unit_id=$2 AND status IN ('pending_email','pending_approval')
   FOR UPDATE`,[userId,unitId])).rows[0];
  if(prior)throw new ApiError(409,'owner_request_already_pending');
  const isVerified=await verifiedEmail(userId,user.email,db);
  const status=isVerified?'pending_approval':'pending_email';
  const claim=(await db.query(`INSERT INTO resident_owner_access_requests(user_id,organization_id,building_id,unit_id,status)
   VALUES($1,$2,$3,$4,$5) RETURNING id,status`,
   [userId,unit.organization_id,unit.building_id,unit.unit_id,status])).rows[0];
  let code:string|undefined;
  if(!isVerified)code=await storeVerificationCode(db,userId,user.email);
  await db.query(`INSERT INTO audit_events(actor_user_id,organization_id,action,entity_type,entity_id,details)
   VALUES($1,$2,'resident.owner_access.request','resident_owner_access_request',$3,$4::jsonb)`,
   [req.user?.id??null,unit.organization_id,claim.id,JSON.stringify({status,unitId})]);
  return {claim,user:{id:user.id,email:user.email,name:user.name},unit,code};
 });
}

ownerRegistrationAuth.get('/owner-registration/catalog',ownerRegistrationLimit,async(_req,res)=>{
 res.json({buildings:await customerCatalog()});
});

ownerRegistrationAuth.post('/owner-registration',ownerRegistrationLimit,async(req,res)=>{
 const body=registrationBody.parse(req.body);
 assertEmailConfigured();
 const email=body.email.toLowerCase();
 const passwordHash=await bcrypt.hash(body.password,12);
 const created=await transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['owner-registration:'+email]);
  if((await db.query('SELECT id FROM users WHERE lower(email)=$1 FOR UPDATE',[email])).rowCount)
   throw new ApiError(409,'email_already_registered');
  const unit=(await db.query(validCustomerUnitQuery('u.id=$1'),[body.unitId])).rows[0];
  if(!unit)throw new ApiError(404,'customer_building_not_found');
  const user=(await db.query(`INSERT INTO users(email,name,password_hash,locale)
   VALUES($1,$2,$3,$4) RETURNING id,email,name`,[email,body.name,passwordHash,body.locale??'hy'])).rows[0];
  const claim=(await db.query(`INSERT INTO resident_owner_access_requests(user_id,organization_id,building_id,unit_id,status)
   VALUES($1,$2,$3,$4,'pending_email') RETURNING id`,
   [user.id,unit.organization_id,unit.building_id,unit.unit_id])).rows[0];
  const code=await storeVerificationCode(db,user.id,email);
  await db.query(`INSERT INTO audit_events(organization_id,action,entity_type,entity_id,details)
   VALUES($1,'resident.owner_access.register','resident_owner_access_request',$2,$3::jsonb)`,
   [unit.organization_id,claim.id,JSON.stringify({status:'pending_email',unitId:body.unitId})]);
  return {user,code};
 });
 await sendVerification(created.user.id,email,created.code,body.locale??'hy');
 res.status(201).json({status:'verification_required'});
});

ownerRegistrationAuth.get('/owner-registration/status',requireAuth,async(req,res)=>{
 const rows=(await pool.query(`SELECT r.id,r.status,r.requested_at AS "requestedAt",r.reviewed_at AS "reviewedAt",
  r.review_note AS "reviewNote",o.name AS "organizationName",b.name AS "buildingName",
  u.number AS "unitNumber"
  FROM resident_owner_access_requests r JOIN organizations o ON o.id=r.organization_id
  JOIN buildings b ON b.id=r.building_id AND b.organization_id=r.organization_id
  JOIN units u ON u.id=r.unit_id AND u.building_id=r.building_id AND u.organization_id=r.organization_id
  WHERE r.user_id=$1 ORDER BY r.requested_at DESC,r.id DESC LIMIT 20`,[req.user!.id])).rows;
 const account=(await pool.query(`SELECT u.email,COALESCE(p.verified_email=lower(u.email) AND p.email_verified_at IS NOT NULL,false) AS "emailVerified"
  FROM users u LEFT JOIN resident_profiles p ON p.user_id=u.id WHERE u.id=$1`,[req.user!.id])).rows[0];
 res.json({email:account.email,emailVerified:account.emailVerified,requests:rows});
});

ownerRegistrationAuth.post('/owner-registration/claims',requireAuth,ownerRegistrationLimit,async(req,res)=>{
 assertEmailConfigured();
 const body=claimBody.parse(req.body);
 const created=await createClaim(req.user!.id,body.unitId,req);
 if(created.code)await sendVerification(created.user.id,created.user.email,created.code,req.user!.locale);
 res.status(201).json({id:created.claim.id,status:created.claim.status});
});

ownerRegistrationAuth.post('/owner-registration/resend-code',requireAuth,ownerRegistrationLimit,async(req,res)=>{
 assertEmailConfigured();
 const result=await transaction(async db=>{
  const claim=(await db.query(`SELECT r.id,r.status,u.email FROM resident_owner_access_requests r
   JOIN users u ON u.id=r.user_id WHERE r.user_id=$1 AND r.status='pending_email'
   ORDER BY r.requested_at DESC,r.id DESC LIMIT 1 FOR UPDATE OF r`,[req.user!.id])).rows[0];
  if(!claim)throw new ApiError(409,'verification_not_required');
  const code=await storeVerificationCode(db,req.user!.id,claim.email);
  return {claim,code};
 });
 await sendVerification(req.user!.id,result.claim.email,result.code,req.user!.locale);
 res.status(202).json({status:'verification_sent'});
});

ownerRegistrationAuth.post('/owner-registration/verify-email',requireAuth,ownerRegistrationLimit,async(req,res)=>{
 const body=z.object({code:verificationCode}).strict().parse(req.body),userId=req.user!.id;
 const valid=await transaction(async db=>{
  const user=(await db.query('SELECT lower(email) AS email FROM users WHERE id=$1 AND NOT blocked FOR UPDATE',[userId])).rows[0];
  if(!user)return false;
  const claims=(await db.query(`SELECT id FROM resident_owner_access_requests WHERE user_id=$1 AND status='pending_email'
   ORDER BY requested_at DESC FOR UPDATE`,[userId])).rows;
  if(!claims.length)return false;
  const challenge=(await db.query('SELECT * FROM resident_email_challenges WHERE user_id=$1 FOR UPDATE',[userId])).rows[0];
  if(!challenge||challenge.email!==user.email||challenge.consumed_at||challenge.attempts>=5||Date.parse(challenge.expires_at)<=Date.now())return false;
  await db.query('UPDATE resident_email_challenges SET attempts=attempts+1 WHERE user_id=$1',[userId]);
  const expected=Buffer.from(challenge.code_hash,'hex'),actual=Buffer.from(codeDigest(userId,user.email,body.code),'hex');
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return false;
  await db.query(`INSERT INTO resident_profiles(user_id,verified_email,email_verified_at)
   VALUES($1,$2,now()) ON CONFLICT(user_id) DO UPDATE SET verified_email=$2,email_verified_at=now(),updated_at=now()`,
   [userId,user.email]);
  await db.query(`UPDATE resident_owner_access_requests SET status='pending_approval'
   WHERE user_id=$1 AND status='pending_email'`,[userId]);
  await db.query('UPDATE resident_email_challenges SET consumed_at=now() WHERE user_id=$1',[userId]);
  await db.query(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,details)
   VALUES($1,'resident.owner_access.email_verified','user',$2,$3::jsonb)`,[userId,userId,'{}']);
  return true;
 });
 if(!valid)throw new ApiError(400,'invalid_or_expired_code');
 res.status(204).end();
});

async function reviewer(req:Request):Promise<Context>{
 const c=await requirePermission(req,'roles.assign');
 if(c.role_key!=='org_admin'||!c.organization_id||c.building_id||c.unit_id)throw new ApiError(403,'forbidden');
 return c;
}

ownerRegistrationAdmin.get('/owner-access-requests',async(req,res)=>{
 const c=await reviewer(req);
 const rows=(await pool.query(`SELECT r.id,r.requested_at AS "requestedAt",u.name AS "applicantName",
  u.email AS "applicantEmail",b.name AS "buildingName",b.address AS "buildingAddress",
  n.number AS "unitNumber"
  FROM resident_owner_access_requests r JOIN users u ON u.id=r.user_id
  JOIN buildings b ON b.id=r.building_id AND b.organization_id=r.organization_id
  JOIN units n ON n.id=r.unit_id AND n.building_id=r.building_id AND n.organization_id=r.organization_id
  WHERE r.organization_id=$1 AND r.status='pending_approval'
   AND ($2::uuid IS NULL OR r.building_id=$2)
  ORDER BY r.requested_at,r.id LIMIT 250`,[c.organization_id,c.building_id])).rows;
 res.json({requests:rows});
});

ownerRegistrationAdmin.post('/owner-access-requests/:id/decision',async(req,res)=>{
 const initial=await reviewer(req),id=uuid.parse(req.params.id),body=decisionBody.parse(req.body);
 if(body.decision==='reject'&&!body.note)throw new ApiError(400,'review_note_required');
 const result=await transaction(async db=>{
  await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[initial.organization_id]);
  const c=await reviewer(req);
  if(c.id!==initial.id||c.organization_id!==initial.organization_id)throw new ApiError(403,'forbidden');
  const claim=(await db.query(`SELECT r.*,u.email,u.blocked FROM resident_owner_access_requests r
   JOIN users u ON u.id=r.user_id WHERE r.id=$1 AND r.organization_id=$2 FOR UPDATE OF r,u`,
   [id,c.organization_id])).rows[0];
  if(!claim)throw new ApiError(404,'not_found');
  if(claim.status!=='pending_approval')throw new ApiError(409,'owner_request_not_pending');
  if(body.decision==='reject'){
   const updated=(await db.query(`UPDATE resident_owner_access_requests SET status='rejected',
    reviewed_at=now(),reviewed_by=$2,review_note=$3 WHERE id=$1 RETURNING id,status`,
    [id,req.user!.id,body.note??''])).rows[0];
   await record(db,req,c,'resident.owner_access.reject','resident_owner_access_request',id,{note:body.note??''});
   return updated;
  }
  if(claim.blocked||!(await verifiedEmail(claim.user_id,claim.email,db)))
   throw new ApiError(403,'email_verification_required');
  if(!c.organization_id)throw new ApiError(403,'forbidden');
  const policy=await subscriptionPolicy(c.organization_id,db);
  if(!policy.enforced||policy.readOnly||!['active','trial'].includes(policy.state)||!policy.modules.includes('community'))
   throw new ApiError(403,'subscription_restricted');
  const unit=(await db.query(`SELECT u.id FROM units u JOIN buildings b ON b.id=u.building_id AND b.organization_id=u.organization_id
   WHERE u.id=$1 AND u.building_id=$2 AND u.organization_id=$3 AND NOT u.is_demo AND NOT b.is_demo AND b.id=$4 FOR UPDATE OF u`,
   [claim.unit_id,claim.building_id,c.organization_id,claim.building_id])).rows[0];
  if(!unit)throw new ApiError(409,'customer_building_unavailable');
  const membership=(await db.query('SELECT active FROM memberships WHERE user_id=$1 AND organization_id=$2 FOR UPDATE',
   [claim.user_id,c.organization_id])).rows[0];
  if(membership?.active===false)throw new ApiError(409,'membership_disabled');
  if(!membership)await db.query('INSERT INTO memberships(user_id,organization_id) VALUES($1,$2)',[claim.user_id,c.organization_id]);
  const assignment=(await db.query(`SELECT id FROM role_assignments WHERE user_id=$1 AND organization_id=$2
   AND role_key='unit_owner' AND unit_id=$3 AND active AND starts_at<=now()
   AND (expires_at IS NULL OR expires_at>now()) LIMIT 1 FOR UPDATE`,
   [claim.user_id,c.organization_id,claim.unit_id])).rows[0];
  if(!assignment)await db.query(`INSERT INTO role_assignments(user_id,organization_id,role_key,building_id,unit_id)
   VALUES($1,$2,'unit_owner',$3,$4)`,
   [claim.user_id,c.organization_id,claim.building_id,claim.unit_id]);
  const updated=(await db.query(`UPDATE resident_owner_access_requests SET status='approved',
   reviewed_at=now(),reviewed_by=$2,review_note=$3 WHERE id=$1 RETURNING id,status`,
   [id,req.user!.id,body.note??''])).rows[0];
  await record(db,req,c,'resident.owner_access.approve','resident_owner_access_request',id,
   {userId:claim.user_id,buildingId:claim.building_id,unitId:claim.unit_id,assignmentCreated:!assignment});
  return updated;
 });
 res.json(result);
});
