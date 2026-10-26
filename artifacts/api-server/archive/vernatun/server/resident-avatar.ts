import {Router,raw} from 'express';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import {ApiError,requireAuth} from './access.js';
import {transaction,record} from './operations.js';
import {readPrivateFile,savePrivateFile,privateFileLockKey} from './private-files.js';
import {ownScope} from './resident-continuity-store.js';
import {writable} from './resident-policy.js';
export const residentAvatar=Router();residentAvatar.use(requireAuth);
residentAvatar.get('/avatar',async(req,res)=>{
 await ownScope(req);
 const r=(await pool.query('SELECT storage_key FROM resident_avatars WHERE user_id=$1 AND active',[req.user!.id])).rows[0];
 if(!r)throw new ApiError(404,'not_found');
 res.set({'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})
  .send(await readPrivateFile('photos',r.storage_key));
});
residentAvatar.put('/avatar',raw({type:['application/octet-stream','image/jpeg','image/png','image/webp'],limit:'6mb'}),async(req,res)=>{
 const s=await ownScope(req);writable(s);
 if(!Buffer.isBuffer(req.body)||!req.body.length)throw new ApiError(400,'invalid_image');
 let bytes:Buffer;try{
  const image=sharp(req.body,{limitInputPixels:16000000,animated:false});
  const metadata=await image.metadata();
  if(!['jpeg','png','webp'].includes(metadata.format??'')||(metadata.pages??1)>1)throw new Error('Unsupported image');
  bytes=await image.rotate().resize(512,512,{fit:'cover',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:85}).toBuffer();
 }catch{throw new ApiError(400,'invalid_image');}
 const key=randomUUID()+'.jpg';
 await transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['resident-avatar:'+req.user!.id]);
  if(Number((await db.query("SELECT count(*) FROM resident_avatars WHERE user_id=$1 AND created_at>now()-interval '1 hour'",[req.user!.id])).rows[0].count)>=5)throw new ApiError(429,'rate_limited');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[privateFileLockKey('photos',key)]);
  await savePrivateFile('photos',key,bytes,'image/jpeg');
  await db.query('UPDATE resident_avatars SET active=false WHERE user_id=$1 AND active',[req.user!.id]);
  const r=(await db.query('INSERT INTO resident_avatars(user_id,storage_key) VALUES($1,$2) RETURNING id',[req.user!.id,key])).rows[0];
  await record(db,req,s.c,'resident.avatar.update','resident_avatar',r.id);
 });
 res.status(204).end();
});
residentAvatar.delete('/avatar',async(req,res)=>{
 const s=await ownScope(req);writable(s);
 await transaction(async db=>{
  const r=(await db.query('UPDATE resident_avatars SET active=false WHERE user_id=$1 AND active RETURNING id',[req.user!.id])).rows[0];
  if(r)await record(db,req,s.c,'resident.avatar.remove','resident_avatar',r.id);
 });res.status(204).end();
});
