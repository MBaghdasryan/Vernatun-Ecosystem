import type {Router,Request,RequestHandler} from 'express';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError} from './access.js';
import {requireRecentAuthentication} from './recent-auth.js';

const ref=(sid:string)=>createHash('sha256').update(sid).digest('hex');
export function sessionDevice(userAgent:string){
 const ua=userAgent.slice(0,1000);
 const browser=/Edg\//.test(ua)?'Edge':/Firefox\//.test(ua)?'Firefox':/Chrome\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'Unknown browser';
 const device=/iPhone|iPad/.test(ua)?'iOS':/Android/.test(ua)?'Android':/Windows/.test(ua)?'Windows':/Macintosh/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'Unknown device';
 return `${browser} / ${device}`;
}
// A late save by an already-running request must not revive a revoked session.
export const sessionRevocationGuard:RequestHandler=async(req,res,next)=>{
 try{
  if(req.session?.passport?.user){
   const revoked=await pool.query('SELECT 1 FROM system_revoked_sessions WHERE ref=$1',[ref(req.sessionID)]);
   if(revoked.rowCount){
    await new Promise<void>((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()));
    res.clearCookie('vernatun.sid');
   }else{
    if(!req.session.lastSeenAt||Date.now()-Date.parse(req.session.lastSeenAt)>60000)req.session.lastSeenAt=new Date().toISOString();
   }
  }
  next();
 }catch(e){next(e)}
};
const columns=`encode(sha256(convert_to(s.sid,'UTF8')),'hex') AS ref,u.id AS "userId",u.name,
 s.sess->>'issuedAt' AS "createdAt",s.sess->>'lastSeenAt' AS "lastActivityAt",
 s.expire AS "expiresAt",s.sess->>'device' AS device`;
const active=`FROM session s JOIN users u ON u.id::text=s.sess->'passport'->>'user'
 WHERE s.expire>now() AND NOT EXISTS(SELECT 1 FROM system_revoked_sessions r WHERE r.ref=encode(sha256(convert_to(s.sid,'UTF8')),'hex'))`;
export function registerSystemSessions(router:Router,permit:(req:Request,p:string)=>Promise<unknown>){
 router.get('/system/sessions',async(req,res)=>{
  await permit(req,'sessions.read');
  const f=z.object({userId:z.string().uuid().optional(),page:z.coerce.number().int().min(1).max(10000).default(1)}).strict().parse(req.query);
  const filter=' AND ($1::uuid IS NULL OR u.id=$1)';
  const data=await pool.query(`SELECT ${columns} ${active}${filter} ORDER BY s.expire DESC,s.sid LIMIT 51 OFFSET $2`,[f.userId??null,(f.page-1)*50]);
  const total=await pool.query(`SELECT count(*)::int AS n ${active}${filter}`,[f.userId??null]);
  res.json({total:total.rows[0].n,page:f.page,hasMore:data.rows.length>50,
   items:data.rows.slice(0,50).map(r=>({...r,current:r.ref===ref(req.sessionID)}))});
 });
 router.post('/system/sessions/revoke',async(req,res)=>{
  await permit(req,'sessions.read');await permit(req,'sessions.revoke');requireRecentAuthentication(req);
  const b=z.object({sessionRef:z.string().regex(/^[a-f0-9]{64}$/).optional(),userId:z.string().uuid().optional(),
   confirmation:z.literal('REVOKE')}).strict().refine(x=>!!x.sessionRef!==!!x.userId).parse(req.body);
  const db=await pool.connect();
  let count=0,currentRevoked=false;
  try{
   await db.query('BEGIN');
   const rows=await db.query(`SELECT sid,expire FROM session WHERE expire>now() AND sess->'passport'->>'user' IS NOT NULL
    AND (($1::text IS NOT NULL AND encode(sha256(convert_to(sid,'UTF8')),'hex')=$1)
    OR ($2::uuid IS NOT NULL AND sess->'passport'->>'user'=$2::text)) FOR UPDATE`,[b.sessionRef??null,b.userId??null]);
   if(b.sessionRef&&!rows.rowCount)throw new ApiError(404,'session_not_found');
   for(const row of rows.rows){
    await db.query('INSERT INTO system_revoked_sessions(ref,expires_at) VALUES($1,$2) ON CONFLICT DO NOTHING',[ref(row.sid),row.expire]);
    await db.query('DELETE FROM session WHERE sid=$1',[row.sid]);
    if(row.sid===req.sessionID)currentRevoked=true;
   }
   count=rows.rowCount??0;
   await db.query(`INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,details)
    VALUES($1,'system.sessions.revoke','user',$2,$3::jsonb)`,[req.user!.id,b.userId??null,JSON.stringify({count,scope:b.sessionRef?'single':'user'})]);
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
  if(currentRevoked){await new Promise<void>((resolve,reject)=>req.session.destroy(e=>e?reject(e):resolve()));res.clearCookie('vernatun.sid')}
  res.json({count,currentRevoked});
 });
}
