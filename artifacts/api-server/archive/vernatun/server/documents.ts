import {Router,raw,type Request} from 'express';
import {saveAndCommitPrivateFile,readPrivateFile} from './private-files.js';
import {randomUUID} from 'node:crypto';
import {idempotent} from './operations.js';
import {hash} from './finance-shared.js';
import sharp from 'sharp';
import {z} from 'zod';
import {pool} from './db.js';
import {requireAuth,requirePermission,scopedUnit,ApiError} from './access.js';
import {building} from './services.js';
import {record} from './operations.js';
export const documents=Router();documents.use(requireAuth);
export async function readableDocument(req:Request,id?:string){const c=await requirePermission(req,'documents.read');const staff=c.permissions.includes('documents.manage');const r=await pool.query(`SELECT id,title,visibility,created_at,media_type,storage_key,category,related_type,related_id,version,latest_version_id,building_id,unit_id FROM documents WHERE organization_id=$1 AND ($2::uuid IS NULL OR building_id=$2) AND ($3::uuid IS NULL OR unit_id IS NULL OR unit_id=$3) AND ($4::uuid IS NULL OR id=$4) AND ($5::boolean OR (visibility='residents' AND $6::boolean) OR (visibility='unit_owner' AND unit_id=$3 AND $7::boolean)) ORDER BY created_at DESC`,[c.organization_id,c.building_id,c.unit_id,id??null,staff,c.unit_id!==null,c.role_key==='unit_owner']);if(id&&!r.rowCount)throw new ApiError(404,'not_found');return r.rows}
documents.get('/documents',async(req,res)=>res.json((await readableDocument(req)).map(({storage_key,...r})=>r)));
documents.get('/documents/:id/download',async(req,res)=>{const r=(await readableDocument(req,z.string().uuid().parse(req.params.id)))[0];const body=await readPrivateFile('documents',r.storage_key);res.set({'Content-Type':r.media_type,'Content-Disposition':`attachment; filename="vernatun-document.${r.media_type==='application/pdf'?'pdf':'jpg'}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(body)});
documents.post('/documents',raw({type:'application/octet-stream',limit:'6mb'}),async(req,res)=>{
 const c=await requirePermission(req,'documents.manage'),q=z.object({key:z.string().uuid().optional(),title:z.string().trim().min(2).max(160),buildingId:z.string().uuid(),unitId:z.string().uuid().optional(),visibility:z.enum(['staff','residents','unit_owner']),category:z.string().trim().min(2).max(100).default('general'),relatedType:z.enum(['building','unit','meeting']).optional(),relatedId:z.string().uuid().optional()}).strict().parse(req.query);
 await building(c,q.buildingId);if(q.unitId){const u=await scopedUnit(c,q.unitId);if(u.building_id!==q.buildingId)throw new ApiError(404,'not_found')}
 if(q.visibility==='unit_owner'&&!q.unitId)throw new ApiError(400,'unit_required');if(!!q.relatedType!==!!q.relatedId)throw new ApiError(400,'invalid_reference');
 if(q.relatedType==='building'&&q.relatedId!==q.buildingId)throw new ApiError(400,'invalid_reference');
 if(q.relatedType==='unit'){const u=await scopedUnit(c,q.relatedId!);if(u.building_id!==q.buildingId||(q.unitId&&q.unitId!==u.id))throw new ApiError(400,'invalid_reference')}
 if(q.relatedType==='meeting'&&!(await pool.query('SELECT id FROM meetings WHERE id=$1 AND organization_id=$2 AND building_id=$3',[q.relatedId,c.organization_id,q.buildingId])).rowCount)throw new ApiError(400,'invalid_reference');
 if(!Buffer.isBuffer(req.body)||!req.body.length)throw new ApiError(400,'invalid_file');let body:Buffer=req.body,mediaType='application/pdf';
 if(!body.subarray(0,5).equals(Buffer.from('%PDF-'))){try{const image=sharp(body,{limitInputPixels:16000000,failOn:'warning'}),meta=await image.metadata();if(!['png','jpeg','webp'].includes(meta.format??'')||(meta.pages??1)>1)throw new Error();body=await image.rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();mediaType='image/jpeg'}catch{throw new ApiError(400,'invalid_file')}}
 const storageKey=randomUUID(),result=await saveAndCommitPrivateFile('documents',storageKey,body,mediaType,async db=>{
 const run=async()=>{
 const r=(await db.query('INSERT INTO documents(organization_id,building_id,unit_id,title,visibility,storage_key,media_type,uploaded_by,category,related_type,related_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',[c.organization_id,q.buildingId,q.unitId??null,q.title,q.visibility,storageKey,mediaType,req.user!.id,q.category,q.relatedType??null,q.relatedId??null])).rows[0];
 await record(db,req,c,'document.upload','document',r.id);return r};
 return q.key?idempotent(db,req,q.key,{...q,bodyHash:hash(body.toString('base64'))},run):run();
 });res.status(201).json(result);
});
