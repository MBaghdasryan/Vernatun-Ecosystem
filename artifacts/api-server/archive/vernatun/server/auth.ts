import {assertEmailConfigured,deliverEmail,emailProviderState,EmailAcceptancePersistenceError} from './email.js';
import {transaction} from './operations.js';
import {subscriptionPolicy} from './subscription-policy.js';
import {verifyMfa} from './mfa.js';
import {PostgresRateStore} from './rate-limit.js';
import {Router,type Request} from 'express';
import passport from 'passport';
import {Strategy} from 'passport-local';
import bcrypt from 'bcryptjs';
import {randomBytes,createHash} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import {z} from 'zod';
import {pool,audit} from './db.js';
import {config} from './config.js';
import {ApiError,contexts,requireAuth} from './access.js';
import {sessionDevice} from './system-sessions.js';
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
const dummyHash=await bcrypt.hash(randomBytes(24).toString('hex'),12);
passport.use(new Strategy({usernameField:'email'},async(email,password,done)=>{try{const r=await pool.query('SELECT * FROM users WHERE email=$1',[email.trim().toLowerCase()]);const u=r.rows[0];const valid=await bcrypt.compare(password,u?.password_hash??dummyHash);if(!u||!valid||u.blocked)return done(null,false);return done(null,{id:u.id,email:u.email,name:u.name,locale:u.locale,currency:u.currency,mustChangePassword:u.must_change_password})}catch(e){done(e)}}));
passport.serializeUser((req:Request,u:Express.User,done:(error:unknown,id?:string)=>void)=>{
 req.session.issuedAt=new Date().toISOString();req.session.lastSeenAt=req.session.issuedAt;
 req.session.device=sessionDevice(req.get('User-Agent')??'');done(null,u.id);
});
passport.deserializeUser(async(id:string,done)=>{try{const r=await pool.query('SELECT id,email,name,locale,currency,must_change_password AS "mustChangePassword" FROM users WHERE id=$1 AND NOT blocked',[id]);done(null,r.rows[0]??false)}catch(e){done(e)}});
export const auth=Router();
const limit=rateLimit({windowMs:15*60*1000,limit:20,store:new PostgresRateStore(),standardHeaders:'draft-7',legacyHeaders:false,message:{error:'rate_limited'}});
const passwordSchema=z.string().min(12).max(72).refine(v=>Buffer.byteLength(v,'utf8')<=72,'password_too_long');
const userFields='id,email,name,locale,currency';
auth.get('/session',async(req,res)=>{
 req.session.csrf??=randomBytes(32).toString('hex');
 const available=req.user?await contexts(req.user.id):[];
 if(available.length===1&&!req.session.contextId)req.session.contextId=available[0].id;
 const restricted=!!req.user?.mustChangePassword;
 res.json({user:req.user??null,contexts:restricted?[]:available,contextId:restricted?null:req.session.contextId??null,
  csrf:req.session.csrf,demo:config.NODE_ENV!=='production',mfaAvailable:true});
});
auth.post('/login',limit,(req,res,next)=>{
 const parsed=z.object({email:z.string().email().max(254),password:z.string().min(1).max(72),code:z.string().min(6).max(30).optional()}).safeParse(req.body);
 if(!parsed.success)return next(new ApiError(400,'invalid_credentials'));
 passport.authenticate('local',async(err:unknown,user:Express.User|false)=>{
  try{
   if(err)return next(err);
   if(!user)throw new ApiError(401,'invalid_credentials');
   // Existing MFA is verified before the restricted recovery session is created.
   const mfaVerified=await verifyMfa(user.id,parsed.data.code);
   req.logIn(user,async(error)=>{
    if(error)return next(error);
    try{
     req.session.csrf=randomBytes(32).toString('hex');
     req.session.createdAt=new Date().toISOString();
     if(mfaVerified)req.session.mfaVerifiedAt=new Date().toISOString();
     const available=await contexts(user.id);
     if(available.length===1)req.session.contextId=available[0].id;
     await audit(user.id,null,'auth.login','user',user.id);
     const contextsForResponse=user.mustChangePassword?[]:available;
     const contextId=user.mustChangePassword?null:req.session.contextId??null;
     req.session.save(e=>e?next(e):res.json({user,contexts:contextsForResponse,contextId,csrf:req.session.csrf}));
    }catch(e){next(e)}
   });
  }catch(e){next(e)}
 })(req,res,next);
});
auth.post('/logout',requireAuth,(req,res,next)=>{req.logout(error=>{if(error)return next(error);req.session.destroy(e=>{if(e)return next(e);res.clearCookie('vernatun.sid');res.status(204).end()})})});
auth.post('/reauthenticate',requireAuth,limit,async(req,res)=>{
 const b=z.object({password:z.string().min(1).max(72),code:z.string().min(6).max(30).optional()}).strict().parse(req.body);
 const u=(await pool.query('SELECT password_hash FROM users WHERE id=$1 AND NOT blocked',[req.user!.id])).rows[0];
 if(!u||!await bcrypt.compare(b.password,u.password_hash))throw new ApiError(401,'invalid_credentials');
 const mfaVerified=await verifyMfa(req.user!.id,b.code);
 if(mfaVerified)req.session.mfaVerifiedAt=new Date().toISOString();
 req.session.createdAt=new Date().toISOString();
 await audit(req.user!.id,null,'auth.reauthenticate','user',req.user!.id);
 res.json({authenticated:true});
});
auth.post('/context',requireAuth,async(req,res)=>{const {id}=z.object({id:z.string().uuid()}).parse(req.body);const available=await contexts(req.user!.id);if(!available.some(c=>c.id===id))throw new ApiError(403,'forbidden');req.session.contextId=id;await audit(req.user!.id,available.find(c=>c.id===id)!.organization_id,'auth.context','role_assignment',id);res.json({contextId:id})});
auth.patch('/preferences',requireAuth,async(req,res)=>{const body=z.object({locale:z.enum(['hy','ru','en']),currency:z.enum(['AMD','RUB','USD'])}).strict().parse(req.body);const r=await pool.query(`UPDATE users SET locale=$1,currency=$2 WHERE id=$3 RETURNING ${userFields}`,[body.locale,body.currency,req.user!.id]);res.json(r.rows[0])});
auth.get('/sessions',requireAuth,async(req,res)=>{const r=await pool.query(`SELECT sid,sess->>'createdAt' AS created_at,expire FROM session WHERE sess->'passport'->>'user'=$1 AND expire>now()`,[req.user!.id]);res.json(r.rows.map(s=>({id:s.sid,current:s.sid===req.sessionID,createdAt:s.created_at,expiresAt:s.expire}))) });
auth.delete('/sessions/:id',requireAuth,async(req,res)=>{const sid=z.string().min(1).max(200).parse(req.params.id);await pool.query(`DELETE FROM session WHERE sid=$1 AND sess->'passport'->>'user'=$2`,[sid,req.user!.id]);await audit(req.user!.id,null,'auth.session.revoke','session',null);if(sid===req.sessionID){req.session.destroy(()=>{});res.clearCookie('vernatun.sid')}res.status(204).end()});
auth.post('/first-login-password',requireAuth,limit,async(req,res)=>{
 const b=z.object({currentPassword:z.string().min(1).max(72),password:passwordSchema}).strict().parse(req.body);
 if(b.currentPassword===b.password)throw new ApiError(400,'password_must_differ');
 const passwordHash=await bcrypt.hash(b.password,12);
 await transaction(async db=>{
  const user=(await db.query('SELECT password_hash,must_change_password FROM users WHERE id=$1::uuid AND NOT blocked FOR UPDATE',[req.user!.id])).rows[0];
  if(!user)throw new ApiError(401,'unauthenticated');
  if(!user.must_change_password)throw new ApiError(409,'password_change_not_required');
  if(!await bcrypt.compare(b.currentPassword,user.password_hash))throw new ApiError(401,'invalid_credentials');
  const mfa=(await db.query('SELECT enabled FROM mfa_credentials WHERE user_id=$1::uuid',[req.user!.id])).rows[0];
  const mfaAge=req.session.mfaVerifiedAt?Date.now()-Date.parse(req.session.mfaVerifiedAt):Infinity;
  if(mfa?.enabled&&(!Number.isFinite(mfaAge)||mfaAge<0||mfaAge>15*60*1000))
   throw new ApiError(403,'recent_mfa_required');
  await db.query('UPDATE users SET password_hash=$1,must_change_password=false WHERE id=$2::uuid',[passwordHash,req.user!.id]);
  await db.query(`INSERT INTO system_revoked_sessions(ref,expires_at)
   SELECT encode(sha256(convert_to(s.sid,'UTF8')),'hex'),s.expire
   FROM session s
   WHERE s.expire>now() AND s.sid<>$2::text AND s.sess->'passport'->>'user'=$1::text
   ON CONFLICT(ref) DO UPDATE SET expires_at=GREATEST(system_revoked_sessions.expires_at,EXCLUDED.expires_at)`,
   [req.user!.id,req.sessionID]);
  await db.query(`DELETE FROM session WHERE sess->'passport'->>'user'=$1::text AND sid<>$2::text`,
   [req.user!.id,req.sessionID]);
  await db.query(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,details)
   VALUES($1::uuid,'auth.password.first_login.change','user',$1::text,'{"method":"forced_recovery"}')`,
   [req.user!.id]);
 });
 res.status(204).end();
});
auth.post('/password',requireAuth,limit,async(req,res)=>{const {currentPassword,password}=z.object({currentPassword:z.string().max(72),password:passwordSchema}).parse(req.body);const r=await pool.query('SELECT password_hash FROM users WHERE id=$1',[req.user!.id]);if(!await bcrypt.compare(currentPassword,r.rows[0].password_hash))throw new ApiError(400,'invalid_credentials');await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[await bcrypt.hash(password,12),req.user!.id]);await pool.query(`DELETE FROM session WHERE sess->'passport'->>'user'=$1 AND sid<>$2`,[req.user!.id,req.sessionID]);await audit(req.user!.id,null,'auth.password.change','user',req.user!.id);res.status(204).end()});
auth.post('/forgot-password',limit,async(req,res)=>{
 const {email}=z.object({email:z.string().email().max(254)}).parse(req.body);assertEmailConfigured();
 const prepared=await transaction(async db=>{
  const user=(await db.query('SELECT id FROM users WHERE email=$1 AND NOT blocked FOR UPDATE',[email.toLowerCase()])).rows[0];if(!user)return null;
  const token=randomBytes(32).toString('hex');await db.query('UPDATE password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',[user.id]);
  const reset=(await db.query("INSERT INTO password_resets(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 minutes') RETURNING id",[user.id,digest(token)])).rows[0];
  await db.query("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,details) VALUES($1,'auth.password.reset.request','user',$2,'{}')",[req.user?.id??null,user.id]);return {id:reset.id,userId:user.id,token};
 });
 if(prepared){const url=config.APP_ORIGIN+'/reset-password?token='+prepared.token;
  try{const sent=await deliverEmail({to:email.toLowerCase(),subject:'Vernatun · Password reset / Գաղտնաբառ / Пароль',text:'Reset link / Վերականգնման հղում / Ссылка восстановления (30 minutes):\n'+url,url},'reset-'+prepared.userId,{business:{type:'password_reset',id:prepared.id}});await audit(req.user?.id??null,null,'auth.password.reset.delivery','user',prepared.userId,{result:'success',delivery:sent.delivery})}
  catch(error){if(!(error instanceof EmailAcceptancePersistenceError))await transaction(async db=>{await db.query('UPDATE password_resets SET used_at=COALESCE(used_at,now()) WHERE id=$1',[prepared.id]);await db.query("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,details) VALUES($1,'auth.password.reset.delivery.failed','user',$2,$3)",[req.user?.id??null,prepared.userId,JSON.stringify({result:'failure'})])})}
 }
 // Acknowledges a request, not email delivery; do not enumerate registered addresses on SMTP recipient failure.
 res.json({message:'reset_if_exists',provider:emailProviderState()});
});
auth.post('/reset-password',limit,async(req,res)=>{const {token,password}=z.object({token:z.string().length(64),password:passwordSchema}).parse(req.body);const hash=await bcrypt.hash(password,12);const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query('SELECT r.* FROM password_resets r JOIN users u ON u.id=r.user_id WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() AND NOT u.blocked FOR UPDATE OF r',[digest(token)]);if(!r.rows[0])throw new ApiError(400,'token_invalid');await client.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hash,r.rows[0].user_id]);await client.query('UPDATE password_resets SET used_at=now() WHERE id=$1',[r.rows[0].id]);await client.query(`DELETE FROM session WHERE sess->'passport'->>'user'=$1`,[r.rows[0].user_id]);await client.query("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id) VALUES($1,'auth.password.reset','user',$2)",[r.rows[0].user_id,r.rows[0].user_id]);await client.query('COMMIT');res.status(204).end()}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}});
auth.post('/accept-invitation',limit,async(req,res)=>{const {token,name,password}=z.object({token:z.string().length(64),name:z.string().trim().min(2).max(100),password:passwordSchema}).parse(req.body);const passwordHash=await bcrypt.hash(password,12);const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query('SELECT * FROM invitations WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE',[digest(token)]);const invitation=r.rows[0];if(!invitation)throw new ApiError(400,'token_invalid');await client.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[invitation.organization_id]);if((await subscriptionPolicy(invitation.organization_id,client)).readOnly)throw new ApiError(403,'subscription_restricted');let delegation:any;if(invitation.delegation_id){delegation=(await client.query(`SELECT d.* FROM resident_delegations d JOIN role_assignments a ON a.id=d.owner_assignment_id JOIN memberships m ON m.user_id=a.user_id AND m.organization_id=a.organization_id JOIN users u ON u.id=a.user_id WHERE d.id=$1 AND d.revoked_at IS NULL AND d.expires_at>now() AND a.active AND m.active AND NOT u.blocked AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now()) FOR UPDATE OF d`,[invitation.delegation_id])).rows[0];if(!delegation)throw new ApiError(400,'token_invalid');}const existing=await client.query('SELECT id FROM users WHERE email=$1',[invitation.email]);let id:string;if(existing.rows[0]){if(!req.user||req.user.id!==existing.rows[0].id)throw new ApiError(409,'sign_in_existing');id=req.user.id}else{const u=await client.query('INSERT INTO users(email,name,password_hash) VALUES($1,$2,$3) RETURNING id',[invitation.email,name,passwordHash]);id=u.rows[0].id}const member=await client.query('SELECT active FROM memberships WHERE user_id=$1 AND organization_id=$2',[id,invitation.organization_id]);if(member.rows[0]?.active===false)throw new ApiError(403,'forbidden');await client.query('INSERT INTO memberships(user_id,organization_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,invitation.organization_id]);const assigned=await client.query('INSERT INTO role_assignments(user_id,organization_id,role_key,building_id,unit_id,expires_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[id,invitation.organization_id,invitation.role_key,invitation.building_id,invitation.unit_id,delegation?.expires_at??null]);if(delegation)await client.query('UPDATE resident_delegations SET assignment_id=$1 WHERE id=$2',[assigned.rows[0].id,delegation.id]);await client.query('UPDATE invitations SET accepted_at=now() WHERE id=$1',[invitation.id]);await client.query("INSERT INTO audit_events(actor_user_id,organization_id,action,entity_type,entity_id) VALUES($1,$2,'invitation.accept','invitation',$3)",[id,invitation.organization_id,invitation.id]);await client.query('COMMIT');res.json({accepted:true})}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}});
