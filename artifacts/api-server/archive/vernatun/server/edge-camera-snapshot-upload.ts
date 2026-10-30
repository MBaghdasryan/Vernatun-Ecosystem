import {createHash,timingSafeEqual} from 'node:crypto';
import express from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError} from './access.js';
import {transaction} from './operations.js';
import {privateFileExists,privateFileLockKey,readPrivateFile,savePrivateFile} from './private-files.js';
import {sanitizePhoto} from './photos.js';

export const edgeCameraSnapshotUpload=express.Router();
const uuid=z.string().uuid();
const snapshotRef=(commandId:string)=>`/api/edge/commands/${commandId}/snapshot`;

edgeCameraSnapshotUpload.put(
 '/camera-snapshots/:commandId',
 express.raw({type:'image/jpeg',limit:'6mb'}),
 async(req,res)=>{
  const commandId=uuid.parse(req.params.commandId);
  const authorization=req.get('authorization')??'';
  const token=authorization.startsWith('Bearer ')?authorization.slice(7):'';
  if(!token||token.length>256)throw new ApiError(401,'snapshot_upload_unauthorized');
  if(req.get('content-type')?.split(';',1)[0]?.trim().toLowerCase()!=='image/jpeg'
   ||!Buffer.isBuffer(req.body)||!req.body.length||!req.body.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff])))
   throw new ApiError(400,'invalid_snapshot');
  const image=await sanitizePhoto(req.body);
  const tokenHash=createHash('sha256').update(token).digest('hex');
  const result=await transaction(async db=>{
   const row=(await db.query(`SELECT command_id,capability,status,expires_at,source_context
    FROM edge_commands WHERE command_id=$1 FOR UPDATE`,[commandId])).rows[0];
   const snapshot=row?.source_context?.cameraSnapshot;
   if(!row||row.capability!=='CAMERA.SNAPSHOT'||!snapshot?.storageKey
    ||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\.jpg$/i.test(snapshot.storageKey))
    throw new ApiError(404,'snapshot_upload_not_found');
   const expected=Buffer.from(String(snapshot.tokenHash??''),'hex');
   const actual=Buffer.from(tokenHash,'hex');
   if(expected.length!==actual.length||!timingSafeEqual(expected,actual))
    throw new ApiError(401,'snapshot_upload_unauthorized');
   if(new Date(row.expires_at).getTime()<=Date.now()
    ||!snapshot.expiresAt||new Date(snapshot.expiresAt).getTime()<=Date.now())
    throw new ApiError(410,'snapshot_upload_expired');
   if(snapshot.uploadedAt)return {replayed:true};
   if(!['DELIVERED','ACKNOWLEDGED'].includes(row.status))
    throw new ApiError(409,'snapshot_command_not_active');
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [privateFileLockKey('photos',snapshot.storageKey)]);
   if(await privateFileExists('photos',snapshot.storageKey)){
    const previous=await readPrivateFile('photos',snapshot.storageKey);
    if(!createHash('sha256').update(previous).digest().equals(createHash('sha256').update(image).digest()))
     throw new ApiError(409,'snapshot_storage_conflict');
   }else{
    await savePrivateFile('photos',snapshot.storageKey,image,'image/jpeg');
   }
   await db.query(`UPDATE edge_commands
    SET source_context=jsonb_set(source_context,'{cameraSnapshot,uploadedAt}',to_jsonb(now()::text),true),
        updated_at=now()
    WHERE command_id=$1`,[commandId]);
   return {replayed:false};
  });
  res.status(result.replayed?200:201).json({status:'STORED',snapshotRef:snapshotRef(commandId)});
 },
);
