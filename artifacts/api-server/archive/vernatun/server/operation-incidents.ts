import {Router,type Request} from 'express';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {pool} from './db.js';
import {ApiError,context,requireAuth,requirePermission} from './access.js';
import {transaction,idempotent,record} from './operations.js';
export const operationIncidents=Router();operationIncidents.use(requireAuth);
const uuid=z.string().uuid(),severity=z.enum(['low','normal','high','critical']),status=z.enum(['open','investigating','resolved','closed']);
export async function accessibleIncidents(req:Request,id?:string,db:PoolClient|typeof pool=pool,lock=false){
 const c=await requirePermission(req,'incidents.read');
 const result=await db.query(`SELECT i.*,b.name AS building_name FROM incidents i JOIN buildings b ON b.id=i.building_id WHERE i.organization_id=$1 AND ($2::uuid IS NULL OR i.building_id=$2) AND ($3::uuid IS NULL OR i.building_id=(SELECT building_id FROM units WHERE id=$3)) AND ($4::uuid IS NULL OR i.id=$4) ORDER BY i.created_at DESC ${lock?'FOR UPDATE OF i':''}`,[c.organization_id,c.building_id,c.unit_id,id??null]);
 if(id&&!result.rowCount)throw new ApiError(404,'not_found');return result.rows;
}
async function append(db:PoolClient,req:Request,c:any,row:any,action:string,note=''){
 await db.query('INSERT INTO incident_history(incident_id,actor_id,action,note,snapshot) VALUES($1,$2,$3,$4,$5)',[row.id,req.user!.id,action,note,JSON.stringify({status:row.status,severity:row.severity,version:row.version})]);
 await record(db,req,c,'incident.'+action,'incident',row.id,{status:row.status,severity:row.severity});
}
operationIncidents.get('/incidents',async(req,res)=>res.json(await accessibleIncidents(req)));
operationIncidents.post('/incidents',async(req,res)=>{
 const c=await requirePermission(req,'incidents.create'),b=z.object({key:uuid.optional(),buildingId:uuid,description:z.string().trim().min(5).max(4000),severity:severity.default('normal')}).strict().parse(req.body);
 if(!(await pool.query('SELECT id FROM buildings WHERE id=$1 AND organization_id=$2 AND ($3::uuid IS NULL OR id=$3) AND ($4::uuid IS NULL OR id=(SELECT building_id FROM units WHERE id=$4))',[b.buildingId,c.organization_id,c.building_id,c.unit_id])).rowCount)throw new ApiError(404,'not_found');
 res.status(201).json(await transaction(async db=>{const run=async()=>{const row=(await db.query('INSERT INTO incidents(organization_id,building_id,created_by,description,severity) VALUES($1,$2,$3,$4,$5) RETURNING *',[c.organization_id,b.buildingId,req.user!.id,b.description,b.severity])).rows[0];await append(db,req,c,row,'create');return row};return b.key?idempotent(db,req,b.key,b,run):run()}));
});
operationIncidents.get('/incidents/:id',async(req,res)=>{
 const id=uuid.parse(req.params.id),row=(await accessibleIncidents(req,id))[0];
 const history=(await pool.query('SELECT h.*,u.name AS actor FROM incident_history h JOIN users u ON u.id=h.actor_id WHERE incident_id=$1 ORDER BY created_at',[id])).rows;
 const attachments=(await pool.query('SELECT id,created_at FROM incident_attachments WHERE incident_id=$1 ORDER BY created_at',[id])).rows;
 res.json({...row,history,attachments});
});
operationIncidents.post('/incidents/:id/transition',async(req,res)=>{
 const c=await requirePermission(req,'incidents.manage'),id=uuid.parse(req.params.id);
 const b=z.object({key:uuid,version:z.number().int().positive(),status,severity:severity.optional(),note:z.string().trim().min(3).max(4000)}).strict().parse(req.body);
 res.json(await transaction(async db=>{const row=(await accessibleIncidents(req,id,db,true))[0];return idempotent(db,req,b.key,b,async()=>{
  if(row.version!==b.version)throw new ApiError(409,'stale_version');
  const next:Record<string,string[]>={open:['investigating'],investigating:['resolved','open'],resolved:['closed','investigating'],closed:['open']};
  if(b.status!==row.status&&!next[row.status].includes(b.status)||b.status===row.status&&(!b.severity||b.severity===row.severity))throw new ApiError(409,'invalid_transition');
  const result=(await db.query('UPDATE incidents SET status=$2,severity=$3,version=version+1 WHERE id=$1 RETURNING *',[id,b.status,b.severity??row.severity])).rows[0];
  await append(db,req,c,result,b.status===row.status?'severity_changed':'status_changed',b.note);return result;
 })}));
});
