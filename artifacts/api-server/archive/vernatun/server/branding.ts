import {Router,raw} from 'express';
import {z} from 'zod';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import {context,contexts,requireAuth,requirePermission,ApiError} from './access.js';
import {transaction,record} from './operations.js';
import {saveAndCommitPrivateFile,readPrivateFile} from './private-files.js';
import {storageStatus} from './storage-providers.js';
export const branding=Router();branding.use(requireAuth);
branding.get('/storage/status',async(_req,res)=>res.json(storageStatus()));
const url=z.string().url().max(500).refine(v=>{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password},'HTTPS only');
const fields=z.object({brand_name:z.string().trim().min(1).max(80).nullable().optional(),primary_color:z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),accent_color:z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),support_email:z.string().email().max(200).nullable().optional(),support_phone:z.string().trim().max(50).nullable().optional(),website_url:url.nullable().optional(),privacy_url:url.nullable().optional(),terms_url:url.nullable().optional()}).strict();
const version=z.coerce.number().int().min(0);
async function scope(req:any,write=false){const c=write?await requirePermission(req,'organization.settings'):await context(req);if(!c.organization_id)throw new ApiError(403,'organization_required');return c}
async function row(db:any,id:string,v?:number){const r=(await db.query('SELECT web_branding,branding_version FROM organizations WHERE id=$1'+(v===undefined?'':' FOR UPDATE'),[id])).rows[0];if(!r)throw new ApiError(404,'not_found');if(v!==undefined&&r.branding_version!==v)throw new ApiError(409,'version_conflict');return r}
const result=(r:any,canManage:boolean)=>({branding:r.web_branding,version:r.branding_version,canManage});
branding.get('/organization/branding',async(req,res)=>{const c=await scope(req);res.json(result(await row(pool,c.organization_id!),c.permissions.includes('organization.settings')))});
branding.put('/organization/branding',async(req,res)=>{const c=await scope(req,true),f=z.object({version,branding:fields}).strict().parse(req.body);
 res.json(await transaction(async db=>{const old=await row(db,c.organization_id!,f.version);
 const r=(await db.query('UPDATE organizations SET web_branding=$2,branding_version=branding_version+1 WHERE id=$1 RETURNING web_branding,branding_version',[c.organization_id,JSON.stringify({...f.branding,...(old.web_branding.logo_key?{logo_key:old.web_branding.logo_key}:{})})])).rows[0];
 await record(db,req,c,'branding.updated','organization',c.organization_id!);return result(r,true)}));
});
branding.post('/organization/branding/logo',raw({type:()=>true,limit:'2mb'}),async(req,res)=>{const c=await scope(req,true),v=version.parse(req.query.version);
 if(!Buffer.isBuffer(req.body)||!req.body.length)throw new ApiError(400,'invalid_image');
 let bytes:Buffer;try{
  const meta=await sharp(req.body,{limitInputPixels:16000000}).metadata();
  if(!['png','jpeg','webp'].includes(meta.format??''))throw new Error('raster_only');
  bytes=await sharp(req.body,{limitInputPixels:16000000}).rotate().resize({width:1000,height:500,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:90}).toBuffer();
 }catch{throw new ApiError(400,'invalid_image')}
 // Stale version rejected before a byte write; successful write+metadata under the same lock.
 await row(pool,c.organization_id!,v);
 const key=randomUUID()+'.jpg';
 res.json(await saveAndCommitPrivateFile('photos',key,bytes,'image/jpeg',async db=>{
  const old=await row(db,c.organization_id!,v),r=(await db.query('UPDATE organizations SET web_branding=$2,branding_version=branding_version+1 WHERE id=$1 RETURNING web_branding,branding_version',[c.organization_id,JSON.stringify({...old.web_branding,logo_key:key})])).rows[0];
  await record(db,req,c,'branding.logo_updated','organization',c.organization_id!);return result(r,true);
 }));
});
branding.delete('/organization/branding/logo',async(req,res)=>{const c=await scope(req,true),v=version.parse(req.query.version);res.json(await transaction(async db=>{
 await row(db,c.organization_id!,v);const r=(await db.query("UPDATE organizations SET web_branding=web_branding-'logo_key',branding_version=branding_version+1 WHERE id=$1 RETURNING web_branding,branding_version",[c.organization_id])).rows[0];
 await record(db,req,c,'branding.logo_removed','organization',c.organization_id!);return result(r,true);
}))});
branding.get('/organizations/:id/branding/logo',async(req,res)=>{const id=z.string().uuid().parse(req.params.id);
 if(!(await contexts(req.user!.id)).some(c=>c.organization_id===id))throw new ApiError(403,'forbidden');
 const r=await row(pool,id),key=r.web_branding.logo_key;
 if(!key||req.query.key!==key)throw new ApiError(404,'not_found');
 res.set({'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(await readPrivateFile('photos',key));
});
