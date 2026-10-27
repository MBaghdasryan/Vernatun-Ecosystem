import {Router} from 'express';
import {z} from 'zod';
import {createHmac,randomInt,randomUUID,timingSafeEqual} from 'node:crypto';
import {pool} from './db.js';
import {config} from './config.js';
import {ApiError,requireAuth} from './access.js';
import {transaction,record} from './operations.js';
import {assertEmailConfigured,deliverEmail} from './email.js';
import {enabled,writable,readRecord,validListingCoordinates} from './resident-policy.js';
import {ownScope,neighbors,notificationSettings,bookingColumns,chatEnabled} from './resident-continuity-store.js';
import {residentActivation} from './resident-activation.js';

export const residentContinuity=Router();residentContinuity.use(requireAuth);
const uuid=z.string().uuid(),body=z.string().trim().min(3).max(4000);
const digest=(user:string,email:string,code:string)=>createHmac('sha256',config.SESSION_SECRET).update(user+'\0'+email+'\0'+code).digest('hex');
const quiet=z.object({emailEnabled:z.boolean(),inAppEnabled:z.boolean(),quietEnabled:z.boolean(),
 quietStart:z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),quietEnd:z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
 timezone:z.string().max(80).refine(t=>{try{new Intl.DateTimeFormat('en',{timeZone:t});return true}catch{return false}}),
 version:z.number().int().min(0)}).strict();
const saved=z.object({name:z.string().trim().min(1).max(100),query:z.string().trim().max(200),offerType:z.enum(['all','sale','rent'])}).strict();

residentContinuity.get('/continuity',async(req,res)=>{
 const s=await ownScope(req),user=req.user!.id,chat=chatEnabled(s),market=!!enabled(s,'listings'),book=!!enabled(s,'services');
 const people=await neighbors(s,user),ids=people.map(p=>p.id);
 const chats=chat?(await pool.query(`SELECT t.id,u.name,cardinality(t.blocked_by)>0 AS blocked,$3=ANY(t.blocked_by) AS "blockedByMe",
  (SELECT count(*)::int FROM resident_direct_messages m LEFT JOIN resident_direct_reads r ON r.thread_id=t.id AND r.user_id=$3
   WHERE m.thread_id=t.id AND m.sender_id<>$3 AND (r.read_at IS NULL OR m.created_at>r.read_at)) AS unread
  FROM resident_direct_threads t JOIN users u ON u.id=CASE WHEN t.left_user=$3 THEN t.right_user ELSE t.left_user END
  WHERE t.organization_id=$1 AND t.building_id=$2 AND $3 IN(t.left_user,t.right_user) AND u.id=ANY($4::uuid[])
  ORDER BY t.updated_at DESC,t.id LIMIT 100`,[s.organizationId,s.buildingId,user,ids])).rows:[];
 const account=(await pool.query(`SELECT u.email,COALESCE(p.verified_email=lower(u.email) AND p.email_verified_at IS NOT NULL,false) AS verified
  FROM users u LEFT JOIN resident_profiles p ON p.user_id=u.id WHERE u.id=$1`,[user])).rows[0];
 const savedSearches=market?(await pool.query(`SELECT id,name,filters->>'query' AS query,filters->>'offerType' AS "offerType"
  FROM resident_saved_searches WHERE user_id=$1 AND organization_id=$2 AND building_id=$3 ORDER BY created_at DESC,id LIMIT 50`,[user,s.organizationId,s.buildingId])).rows:[];
 const tickets=(await pool.query(`SELECT id,subject,body,status,reply,created_at AS "createdAt" FROM support_cases
  WHERE organization_id=$1 AND created_by=$2 ORDER BY created_at DESC,id LIMIT 50`,[s.organizationId,user])).rows;
 const aiHistory=(await pool.query(`SELECT t.id,t.title,m.body,t.created_at AS "createdAt",'NOT_CONFIGURED' AS "providerStatus"
  FROM resident_ai_threads t JOIN resident_ai_messages m ON m.thread_id=t.id WHERE t.organization_id=$1 AND t.building_id=$2
  AND t.unit_id=$3 AND t.user_id=$4 ORDER BY t.created_at DESC,t.id LIMIT 50`,[s.organizationId,s.buildingId,s.unitId,user])).rows;
 const bookings=book?(await pool.query(`SELECT ${bookingColumns} FROM resident_service_bookings WHERE organization_id=$1
  AND building_id=$2 AND unit_id=$3 AND user_id=$4 ORDER BY created_at DESC,id LIMIT 50`,[s.organizationId,s.buildingId,s.unitId,user])).rows:[];
 res.json({email:account.email,emailVerified:account.verified,phoneVerification:'PROVIDER_REQUIRED',notificationSettings:await notificationSettings(user),
  neighbors:people,chats,savedSearches,tickets,aiHistory,bookings,administrative:false,canChat:chat,canMarketplace:market,canBook:book,
  activation:await residentActivation(user,s.buildingId,s.organizationId),
  avatarAvailable:!!(await pool.query('SELECT 1 FROM resident_avatars WHERE user_id=$1 AND active',[user])).rowCount,
  organizationTimezone:(await pool.query('SELECT timezone FROM organizations WHERE id=$1',[s.organizationId])).rows[0].timezone});
});
residentContinuity.post('/email-verification',async(req,res)=>{
 const s=await ownScope(req);writable(s);assertEmailConfigured();
 const code=String(randomInt(100000,1000000)),user=req.user!.id;
 const email=await transaction(async db=>{
  const account=(await db.query('SELECT lower(email) AS email FROM users WHERE id=$1 FOR UPDATE',[user])).rows[0];
  const old=(await db.query('SELECT sent_at FROM resident_email_challenges WHERE user_id=$1',[user])).rows[0];
  if(old&&Date.now()-new Date(old.sent_at).getTime()<60000)throw new ApiError(429,'rate_limited');
  await db.query(`INSERT INTO resident_email_challenges(user_id,email,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')
   ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,code_hash=excluded.code_hash,expires_at=excluded.expires_at,
   attempts=0,consumed_at=NULL,sent_at=now()`,[user,account.email,digest(user,account.email,code)]);
  await record(db,req,s.c,'resident.email_verification.request','user',user);return account.email;
 });
 const lang=req.user!.locale;
 const subject=lang==='ru'?'Vernatun: подтверждение email':lang==='hy'?'Vernatun․ էլ․ հասցեի հաստատում':'Vernatun: verify your email';
 await deliverEmail({to:email,subject,text:code,url:config.APP_ORIGIN+'/imtun/preferences'},'resident-verification-'+randomUUID());
 res.status(202).json({status:'accepted'});
});
residentContinuity.put('/email-verification',async(req,res)=>{
 const s=await ownScope(req);writable(s);const {code}=z.object({code:z.string().regex(/^[0-9]{6}$/)}).strict().parse(req.body),user=req.user!.id;
 const ok=await transaction(async db=>{
  const current=(await db.query('SELECT lower(email) AS email FROM users WHERE id=$1 FOR UPDATE',[user])).rows[0];
  const c=(await db.query('SELECT * FROM resident_email_challenges WHERE user_id=$1 FOR UPDATE',[user])).rows[0];
  if(!c||c.consumed_at||c.attempts>=5||Date.parse(c.expires_at)<=Date.now()||c.email!==current.email)return false;
  await db.query('UPDATE resident_email_challenges SET attempts=attempts+1 WHERE user_id=$1',[user]);
  if(!timingSafeEqual(Buffer.from(c.code_hash,'hex'),Buffer.from(digest(user,current.email,code),'hex')))return false;
  await db.query(`INSERT INTO resident_profiles(user_id,verified_email,email_verified_at) VALUES($1,$2,now())
   ON CONFLICT(user_id) DO UPDATE SET verified_email=$2,email_verified_at=now(),updated_at=now()`,[user,current.email]);
  await db.query('UPDATE resident_email_challenges SET consumed_at=now() WHERE user_id=$1',[user]);
  await record(db,req,s.c,'resident.email_verification.confirm','user',user);return true;
 });
 if(!ok)throw new ApiError(400,'invalid_or_expired_code');res.status(204).end();
});
residentContinuity.put('/notification-settings',async(req,res)=>{
 const s=await ownScope(req);writable(s);const b=quiet.parse(req.body),user=req.user!.id;
 await transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['notification-prefs:'+user]);
  const old=(await db.query('SELECT version FROM notification_preferences WHERE user_id=$1 FOR UPDATE',[user])).rows[0];
  if((old?.version??0)!==b.version)throw new ApiError(409,'version_conflict');
  if(b.quietEnabled&&b.quietStart===b.quietEnd)throw new ApiError(400,'invalid_quiet_hours');
  await db.query(`INSERT INTO notification_preferences(user_id,email_enabled,in_app_enabled,quiet_enabled,quiet_start,quiet_end,timezone)
   VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id) DO UPDATE SET email_enabled=$2,in_app_enabled=$3,
   quiet_enabled=$4,quiet_start=$5,quiet_end=$6,timezone=$7,version=notification_preferences.version+1,updated_at=now()`,
   [user,b.emailEnabled,b.inAppEnabled,b.quietEnabled,b.quietStart,b.quietEnd,b.timezone]);
  await record(db,req,s.c,'resident.notification_preferences.update','user',user);
 });res.json(await notificationSettings(user));
});
residentContinuity.post('/saved-searches',async(req,res)=>{
 const s=await ownScope(req);writable(s);if(!enabled(s,'listings'))throw new ApiError(403,'feature_disabled');
 const b=saved.parse(req.body),user=req.user!.id;
 const row=await transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['resident-searches:'+user]);
  if(Number((await db.query('SELECT count(*) FROM resident_saved_searches WHERE user_id=$1',[user])).rows[0].count)>=50)throw new ApiError(409,'limit_reached');
  const r=(await db.query(`INSERT INTO resident_saved_searches(organization_id,building_id,user_id,name,filters) VALUES($1,$2,$3,$4,$5) RETURNING id`,
   [s.organizationId,s.buildingId,user,b.name,JSON.stringify({query:b.query,offerType:b.offerType})])).rows[0];
  await record(db,req,s.c,'resident.saved_search.create','resident_saved_search',r.id);return r;
 });res.status(201).json({...row,...b});
});
residentContinuity.delete('/saved-searches/:id',async(req,res)=>{
 const s=await ownScope(req);writable(s);
 if(!enabled(s,'listings'))throw new ApiError(403,'feature_disabled');
 const r=await pool.query('DELETE FROM resident_saved_searches WHERE id=$1 AND user_id=$2 AND organization_id=$3 AND building_id=$4 RETURNING id',
  [uuid.parse(req.params.id),req.user!.id,s.organizationId,s.buildingId]);
 if(!r.rowCount)throw new ApiError(404,'not_found');res.status(204).end();
});
residentContinuity.get('/property-comparison',async(req,res)=>{
 const s=await ownScope(req);if(!enabled(s,'listings'))throw new ApiError(403,'feature_disabled');
 const ids=z.array(uuid).min(1).max(4).parse(z.string().max(150).parse(req.query.ids).split(','));
 const address=(await pool.query('SELECT address FROM buildings WHERE id=$1 AND organization_id=$2',[s.buildingId,s.organizationId])).rows[0].address;
 const result=[];for(const id of [...new Set(ids)]){
  const r=await readRecord(pool,s,'listings',id,req.user!.id);
  const location= r.location_verification_status==='verified'&&validListingCoordinates(r.data)
   ?{latitude:r.data.latitude,longitude:r.data.longitude}:{latitude:null,longitude:null};
  result.push({id:r.id,title:r.title,description:r.body,priceMinor:r.data.priceMinor??null,currency:r.data.currency??null,address,...location});
 }res.json(result);
});
residentContinuity.post('/platform-tickets',async(req,res)=>{
 const s=await ownScope(req);writable(s);const b=z.object({subject:z.string().trim().min(3).max(160),body}).strict().parse(req.body);
 res.status(201).json(await transaction(async db=>{
  const r=(await db.query(`INSERT INTO support_cases(organization_id,created_by,subject,body) VALUES($1,$2,$3,$4)
   RETURNING id,subject,body,status,reply,created_at AS "createdAt"`,[s.organizationId,req.user!.id,b.subject,b.body])).rows[0];
  await record(db,req,s.c,'resident.platform_support.create','support_case',r.id);return r;
 }));
});
residentContinuity.post('/ai-history',async(req,res)=>{
 const s=await ownScope(req);writable(s);
 const b=z.object({title:z.string().trim().min(3).max(160),body:z.string().trim().min(1).max(4000),clientId:uuid}).strict().parse(req.body);
 res.status(201).json(await transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['resident-ai:'+req.user!.id]);
  const old=(await db.query(`SELECT t.id,t.title,m.body,t.created_at AS "createdAt" FROM resident_ai_threads t
   JOIN resident_ai_messages m ON m.thread_id=t.id WHERE t.user_id=$1 AND m.client_id=$2 AND t.organization_id=$3
   AND t.building_id=$4 AND t.unit_id=$5`,[req.user!.id,b.clientId,s.organizationId,s.buildingId,s.unitId])).rows[0];
  if(old){if(old.body!==b.body||old.title!==b.title)throw new ApiError(409,'idempotency_conflict');return {...old,providerStatus:'NOT_CONFIGURED'};}
  const r=(await db.query(`INSERT INTO resident_ai_threads(organization_id,building_id,unit_id,user_id,title) VALUES($1,$2,$3,$4,$5)
   RETURNING id,title,created_at AS "createdAt"`,[s.organizationId,s.buildingId,s.unitId,req.user!.id,b.title])).rows[0];
  await db.query('INSERT INTO resident_ai_messages(thread_id,client_id,body) VALUES($1,$2,$3)',[r.id,b.clientId,b.body]);
  await record(db,req,s.c,'resident.ai_history.save','resident_ai_thread',r.id);
  return {...r,body:b.body,providerStatus:'NOT_CONFIGURED'};
 }));
});
residentContinuity.delete('/ai-history/:id',async(req,res)=>{
 const s=await ownScope(req);writable(s);
 await transaction(async db=>{
  const r=(await db.query('SELECT id FROM resident_ai_threads WHERE id=$1 AND user_id=$2 AND organization_id=$3 AND building_id=$4 AND unit_id=$5 FOR UPDATE',
   [uuid.parse(req.params.id),req.user!.id,s.organizationId,s.buildingId,s.unitId])).rows[0];
  if(!r)throw new ApiError(404,'not_found');
  await db.query('DELETE FROM resident_ai_messages WHERE thread_id=$1',[r.id]);
  await db.query('DELETE FROM resident_ai_threads WHERE id=$1',[r.id]);
  await record(db,req,s.c,'resident.ai_history.delete','resident_ai_thread',r.id);
 });res.status(204).end();
});
