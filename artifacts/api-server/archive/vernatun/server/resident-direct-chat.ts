import {Router} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,requireAuth} from './access.js';
import {transaction,record} from './operations.js';
import {writable} from './resident-policy.js';
import {ownScope,neighbors,requireChat,chatEnabled} from './resident-continuity-store.js';
export const residentDirectChat=Router();residentDirectChat.use(requireAuth);
const uuid=z.string().uuid();
residentDirectChat.post('/direct-chats',async(req,res)=>{
 const s=await ownScope(req);writable(s);
 const b=z.object({recipientId:uuid}).strict().parse(req.body),user=req.user!.id;
 if(!chatEnabled(s)||!(await neighbors(s,user)).some(p=>p.id===b.recipientId))throw new ApiError(404,'not_found');
 // The initiating resident must consent too; turning off privacy cannot be bypassed by POST.
 if(!(await pool.query('SELECT 1 FROM resident_profiles WHERE user_id=$1 AND show_name AND allow_messages',[user])).rowCount)throw new ApiError(403,'privacy_consent_required');
 const [left,right]=[user,b.recipientId].sort();
 const r=await transaction(async db=>{
  const row=(await db.query(`INSERT INTO resident_direct_threads(organization_id,building_id,left_user,right_user)
   VALUES($1,$2,$3,$4) ON CONFLICT(building_id,left_user,right_user) DO UPDATE SET updated_at=resident_direct_threads.updated_at
   RETURNING *`,[s.organizationId,s.buildingId,left,right])).rows[0];
  await record(db,req,s.c,'resident.direct_chat.open','resident_direct_thread',row.id);return row;
 });
 res.json({id:r.id,name:(await neighbors(s,user)).find(p=>p.id===b.recipientId)?.name??'',blocked:r.blocked_by.length>0,blockedByMe:r.blocked_by.includes(user),unread:0});
});
residentDirectChat.get('/direct-chats/:id/messages',async(req,res)=>{
 const {r,user}=await requireChat(req,uuid.parse(req.params.id));
 const before=req.query.before===undefined?null:uuid.parse(req.query.before);
 if(before&&!(await pool.query('SELECT 1 FROM resident_direct_messages WHERE id=$1 AND thread_id=$2',[before,r.id])).rowCount)throw new ApiError(404,'not_found');
 const rows=(await pool.query(`SELECT id,body,sender_id=$2 AS own,created_at AS "createdAt" FROM resident_direct_messages
  WHERE thread_id=$1 AND ($3::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM resident_direct_messages WHERE id=$3))
  ORDER BY created_at DESC,id DESC LIMIT 51`,[r.id,user,before])).rows;
 res.json({items:rows.slice(0,50).reverse(),hasMore:rows.length>50});
});
residentDirectChat.post('/direct-chats/:id/messages',async(req,res)=>{
 const input=z.object({body:z.string().trim().min(1).max(4000),clientId:uuid}).strict().parse(req.body);
 // Resolve auth before taking the pooled transaction connection.
 const scope=await requireChat(req,uuid.parse(req.params.id));writable(scope.s);
 res.status(201).json(await transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['resident-direct-send:'+scope.user]);
  await db.query('SELECT user_id FROM resident_profiles WHERE user_id=ANY($1::uuid[]) ORDER BY user_id FOR SHARE',[[scope.user,scope.peer]]);
  const row=(await db.query('SELECT * FROM resident_direct_threads WHERE id=$1 FOR UPDATE',[scope.r.id])).rows[0];
  if(row.blocked_by.length)throw new ApiError(403,'conversation_blocked');
  if(!(await neighbors(scope.s,scope.user,db)).some(p=>p.id===scope.peer)||
   !(await db.query('SELECT 1 FROM resident_profiles WHERE user_id=$1 AND show_name AND allow_messages',[scope.user])).rowCount)throw new ApiError(403,'privacy_consent_required');
  const old=(await db.query('SELECT id,body,sender_id=$2 AS own,created_at AS "createdAt" FROM resident_direct_messages WHERE thread_id=$1 AND sender_id=$2 AND client_id=$3',[row.id,scope.user,input.clientId])).rows[0];
  if(old){if(old.body!==input.body)throw new ApiError(409,'idempotency_conflict');return old;}
  const recent=(await db.query("SELECT count(*) FROM resident_direct_messages WHERE sender_id=$1 AND created_at>now()-interval '1 minute'",[scope.user])).rows[0];
  if(Number(recent.count)>=30)throw new ApiError(429,'rate_limited');
  const r=(await db.query(`INSERT INTO resident_direct_messages(thread_id,sender_id,client_id,body) VALUES($1,$2,$3,$4)
   RETURNING id,body,true AS own,created_at AS "createdAt"`,[row.id,scope.user,input.clientId,input.body])).rows[0];
  await db.query('UPDATE resident_direct_threads SET updated_at=now() WHERE id=$1',[row.id]);
  await record(db,req,scope.s.c,'resident.direct_chat.message','resident_direct_thread',row.id);
  return r;
 }));
});
residentDirectChat.put('/direct-chats/:id/state',async(req,res)=>{
 const b=z.object({action:z.enum(['read','block','unblock'])}).strict().parse(req.body);
 const {s,r,user}=await requireChat(req,uuid.parse(req.params.id));writable(s);
 await transaction(async db=>{
  await db.query('SELECT id FROM resident_direct_threads WHERE id=$1 FOR UPDATE',[r.id]);
  if(b.action==='read')await db.query(`INSERT INTO resident_direct_reads(thread_id,user_id) VALUES($1,$2)
   ON CONFLICT(thread_id,user_id) DO UPDATE SET read_at=now()`,[r.id,user]);
  else await db.query(`UPDATE resident_direct_threads SET blocked_by=
   ${b.action==='block'?'ARRAY(SELECT DISTINCT unnest(blocked_by||ARRAY[$2::uuid]))':'array_remove(blocked_by,$2::uuid)'} WHERE id=$1`,[r.id,user]);
  await record(db,req,s.c,'resident.direct_chat.'+b.action,'resident_direct_thread',r.id);
 });res.status(204).end();
});
