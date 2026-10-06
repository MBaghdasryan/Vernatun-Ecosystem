import {accessibleDefects} from './field.js';
import {Router,raw} from 'express';
import sharp from 'sharp';
import {savePrivateFile,privateFileLockKey,readPrivateFile} from './private-files.js';
import {randomUUID,createHash} from 'node:crypto';
import {transaction,idempotent} from './operations.js';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,requireAuth} from './access.js';
import {accessibleRequests} from './workflow.js';
export const photos=Router();photos.use(requireAuth);
photos.post('/requests/:id/photos',raw({type:'application/octet-stream',limit:'6mb'}),async(req,res)=>{res.status(201).json(await upload(req,'requests'))});
photos.get('/photos/:id',async(req,res)=>{const row=(await pool.query('SELECT * FROM request_photos WHERE id=$1',[z.string().uuid().parse(req.params.id)])).rows[0];if(!row)throw new ApiError(404,'not_found');await accessibleRequests(req,row.request_id);const body=await readPrivateFile('photos',row.storage_key);res.set({'Content-Type':'image/jpeg','Content-Disposition':'attachment; filename="vernatun-photo.jpg"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.send(body)});

async function sanitizePhoto(body:Buffer){let buffer:Buffer;try{const image=sharp(body,{limitInputPixels:16000000,failOn:'warning'});const meta=await image.metadata();if(!['jpeg','png','webp'].includes(meta.format??'')||(meta.pages??1)>1)throw new Error();buffer=await image.rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer()}catch{throw new ApiError(400,'invalid_photo')}return buffer;}

photos.post('/defects/:id/photos',raw({type:'application/octet-stream',limit:'6mb'}),async(req,res)=>{res.status(201).json(await upload(req,'defects'))});
photos.get('/defect-photos/:id',async(req,res)=>{const row=(await pool.query('SELECT * FROM file_attachments WHERE id=$1',[z.string().uuid().parse(req.params.id)])).rows[0];if(!row)throw new ApiError(404,'not_found');await accessibleDefects(req,row.defect_id);const body=await readPrivateFile('photos',row.storage_key);res.set({'Content-Type':'image/jpeg','Content-Disposition':'attachment; filename="vernatun-defect.jpg"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(body)});

async function upload(req:import('express').Request,kind:'requests'|'defects'){
 const id=z.string().uuid().parse(req.params.id);
 const operation=req.get('X-Operation-Key');
 if(operation)z.string().uuid().parse(operation);
 const version=req.get('X-Work-Version');
 const expected=version?z.coerce.number().int().positive().parse(version):undefined;
 if(!Buffer.isBuffer(req.body)||!req.body.length)throw new ApiError(400,'invalid_photo');
 const hash=createHash('sha256').update(req.body).digest('hex');
 return transaction(async db=>{
  // Authorization is checked even on replay. Row locks prevent a close/accept
  // transition racing a photo commit; the existing receipt table is reused.
  const row=(await (kind==='requests'?accessibleRequests(req,id,db,true):accessibleDefects(req,id,db)))[0];
  const run=async()=>{
   if(row.status===(kind==='requests'?'closed':'accepted'))throw new ApiError(409,'invalid_transition');
   if(expected!==undefined&&row.version!==expected)throw new ApiError(409,'stale_version');
   const buffer=await sanitizePhoto(req.body),key=randomUUID()+'.jpg';
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[privateFileLockKey('photos',key)]);
   await savePrivateFile('photos',key,buffer,'image/jpeg');
   const sql=kind==='requests'
    ?'INSERT INTO request_photos(request_id,author_id,storage_key) VALUES($1,$2,$3) RETURNING id'
    :'INSERT INTO file_attachments(defect_id,author_id,storage_key) VALUES($1,$2,$3) RETURNING id';
   return (await db.query(sql,[id,req.user!.id,key])).rows[0];
  };
  return operation?idempotent(db,req,operation,{kind,id,hash,version:expected},run):run();
 });
}
