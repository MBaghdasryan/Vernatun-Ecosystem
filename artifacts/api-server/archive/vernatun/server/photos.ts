import {accessibleDefects} from './field.js';
import {Router,raw} from 'express';
import sharp from 'sharp';
import {saveAndCommitPrivateFile,readPrivateFile} from './private-files.js';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,requireAuth} from './access.js';
import {accessibleRequests} from './workflow.js';
export const photos=Router();photos.use(requireAuth);
photos.post('/requests/:id/photos',raw({type:'application/octet-stream',limit:'6mb'}),async(req,res)=>{const id=z.string().uuid().parse(req.params.id);const r=(await accessibleRequests(req,id))[0];if(r.status==='closed')throw new ApiError(409,'invalid_transition');if(!Buffer.isBuffer(req.body)||!req.body.length)throw new ApiError(400,'invalid_photo');const buffer=await sanitizePhoto(req.body);const key=randomUUID()+'.jpg';const result=await saveAndCommitPrivateFile('photos',key,buffer,'image/jpeg',async db=>(await db.query('INSERT INTO request_photos(request_id,author_id,storage_key) VALUES($1,$2,$3) RETURNING id',[id,req.user!.id,key])).rows[0]);res.status(201).json(result)});
photos.get('/photos/:id',async(req,res)=>{const row=(await pool.query('SELECT * FROM request_photos WHERE id=$1',[z.string().uuid().parse(req.params.id)])).rows[0];if(!row)throw new ApiError(404,'not_found');await accessibleRequests(req,row.request_id);const body=await readPrivateFile('photos',row.storage_key);res.set({'Content-Type':'image/jpeg','Content-Disposition':'attachment; filename="vernatun-photo.jpg"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.send(body)});

async function sanitizePhoto(body:Buffer){let buffer:Buffer;try{const image=sharp(body,{limitInputPixels:16000000,failOn:'warning'});const meta=await image.metadata();if(!['jpeg','png','webp'].includes(meta.format??'')||(meta.pages??1)>1)throw new Error();buffer=await image.rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer()}catch{throw new ApiError(400,'invalid_photo')}return buffer;}

photos.post('/defects/:id/photos',raw({type:'application/octet-stream',limit:'6mb'}),async(req,res)=>{const id=z.string().uuid().parse(req.params.id);const d=(await accessibleDefects(req,id))[0];if(d.status==='accepted')throw new ApiError(409,'invalid_transition');if(!Buffer.isBuffer(req.body)||!req.body.length)throw new ApiError(400,'invalid_photo');const buffer=await sanitizePhoto(req.body);const key=randomUUID()+'.jpg';const result=await saveAndCommitPrivateFile('photos',key,buffer,'image/jpeg',async db=>(await db.query('INSERT INTO file_attachments(defect_id,author_id,storage_key) VALUES($1,$2,$3) RETURNING id',[id,req.user!.id,key])).rows[0]);res.status(201).json(result)});
photos.get('/defect-photos/:id',async(req,res)=>{const row=(await pool.query('SELECT * FROM file_attachments WHERE id=$1',[z.string().uuid().parse(req.params.id)])).rows[0];if(!row)throw new ApiError(404,'not_found');await accessibleDefects(req,row.defect_id);const body=await readPrivateFile('photos',row.storage_key);res.set({'Content-Type':'image/jpeg','Content-Disposition':'attachment; filename="vernatun-defect.jpg"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(body)});
