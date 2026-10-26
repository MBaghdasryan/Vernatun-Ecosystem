import {Router} from 'express';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,requireAuth,requirePermission} from './access.js';
import {record,transaction} from './operations.js';
import {activeLeasePredicate} from './lease-policy.js';
import {actionsFor,adminOnlyKinds,assertEnabled,payloadSchemas,publicRecord,readRecord,residentKinds,residentScope,writable,type ResidentKind} from './resident-policy.js';
import {notifyResidentViewing} from './resident-viewing-notifications.js';

export const residentRecords=Router();
residentRecords.use(requireAuth);
const id=z.string().uuid();
const sessionRef=(sid:string)=>createHash('sha256').update(sid).digest('hex');
residentRecords.get('/records/:kind',async(req,res)=>{
 const s=await residentScope(req),kind=residentKinds.parse(req.params.kind);assertEnabled(s,kind);
 const search=z.string().trim().max(200).parse(req.query.search??'');
 const recordId=req.query.recordId===undefined?null:id.parse(req.query.recordId);
 const offerType=z.enum(['all','sale','rent']).parse(req.query.offerType??'all');
 if(kind==='mobile-devices'){
  const devices=(await pool.query(`SELECT * FROM resident_product_records WHERE kind='mobile-devices'
   AND owner_user_id=$1 AND deleted_at IS NULL AND ($2='' OR strpos(lower(title),lower($2))>0)
   AND ($3::uuid IS NULL OR id=$3)
   ORDER BY updated_at DESC,id LIMIT 101`,[req.user!.id,search,recordId])).rows;
  res.json({items:devices.slice(0,100).map(r=>publicRecord(r,s,req.user!.id)),hasMore:devices.length>100});return;
 }
 if(kind==='directory'){
  // Directory is opt-in, omits identity fields not explicitly made visible,
  // and never exposes expired leases or delegated assignments.
  const rows=(await pool.query(`SELECT DISTINCT u.id,u.name,p.phone,p.show_unit,p.show_phone,p.allow_messages,n.number
   FROM users u JOIN resident_profiles p ON p.user_id=u.id JOIN role_assignments a ON a.user_id=u.id
   JOIN memberships m ON m.user_id=u.id AND m.organization_id=a.organization_id JOIN units n ON n.id=a.unit_id
   WHERE a.organization_id=$1 AND a.building_id=$2 AND a.role_key IN('unit_owner','renter','family')
   AND a.active AND a.starts_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now())
   AND m.active AND NOT u.blocked AND p.show_name AND ${activeLeasePredicate('a')}
   AND NOT EXISTS(SELECT 1 FROM resident_delegations d WHERE d.assignment_id=a.id)
   AND ($3='' OR strpos(lower(u.name),lower($3))>0)
   AND ($4::uuid IS NULL OR u.id=$4) ORDER BY u.name,u.id LIMIT 101`,[s.organizationId,s.buildingId,search,recordId])).rows;
  res.json({items:rows.slice(0,100).map(r=>({id:r.id,kind,title:r.name,body:r.show_unit?r.number:'',status:'active',version:1,createdAt:'',own:r.id===req.user!.id,actions:[],
   data:{phone:r.show_phone?r.phone:undefined,allowMessages:r.allow_messages}})),hasMore:rows.length>100});return;
 }
 const filters=kind==='listings'?z.object({
  saleType:z.enum(['sale','rent']).optional(),currency:z.enum(['AMD','RUB','USD']).optional(),
  minPrice:z.string().regex(/^\d{1,14}$/).optional(),maxPrice:z.string().regex(/^\d{1,14}$/).optional(),
  rooms:z.coerce.number().int().min(0).max(100).optional(),
 }).parse(req.query):{};
 if((filters.minPrice||filters.maxPrice)&&!filters.currency)throw new ApiError(400,'currency_required');
 if(filters.minPrice&&filters.maxPrice&&BigInt(filters.minPrice)>BigInt(filters.maxPrice))throw new ApiError(400,'validation_error');
 const rows=(await pool.query(`SELECT r.*,
  ARRAY(SELECT p.id FROM resident_listing_photos p WHERE p.listing_id=r.id ORDER BY p.created_at,p.id) AS photos,
  EXISTS(SELECT 1 FROM resident_record_marks m WHERE m.record_id=r.id AND m.user_id=$6 AND m.mark='accepted')
   AND NOT EXISTS(SELECT 1 FROM resident_record_marks m WHERE m.record_id=r.id AND m.user_id=$6 AND m.mark='withdrawn') AS accepted,
  EXISTS(SELECT 1 FROM resident_record_marks m WHERE m.record_id=r.id AND m.user_id=$6 AND m.mark='saved') AS saved,
  EXISTS(SELECT 1 FROM resident_record_marks m WHERE m.record_id=r.id AND m.user_id=$6 AND m.mark='supported') AS supported,
  (SELECT count(*) FROM resident_record_marks m WHERE m.record_id=r.id AND m.mark='supported') AS support_count
  FROM resident_product_records r WHERE organization_id=$1 AND building_id=$2 AND kind=$3 AND deleted_at IS NULL
  AND ($4 OR (r.owner_user_id=$6 AND (r.unit_id IS NULL OR r.unit_id=$5)) OR
   (r.kind='conversations' AND EXISTS(SELECT 1 FROM resident_product_records p WHERE p.id=r.parent_id
     AND p.kind='listings' AND p.owner_user_id=$6 AND p.unit_id=$5 AND p.deleted_at IS NULL)) OR
   (r.kind IN('contacts','agreements','services','help') AND r.status='active') OR
   (r.kind='discussions' AND r.status IN('open','closed','frozen')) OR (r.kind='listings' AND r.status='active'))
  AND ($7='' OR strpos(lower(r.title||' '||r.body),lower($7))>0)
  AND (r.kind<>'help' OR $4 OR r.data->>'category'=$8)
  AND (r.kind<>'conversations' OR r.parent_id IS NULL OR $4 OR $9)
  AND ($10::text IS NULL OR r.data->>'saleType'=$10)
  AND ($11::text IS NULL OR r.data->>'currency'=$11)
  AND ($12::numeric IS NULL OR (r.data->>'priceMinor')::numeric >= $12)
  AND ($13::numeric IS NULL OR (r.data->>'priceMinor')::numeric <= $13)
  AND ($14::text IS NULL OR r.data->>'rooms'=$14)
  AND ($15::uuid IS NULL OR r.id=$15)
  AND ($16='all' OR (r.kind='listings' AND r.data->>'saleType'=$16))
  ORDER BY created_at DESC,id LIMIT 101`,[s.organizationId,s.buildingId,kind,s.administrative,s.unitId,req.user!.id,search,req.user!.locale,
   s.settings.marketplace,filters.saleType??null,filters.currency??null,filters.minPrice??null,filters.maxPrice??null,filters.rooms?.toString()??null,recordId,offerType])).rows;
 res.json({items:rows.slice(0,100).map(r=>publicRecord(r,s,req.user!.id)),hasMore:rows.length>100});
});

residentRecords.get('/records/:kind/:id',async(req,res)=>{
 const s=await residentScope(req),kind=residentKinds.parse(req.params.kind);assertEnabled(s,kind);
 res.json(await transaction(async db=>publicRecord(await readRecord(db,s,kind,id.parse(req.params.id),req.user!.id),s,req.user!.id)));
});

residentRecords.post('/records/:kind',async(req,res)=>{
 const s=await residentScope(req),kind=residentKinds.parse(req.params.kind);assertEnabled(s,kind);writable(s);
 if(kind==='directory')throw new ApiError(405,'method_not_allowed');
 if(adminOnlyKinds.includes(kind)!==s.administrative)throw new ApiError(403,'forbidden');
 if(kind==='listings'&&s.c.role_key!=='unit_owner')throw new ApiError(403,'forbidden');
 const input=payloadSchemas[kind].parse(req.body),{title,body,version:_,...data}=input;
 if('mandatory' in data&&'withdrawable' in data&&data.mandatory&&data.withdrawable)throw new ApiError(400,'validation_error');
 const created=await transaction(async db=>{
  let parentId='parentId' in data?data.parentId:null,listingOwnerId:string|null=null;
  if(kind==='subscriptions'){
   const service=await readRecord(db,s,'services',parentId!,req.user!.id,true);
   if(service.status!=='active')throw new ApiError(409,'invalid_transition');
   // Snapshot an approved catalog price; never trust a client amount.
   Object.assign(data,{priceMinor:service.data.priceMinor,currency:service.data.currency,serviceTitle:service.title});
  }
  if(kind==='conversations'&&parentId){
   assertEnabled(s,'listings');
   const listing=await readRecord(db,s,'listings',parentId,req.user!.id,true);
   if(listing.status!=='active')throw new ApiError(409,'invalid_transition');
   if(listing.owner_user_id===req.user!.id)throw new ApiError(400,'validation_error');
   listingOwnerId=listing.owner_user_id;
   if('viewingAt' in data&&data.viewingAt){
    if(!('viewingConsent' in data)||data.viewingConsent!==true)throw new ApiError(400,'consent_required');
    const at=Date.parse(data.viewingAt);
    if(at<=Date.now()||at>Date.now()+366*86400000)throw new ApiError(400,'invalid_viewing_time');
    Object.assign(data,{viewingAt:new Date(at).toISOString(),viewingStatus:'requested'});
   }
  }
  if(kind==='conversations'&&'viewingAt' in data&&data.viewingAt&&!parentId)throw new ApiError(400,'validation_error');
  if(kind==='mobile-devices'){
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`resident-installation:${req.user!.id}:${'installationId' in data?data.installationId:''}`]);
   const prior=(await db.query(`SELECT * FROM resident_product_records WHERE owner_user_id=$1 AND kind=$2
    AND data->>'installationId'=$3 AND deleted_at IS NULL AND status='active' FOR UPDATE`,
    [req.user!.id,kind,'installationId' in data?data.installationId:''])).rows[0];
   if(prior){
    // A physical installation belongs to the user, not the selected apartment.
    // Context switches never clone it or widen the device session's permissions.
    const updated=(await db.query(`UPDATE resident_product_records SET data=$2,title=$3,body=$4,session_ref=$5,
     version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,
     [prior.id,JSON.stringify(data),title,body,sessionRef(req.sessionID)])).rows[0];
    await record(db,req,s.c,'resident.mobile-devices.register','resident_record',prior.id);return updated;
   }
  }
  const status=kind==='listings'?'draft':kind==='subscriptions'?'requested':['discussions','conversations','feedback'].includes(kind)?'open':'active';
  const row=(await db.query(`INSERT INTO resident_product_records(organization_id,building_id,unit_id,kind,owner_user_id,title,body,data,status,parent_id,session_ref)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[s.organizationId,s.buildingId,s.unitId,kind,req.user!.id,title,body,JSON.stringify(data),status,parentId,
   kind==='mobile-devices'?sessionRef(req.sessionID):null])).rows[0];
  if(kind==='conversations'&&'viewingAt' in data&&data.viewingAt&&listingOwnerId){
   await notifyResidentViewing(db,listingOwnerId,s.organizationId,row.id,'viewing_requested');
  }
  await record(db,req,{...s.c,organization_id:s.organizationId},'resident.'+kind+'.create','resident_record',row.id);return row;
 });
 res.status(201).json(publicRecord(created,s,req.user!.id));
});

residentRecords.patch('/records/:kind/:id',async(req,res)=>{
 const s=await residentScope(req),kind=residentKinds.parse(req.params.kind);assertEnabled(s,kind);writable(s);
 if(kind==='directory')throw new ApiError(405,'method_not_allowed');
 const input=payloadSchemas[kind].parse(req.body);
 res.json(await transaction(async db=>{
  const row=await readRecord(db,s,kind,id.parse(req.params.id),req.user!.id,true);
  if(!actionsFor(row,s,req.user!.id).includes('edit'))throw new ApiError(403,'forbidden');
  if(row.version!==input.version)throw new ApiError(409,'stale_version');
  const {title,body,version:_,...data}=input;
  if(kind==='agreements'){
   if('mandatory' in data&&'withdrawable' in data&&data.mandatory&&data.withdrawable)throw new ApiError(400,'validation_error');
   await db.query("UPDATE resident_product_records SET status='superseded',version=version+1,updated_at=now() WHERE id=$1",[row.id]);
   const next=(await db.query(`INSERT INTO resident_product_records(organization_id,building_id,kind,owner_user_id,title,body,data,status,parent_id)
    VALUES($1,$2,'agreements',$3,$4,$5,$6,'active',$7) RETURNING *`,[s.organizationId,s.buildingId,req.user!.id,title,body,
    JSON.stringify({...data,agreementRevision:(row.data.agreementRevision??1)+1}),row.id])).rows[0];
   await record(db,req,{...s.c,organization_id:s.organizationId},'resident.agreement.version','resident_record',next.id,{previousId:row.id});
   return publicRecord(next,s,req.user!.id);
  }
  const next=(await db.query('UPDATE resident_product_records SET title=$2,body=$3,data=$4,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',
   [row.id,title,body,JSON.stringify(data)])).rows[0];
  await record(db,req,{...s.c,organization_id:s.organizationId},'resident.'+kind+'.update','resident_record',row.id);
  return publicRecord(next,s,req.user!.id);
 }));
});

residentRecords.delete('/records/:kind/:id',async(req,res)=>{
 const s=await residentScope(req),kind=residentKinds.parse(req.params.kind);assertEnabled(s,kind);writable(s);
 const version=z.coerce.number().int().positive().parse(req.query.version);let currentRevoked=false;
 await transaction(async db=>{
  const row=await readRecord(db,s,kind,id.parse(req.params.id),req.user!.id,true);
  if(!actionsFor(row,s,req.user!.id).includes('delete'))throw new ApiError(403,'forbidden');
  if(row.version!==version)throw new ApiError(409,'stale_version');
  await db.query("UPDATE resident_product_records SET status='revoked',deleted_at=now(),version=version+1,updated_at=now() WHERE id=$1",[row.id]);
  if(kind==='mobile-devices'&&row.session_ref){
   // Tombstone survives late session saves, as in the operations session guard.
   const sessions=await db.query(`SELECT sid,expire FROM session WHERE sess->'passport'->>'user'=$1
    AND encode(sha256(convert_to(sid,'UTF8')),'hex')=$2 FOR UPDATE`,[req.user!.id,row.session_ref]);
   for(const sess of sessions.rows){
    await db.query('INSERT INTO system_revoked_sessions(ref,expires_at) VALUES($1,$2) ON CONFLICT DO NOTHING',[row.session_ref,sess.expire]);
    await db.query('DELETE FROM session WHERE sid=$1',[sess.sid]);if(sess.sid===req.sessionID)currentRevoked=true;
   }
  }
  await record(db,req,{...s.c,organization_id:s.organizationId},'resident.'+kind+'.revoke','resident_record',row.id);
 });
 if(currentRevoked){await new Promise<void>((resolve,reject)=>req.session.destroy(err=>err?reject(err):resolve()));res.clearCookie('vernatun.sid')}
 res.status(204).end();
});
