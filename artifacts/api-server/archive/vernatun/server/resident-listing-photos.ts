import {Router,raw} from 'express';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ApiError,requireAuth} from './access.js';
import {record,transaction} from './operations.js';
import {actionsFor,assertEnabled,publicRecord,readRecord,residentScope,writable} from './resident-policy.js';
import {sanitizePhoto} from './photos.js';
import {privateFileLockKey,readPrivateFile,savePrivateFile} from './private-files.js';

export const residentListingPhotos=Router();
residentListingPhotos.use(requireAuth);
const uuid=z.string().uuid();
residentListingPhotos.post('/listings/:id/photos',raw({type:'application/octet-stream',limit:'6mb'}),async(req,res)=>{
 const s=await residentScope(req);assertEnabled(s,'listings');writable(s);
 const id=uuid.parse(req.params.id),version=z.coerce.number().int().positive().parse(req.query.version);
 if(!Buffer.isBuffer(req.body)||!req.body.length)throw new ApiError(400,'invalid_photo');
 res.status(201).json(await transaction(async db=>{
  const row=await readRecord(db,s,'listings',id,req.user!.id,true);
  if(!actionsFor(row,s,req.user!.id).includes('edit'))throw new ApiError(403,'forbidden');
  if(row.version!==version)throw new ApiError(409,'stale_version');
  if(row.photos.length>=10)throw new ApiError(409,'photo_limit');
  const buffer=await sanitizePhoto(req.body),key=randomUUID()+'.jpg';
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[privateFileLockKey('photos',key)]);
  await savePrivateFile('photos',key,buffer,'image/jpeg');
  const photo=(await db.query('INSERT INTO resident_listing_photos(listing_id,storage_key) VALUES($1,$2) RETURNING id',[id,key])).rows[0];
  await db.query('UPDATE resident_product_records SET version=version+1,updated_at=now() WHERE id=$1',[id]);
  await record(db,req,s.c,'resident.listings.photo.add','resident_record',id,{photoId:photo.id});
  return publicRecord(await readRecord(db,s,'listings',id,req.user!.id),s,req.user!.id);
 }));
});
residentListingPhotos.get('/listings/:id/photos/:photoId',async(req,res)=>{
 const s=await residentScope(req);assertEnabled(s,'listings');
 const body=await transaction(async db=>{
  const row=await readRecord(db,s,'listings',uuid.parse(req.params.id),req.user!.id);
  const photo=(await db.query('SELECT storage_key FROM resident_listing_photos WHERE id=$1 AND listing_id=$2',[uuid.parse(req.params.photoId),row.id])).rows[0];
  if(!photo)throw new ApiError(404,'not_found');
  return readPrivateFile('photos',photo.storage_key);
 });
 res.set({'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline; filename="listing.jpg"'}).send(body);
});
residentListingPhotos.delete('/listings/:id/photos/:photoId',async(req,res)=>{
 const s=await residentScope(req);assertEnabled(s,'listings');writable(s);
 const id=uuid.parse(req.params.id),photoId=uuid.parse(req.params.photoId),version=z.coerce.number().int().positive().parse(req.query.version);
 res.json(await transaction(async db=>{
  const row=await readRecord(db,s,'listings',id,req.user!.id,true);
  if(!actionsFor(row,s,req.user!.id).includes('edit'))throw new ApiError(403,'forbidden');
  if(row.version!==version)throw new ApiError(409,'stale_version');
  if(!(await db.query('DELETE FROM resident_listing_photos WHERE id=$1 AND listing_id=$2',[photoId,id])).rowCount)throw new ApiError(404,'not_found');
  // Detached bytes remain for the reviewed inventory/grace-period cleanup.
  await db.query('UPDATE resident_product_records SET version=version+1,updated_at=now() WHERE id=$1',[id]);
  await record(db,req,s.c,'resident.listings.photo.remove','resident_record',id,{photoId});
  return publicRecord(await readRecord(db,s,'listings',id,req.user!.id),s,req.user!.id);
 }));
});
