import {accessibleDefects} from './field.js';
import {Router,raw} from 'express';
import sharp from 'sharp';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool} from './db.js';
import {config} from './config.js';
import {ApiError,requireAuth} from './access.js';
import {accessibleRequests} from './workflow.js';
export const photos=Router();photos.use(requireAuth);
const root=resolve(config.NODE_ENV==='test'?'.local/test/private-photos':'.local/private-photos');
photos.post('/requests/:id/photos',raw({type:'application/octet-stream',limit:'6mb'}),async(req,res)=>{const id=z.string().uuid().parse(req.params.id);const r=(await accessibleRequests(req,id))[0];if(r.status==='closed')throw new ApiError(409,'invalid_transition');if(!Buffer.isBuffer(req.body)||!req.body.length)throw new ApiError(400,'invalid_photo');const buffer=await sanitizePhoto(req.body);await mkdir(root,{recursive:true,mode:0o700});const key=randomUUID()+'.jpg';await writeFile(resolve(root,key),buffer,{flag:'wx',mode:0o600});try{const result=await pool.query('INSERT INTO request_photos(request_id,author_id,storage_key) VALUES($1,$2,$3) RETURNING id',[id,req.user!.id,key]);res.status(201).json(result.rows[0])}catch(e){await unlink(resolve(root,key));throw e}});
photos.get('/photos/:id',async(req,res)=>{const row=(await pool.query('SELECT * FROM request_photos WHERE id=$1',[z.string().uuid().parse(req.params.id)])).rows[0];if(!row)throw new ApiError(404,'not_found');await accessibleRequests(req,row.request_id);res.set({'Content-Type':'image/jpeg','Content-Disposition':'attachment; filename="vernatun-photo.jpg"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.sendFile(resolve(root,row.storage_key),{dotfiles:'allow'})});

async function sanitizePhoto(body:Buffer){let buffer:Buffer;try{const image=sharp(body,{limitInputPixels:16000000,failOn:'warning'});const meta=await image.metadata();if(!['jpeg','png','webp'].includes(meta.format??'')||(meta.pages??1)>1)throw new Error();buffer=await image.rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer()}catch{throw new ApiError(400,'invalid_photo')}return buffer;}

photos.post('/defects/:id/photos',raw({type:'application/octet-stream',limit:'6mb'}),async(req,res)=>{const id=z.string().uuid().parse(req.params.id);const d=(await accessibleDefects(req,id))[0];if(d.status==='accepted')throw new ApiError(409,'invalid_transition');if(!Buffer.isBuffer(req.body)||!req.body.length)throw new ApiError(400,'invalid_photo');const buffer=await sanitizePhoto(req.body);await mkdir(root,{recursive:true,mode:0o700});const key=randomUUID()+'.jpg';await writeFile(resolve(root,key),buffer,{flag:'wx',mode:0o600});try{res.status(201).json((await pool.query('INSERT INTO file_attachments(defect_id,author_id,storage_key) VALUES($1,$2,$3) RETURNING id',[id,req.user!.id,key])).rows[0])}catch(e){await unlink(resolve(root,key));throw e}});
photos.get('/defect-photos/:id',async(req,res)=>{const row=(await pool.query('SELECT * FROM file_attachments WHERE id=$1',[z.string().uuid().parse(req.params.id)])).rows[0];if(!row)throw new ApiError(404,'not_found');await accessibleDefects(req,row.defect_id);res.set({'Content-Type':'image/jpeg','Content-Disposition':'attachment; filename="vernatun-defect.jpg"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).sendFile(resolve(root,row.storage_key),{dotfiles:'allow'})});
