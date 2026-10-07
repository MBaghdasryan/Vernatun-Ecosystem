import {Router,raw} from 'express';
import {z} from 'zod';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import {requireAuth,requirePermission,ApiError} from './access.js';
import {readableDocument} from './documents.js';
import {saveAndCommitPrivateFile,readPrivateFile} from './private-files.js';
import {idempotent,record} from './operations.js';
import {uuid,hash} from './finance-shared.js';
export const documentVersions=Router();documentVersions.use(requireAuth);
export async function sanitizeDocument(body:unknown){
 if(!Buffer.isBuffer(body)||!body.length)throw new ApiError(400,'invalid_file');
 if(body.subarray(0,5).equals(Buffer.from('%PDF-')))return {body,mediaType:'application/pdf'};
 try{const img=sharp(body,{limitInputPixels:16000000,failOn:'warning'}),meta=await img.metadata();
 if(!['png','jpeg','webp'].includes(meta.format??'')||(meta.pages??1)>1)throw new Error();
 return {body:await img.rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer(),mediaType:'image/jpeg'};
 }catch{throw new ApiError(400,'invalid_file')}
}
documentVersions.get('/documents/:id/versions',async(req,res)=>{
 const id=uuid.parse(req.params.id),c=await requirePermission(req,'documents.read');await readableDocument(req,id);
 const staff=c.permissions.includes('documents.manage');
 res.json((await pool.query(`SELECT id,version_number,previous_version_id,title,category,related_type,related_id,visibility,uploaded_by,uploaded_at,media_type
 FROM document_versions WHERE document_id=$1 AND ($2 OR (visibility='residents' AND $3) OR (visibility='unit_owner' AND $4))
 ORDER BY version_number DESC`,[id,staff,!!c.unit_id,c.role_key==='unit_owner'])).rows);
});
documentVersions.get('/documents/:id/versions/:versionId/download',async(req,res)=>{
 const id=uuid.parse(req.params.id),vid=uuid.parse(req.params.versionId),c=await requirePermission(req,'documents.read');
 const doc=(await readableDocument(req,id))[0],v=(await pool.query('SELECT * FROM document_versions WHERE id=$1 AND document_id=$2',[vid,id])).rows[0];
 if(!v||(!c.permissions.includes('documents.manage')&&!(v.visibility==='residents'&&c.unit_id)&&!(v.visibility==='unit_owner'&&c.role_key==='unit_owner'&&doc.unit_id===c.unit_id)))throw new ApiError(404,'not_found');
 const bytes=await readPrivateFile('documents',v.storage_key);
 res.set({'Content-Type':v.media_type,'Content-Disposition':`attachment; filename="vernatun-v${v.version_number}.${v.media_type==='application/pdf'?'pdf':'jpg'}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(bytes);
});
documentVersions.post('/documents/:id/versions',raw({type:'application/octet-stream',limit:'6mb'}),async(req,res)=>{
 const id=uuid.parse(req.params.id),c=await requirePermission(req,'documents.manage');await readableDocument(req,id);
 const b=z.object({key:uuid,version:z.coerce.number().int().positive(),title:z.string().trim().min(2).max(160),category:z.string().trim().min(2).max(100),visibility:z.enum(['staff','residents','unit_owner']),relatedType:z.enum(['building','unit','meeting']).optional(),relatedId:uuid.optional()}).strict().parse(req.query);
 if(!!b.relatedType!==!!b.relatedId)throw new ApiError(400,'invalid_reference');
 const file=await sanitizeDocument(req.body),key=randomUUID(),fingerprint={...b,bodyHash:hash(file.body.toString('base64'))};
 const r=await saveAndCommitPrivateFile('documents',key,file.body,file.mediaType,db=>idempotent(db,req,b.key,fingerprint,async()=>{
 const doc=(await db.query('SELECT * FROM documents WHERE id=$1 AND organization_id=$2 AND ($3::uuid IS NULL OR building_id=$3) FOR UPDATE',[id,c.organization_id,c.building_id])).rows[0];
 if(!doc)throw new ApiError(404,'not_found');if(doc.version!==b.version)throw new ApiError(409,'stale_version');
 if(b.visibility==='unit_owner'&&!doc.unit_id)throw new ApiError(400,'unit_required');
 if(b.relatedType==='building'&&b.relatedId!==doc.building_id)throw new ApiError(400,'invalid_reference');
 if(b.relatedType==='unit'&&!(await db.query('SELECT id FROM units WHERE id=$1 AND building_id=$2 AND organization_id=$3 AND ($4::uuid IS NULL OR id=$4)',[b.relatedId,doc.building_id,c.organization_id,doc.unit_id])).rowCount)throw new ApiError(400,'invalid_reference');
 if(b.relatedType==='meeting'&&!(await db.query('SELECT id FROM meetings WHERE id=$1 AND building_id=$2 AND organization_id=$3',[b.relatedId,doc.building_id,c.organization_id])).rowCount)throw new ApiError(400,'invalid_reference');
 const next=doc.version+1,v=(await db.query(`INSERT INTO document_versions(document_id,version_number,previous_version_id,storage_key,media_type,title,category,related_type,related_id,visibility,uploaded_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,version_number,previous_version_id,title,category,related_type,related_id,visibility,uploaded_by,uploaded_at`,
 [id,next,doc.latest_version_id,key,file.mediaType,b.title,b.category,b.relatedType??null,b.relatedId??null,b.visibility,req.user!.id])).rows[0];
 await db.query('UPDATE documents SET storage_key=$2,media_type=$3,title=$4,category=$5,related_type=$6,related_id=$7,visibility=$8,version=$9,latest_version_id=$10 WHERE id=$1',[id,key,file.mediaType,b.title,b.category,b.relatedType??null,b.relatedId??null,b.visibility,next,v.id]);
 await record(db,req,c,'document.version','document',id,{versionId:v.id,previousVersionId:doc.latest_version_id,version:next});return v;
 }));
 res.status(201).json(r);
});
