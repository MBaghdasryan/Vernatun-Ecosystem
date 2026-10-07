import type {Request,Router} from 'express';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {context,requirePermission,ApiError} from './access.js';
import {permissionDecision} from './iam-evaluator.js';
import {transaction,record,idempotent} from './operations.js';
import {pool} from './db.js';

type DefectLookup=(req:Request,id:string,db?:PoolClient)=>Promise<any[]>;
const uuid=z.string().uuid();
const messageInput=z.object({key:uuid,body:z.string().trim().min(1).max(4000)}).strict();
// Reuse the existing append-only defect history and the same authorization as
// transitions/photos. Clarification does not alter workflow status or version.
export function registerDefectCollaboration(router:Router,lookup:DefectLookup){
 router.get('/defects/:id/collaboration',async(req,res)=>{
  const id=uuid.parse(req.params.id),before=uuid.optional().parse(req.query.before);
   const db=pool,d=(await lookup(req,id))[0],c=await context(req);
   if(before&&!(await db.query("SELECT id FROM defect_history WHERE id=$1 AND defect_id=$2 AND action='message'",[before,id])).rowCount)throw new ApiError(404,'not_found');
   const rows=(await db.query(`SELECT h.id,h.actor_id,u.name AS actor,h.note AS body,h.created_at
    FROM defect_history h JOIN users u ON u.id=h.actor_id
    WHERE h.defect_id=$1 AND h.action='message' AND ($2::uuid IS NULL OR
      (h.created_at,h.id)<(SELECT created_at,id FROM defect_history WHERE id=$2))
    ORDER BY h.created_at DESC,h.id DESC LIMIT 31`,[id,before??null])).rows;
   const nextCursor=rows.length>30?rows[29].id:null;
   const total=(await db.query("SELECT count(*)::int AS n FROM defect_history WHERE defect_id=$1 AND action='message'",[id])).rows[0].n;
   const writerPermission=c.permissions.includes('defects.manage')?'defects.manage':'defects.execute';
   const decision=await permissionDecision(c,writerPermission,'POST');
   res.json({defectId:id,messages:rows.slice(0,30).reverse(),total,nextCursor,
    canWrite:decision.allowed&&(writerPermission==='defects.manage'||d.contractor_id===req.user!.id),
    photos:(await db.query('SELECT id,created_at FROM file_attachments WHERE defect_id=$1 ORDER BY created_at,id',[id])).rows,
    reports:(await db.query(`SELECT h.id,u.name AS actor,h.action,h.note,h.created_at
     FROM defect_history h JOIN users u ON u.id=h.actor_id WHERE h.defect_id=$1
     AND h.action IN ('report','return','accept','reopen') ORDER BY h.created_at DESC,h.id DESC`,[id])).rows});
 });
 router.post('/defects/:id/messages',async(req,res)=>{
  const id=uuid.parse(req.params.id),b=messageInput.parse(req.body);
  // Authorize before reserving a transaction connection: context evaluation
  // uses the pool itself. Recheck the locked parent before replaying a receipt.
  const initial=(await lookup(req,id))[0],current=await context(req);
  const permission=current.permissions.includes('defects.manage')?'defects.manage':'defects.execute';
  const c=await requirePermission(req,permission);
  res.status(201).json(await transaction(async db=>{
   const d=(await db.query('SELECT organization_id,unit_id,contractor_id FROM defects WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!d||d.organization_id!==initial.organization_id||d.unit_id!==initial.unit_id||
    !current.permissions.includes('defects.read')&&d.contractor_id!==req.user!.id)throw new ApiError(404,'not_found');
   if(permission==='defects.execute'&&d.contractor_id!==req.user!.id)throw new ApiError(403,'forbidden');
   return idempotent(db,req,b.key,b,async()=>{
    const h=(await db.query(`INSERT INTO defect_history(defect_id,actor_id,action,note)
      VALUES($1,$2,'message',$3) RETURNING id,actor_id,note AS body,created_at`,[id,req.user!.id,b.body])).rows[0];
    // Audit the existence, not the private conversation body.
    await record(db,req,c,'defect.message','defect',id,{messageId:h.id});
    return {...h,actor:req.user!.name};
   });
  }));
 });
}
