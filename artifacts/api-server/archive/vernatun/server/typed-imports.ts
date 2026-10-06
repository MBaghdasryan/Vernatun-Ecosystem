import {Router} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {context,requireAuth,requirePermission,ApiError} from './access.js';
import {subscriptionPolicy} from './subscription-policy.js';
import {transaction,idempotent,record} from './operations.js';
import {building} from './services.js';
import {uuid,version} from './platform-ops-shared.js';
import {entityType,authorizeStrategy,validateRows,commitRow} from './typed-import-strategies.js';
export const typedImports=Router();typedImports.use(requireAuth);
async function importer(req:Parameters<typeof context>[0]){
 const c=await context(req);return requirePermission(req,c.permissions.includes('imports.manage')?'imports.manage':'imports.finance');
}
async function typePermission(req:Parameters<typeof context>[0],type:string){
 if(type==='opening_balances'){await requirePermission(req,'billing.publish');await requirePermission(req,'payments.reconcile')}
 if(type==='meters'){const c=await context(req);if(!(await subscriptionPolicy(c.organization_id!)).modules.includes('meters'))throw new ApiError(403,'module_disabled')}
}
const input=z.object({key:uuid,buildingId:uuid,entityType,rows:z.array(z.record(z.string().max(100),z.string().max(1000))).min(1).max(1000)}).strict();
typedImports.post('/platform/imports/preview',async(req,res)=>{
 const c=await importer(req),b=input.parse(req.body);authorizeStrategy(c,b.entityType);await building(c,b.buildingId);
 await typePermission(req,b.entityType);
 res.status(201).json(await transaction(db=>idempotent(db,req,b.key,b,async()=>{
 const rows=await validateRows(db,c,b.buildingId,b.entityType,b.rows);
 const r=(await db.query('INSERT INTO typed_import_jobs(organization_id,building_id,created_by,entity_type,status,preview) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[c.organization_id,b.buildingId,req.user!.id,b.entityType,rows.some(r=>r.errors.length)?'invalid':'preview',JSON.stringify(rows)])).rows[0];
 await record(db,req,c,'import.preview','typed_import_job',r.id,{type:b.entityType,rows:rows.length});return r;})));
});
typedImports.get('/platform/imports',async(req,res)=>{
 const c=await importer(req);res.json((await pool.query("SELECT id,building_id,entity_type,status,version,jsonb_array_length(preview) AS row_count,created_at,committed_at FROM typed_import_jobs WHERE organization_id=$1 AND ($2::uuid IS NULL OR building_id=$2) AND ($3 OR entity_type='opening_balances') ORDER BY created_at DESC,id LIMIT 100",[c.organization_id,c.building_id,c.permissions.includes('imports.manage')])).rows);
});
typedImports.get('/platform/imports/:id',async(req,res)=>{
 const c=await importer(req),r=(await pool.query('SELECT * FROM typed_import_jobs WHERE id=$1 AND organization_id=$2 AND ($3::uuid IS NULL OR building_id=$3)',[uuid.parse(req.params.id),c.organization_id,c.building_id])).rows[0];if(!r)throw new ApiError(404,'not_found');authorizeStrategy(c,r.entity_type);res.json(r);
});
typedImports.post('/platform/imports/:id/confirm',async(req,res)=>{
 const c=await importer(req),id=uuid.parse(req.params.id),b=z.object({key:uuid,version:z.number().int().positive()}).strict().parse(req.body);
 res.json(await transaction(async db=>{
 const j=(await db.query('SELECT * FROM typed_import_jobs WHERE id=$1 AND organization_id=$2 AND ($3::uuid IS NULL OR building_id=$3) FOR UPDATE',[id,c.organization_id,c.building_id])).rows[0];if(!j)throw new ApiError(404,'not_found');
 authorizeStrategy(c,j.entity_type);
 await typePermission(req,j.entity_type);
 return idempotent(db,req,b.key,b,async()=>{version(j,b.version);if(j.status!=='preview')throw new ApiError(409,'invalid_import');
 await db.query('SELECT id FROM buildings WHERE id=$1 FOR UPDATE',[j.building_id]);
 // Serialize imports and other unit/account changes; revalidation is based on
 // current registered accounts, not the client-visible preview's IDs.
 await db.query('SELECT id FROM units WHERE building_id=$1 ORDER BY id FOR UPDATE',[j.building_id]);
 const users=j.preview.map((r:any)=>r.userId).filter(Boolean);
 if(users.length){await db.query('SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[users]);await db.query('SELECT id FROM memberships WHERE organization_id=$1 AND user_id=ANY($2::uuid[]) ORDER BY id FOR SHARE',[c.organization_id,users])}
 const fresh=await validateRows(db,c,j.building_id,j.entity_type,j.preview.map((r:any)=>r.source));
 if(fresh.some((r,i)=>r.errors.length||r.unitId!==j.preview[i].unitId||r.userId!==j.preview[i].userId))throw new ApiError(409,'import_changed');
 const entities=[];
 for(const row of fresh){const r=await commitRow(db,c,j.building_id,j.entity_type,row,req.user!.id);entities.push(r.id);
 await db.query('INSERT INTO import_entity_refs(organization_id,job_id,entity_type,reference,entity_id) VALUES($1,$2,$3,$4,$5)',[c.organization_id,id,j.entity_type,r.reference,r.id])}
 await db.query("UPDATE typed_import_jobs SET status='committed',version=version+1,committed_at=now() WHERE id=$1",[id]);await record(db,req,c,'import.commit','typed_import_job',id,{type:j.entity_type,entities});return {id,committed:true,entities};})}));
});
