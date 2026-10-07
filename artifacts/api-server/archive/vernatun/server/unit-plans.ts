import {Router,raw} from 'express';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {pool} from './db.js';
import {requireAuth,requirePermission,scopedUnit,ApiError} from './access.js';
import {permissionDecision} from './iam-evaluator.js';
import {transaction,record,idempotent} from './operations.js';
import {sanitizeDocument} from './document-versions.js';
import {saveAndCommitPrivateFile,readPrivateFile} from './private-files.js';

export const unitPlans=Router();unitPlans.use(requireAuth);
const uuid=z.string().uuid();
const version=z.coerce.number().int().nonnegative();
async function authorize(req:any,write=false){
 const c=await requirePermission(req,write?'handover.manage':'handover.read');
 const u=await scopedUnit(c,uuid.parse(req.params.unitId));
 return {c,u};
}
async function current(db:any,unitId:string){
 return (await db.query('SELECT * FROM unit_plans WHERE unit_id=$1 AND retired_at IS NULL',[unitId])).rows[0];
}
async function lockUnit(db:any,u:any){
 if(!(await db.query('SELECT id FROM units WHERE id=$1 AND organization_id=$2 AND building_id=$3 FOR UPDATE',[u.id,u.organization_id,u.building_id])).rowCount)throw new ApiError(404,'not_found');
}
unitPlans.get('/unit-plans/:unitId',async(req,res)=>{
 const {c,u}=await authorize(req),p=await current(pool,u.id);
 const defects=(await pool.query('SELECT id,subject,location,status FROM defects WHERE unit_id=$1 ORDER BY created_at,id',[u.id])).rows;
 res.json({unitId:u.id,canManage:(await permissionDecision(c,'handover.manage','POST')).allowed,
  plan:p?{id:p.id,revision:p.revision,createdAt:p.created_at,markers:(await pool.query('SELECT defect_id AS "defectId",x,y FROM defect_plan_markers WHERE plan_id=$1 ORDER BY defect_id',[p.id])).rows}:null,defects});
});
unitPlans.get('/unit-plans/:unitId/:planId/image',async(req,res)=>{
 const {u}=await authorize(req);
 const p=(await pool.query(`SELECT v.storage_key,v.media_type FROM unit_plans p JOIN document_versions v ON v.id=p.document_version_id
 WHERE p.id=$1 AND p.unit_id=$2 AND p.retired_at IS NULL`,[uuid.parse(req.params.planId),u.id])).rows[0];
 if(!p)throw new ApiError(404,'not_found');
 res.set({'Content-Type':p.media_type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(await readPrivateFile('documents',p.storage_key));
});
unitPlans.post('/unit-plans/:unitId/image',raw({type:'application/octet-stream',limit:'6mb'}),async(req,res)=>{
 const {c,u}=await authorize(req,true);
 const b=z.object({key:uuid,planId:uuid.optional(),revision:version}).strict().parse(req.query);
 const file=await sanitizeDocument(req.body);
 if(file.mediaType!=='image/jpeg')throw new ApiError(400,'image_required');
 const fingerprint={...b,hash:createHash('sha256').update(file.body).digest('hex')};
 const storageKey=randomUUID();
 res.status(201).json(await saveAndCommitPrivateFile('documents',storageKey,file.body,file.mediaType,async db=>{
  await lockUnit(db,u);
  return idempotent(db,req,b.key,fingerprint,async()=>{
   const p=await current(db,u.id);
   if((p?.id??undefined)!==b.planId||(p?.revision??0)!==b.revision)throw new ApiError(409,'stale_version');
   const d=(await db.query(`INSERT INTO documents(organization_id,building_id,unit_id,title,visibility,storage_key,media_type,uploaded_by,category,related_type,related_id)
    VALUES($1,$2,$3,$4,'staff',$5,$6,$7,'unit_plan','unit',$3) RETURNING id`,
    [u.organization_id,u.building_id,u.id,'Unit plan '+u.number,storageKey,file.mediaType,req.user!.id])).rows[0];
   const v=(await db.query('SELECT latest_version_id FROM documents WHERE id=$1',[d.id])).rows[0];
   await db.query('UPDATE unit_plans SET retired_at=now() WHERE unit_id=$1 AND retired_at IS NULL',[u.id]);
   const result=(await db.query('INSERT INTO unit_plans(unit_id,document_version_id,created_by) VALUES($1,$2,$3) RETURNING id,revision',[u.id,v.latest_version_id,req.user!.id])).rows[0];
   await record(db,req,c,'unit_plan.upload','unit_plan',result.id,{previousPlanId:p?.id??null,unitId:u.id});
   return result;
  });
 }));
});
const change=z.object({key:uuid,planId:uuid,revision:version,action:z.enum(['mark','unmark','remove']),defectId:uuid.optional(),x:z.number().min(0).max(1).optional(),y:z.number().min(0).max(1).optional()}).strict();
unitPlans.post('/unit-plans/:unitId',async(req,res)=>{
 const {c,u}=await authorize(req,true),b=change.parse(req.body);
 if(b.action!=='remove'&&!b.defectId||b.action==='mark'&&(b.x===undefined||b.y===undefined))throw new ApiError(400,'invalid_input');
 res.json(await transaction(async db=>{
  await lockUnit(db,u);
  return idempotent(db,req,b.key,b,async()=>{
   const p=await current(db,u.id);
   if(!p||p.id!==b.planId||p.revision!==b.revision)throw new ApiError(409,'stale_version');
   if(b.action!=='remove'&&!(await db.query('SELECT id FROM defects WHERE id=$1 AND unit_id=$2 FOR SHARE',[b.defectId,u.id])).rowCount)throw new ApiError(404,'not_found');
   if(b.action==='mark')await db.query(`INSERT INTO defect_plan_markers(plan_id,defect_id,x,y) VALUES($1,$2,$3,$4)
    ON CONFLICT(plan_id,defect_id) DO UPDATE SET x=EXCLUDED.x,y=EXCLUDED.y`,[p.id,b.defectId,b.x,b.y]);
   if(b.action==='unmark')await db.query('DELETE FROM defect_plan_markers WHERE plan_id=$1 AND defect_id=$2',[p.id,b.defectId]);
   await db.query('UPDATE unit_plans SET revision=revision+1,retired_at=CASE WHEN $2 THEN now() ELSE retired_at END WHERE id=$1',[p.id,b.action==='remove']);
   await record(db,req,c,'unit_plan.'+b.action,'unit_plan',p.id,{defectId:b.defectId,x:b.x,y:b.y,revision:p.revision+1});
   return {id:p.id,revision:p.revision+1};
  });
 }));
});
