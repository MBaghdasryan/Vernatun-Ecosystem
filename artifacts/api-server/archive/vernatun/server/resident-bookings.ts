import {Router} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,requireAuth,requirePermission} from './access.js';
import {transaction,record} from './operations.js';
import {residentScope,enabled,writable,readRecord} from './resident-policy.js';
import {ownScope,bookingColumns} from './resident-continuity-store.js';
import {prepareOperationalRequest,commitPreparedRequest,eligiblePeople} from './core-operation-store.js';
import {appendRequestHistory} from './workflow.js';
export const residentBookings=Router();residentBookings.use(requireAuth);
const uuid=z.string().uuid(),date=z.string().datetime({offset:true});
residentBookings.get('/service-bookings',async(req,res)=>{
 const s=await residentScope(req,'requests.assign');
 if(s.administrative)await requirePermission(req,'requests.assign');
 if(!s.administrative&&!enabled(s,'services'))throw new ApiError(403,'feature_disabled');
 res.json((await pool.query(`SELECT ${bookingColumns} FROM resident_service_bookings WHERE organization_id=$1 AND building_id=$2
  AND ($3 OR (user_id=$4 AND unit_id=$5)) ORDER BY created_at DESC,id LIMIT 100`,
  [s.organizationId,s.buildingId,s.administrative,req.user!.id,s.unitId])).rows);
});
residentBookings.post('/service-bookings',async(req,res)=>{
 const s=await ownScope(req);writable(s);await requirePermission(req,'requests.create');
 if(!enabled(s,'services'))throw new ApiError(403,'feature_disabled');
 const b=z.object({serviceId:uuid,startsAt:date,endsAt:date,note:z.string().trim().max(1000)}).strict().parse(req.body);
 const start=Date.parse(b.startsAt),end=Date.parse(b.endsAt);
 if(start<Date.now()+5*60000||start>Date.now()+180*86400000||end-start<15*60000||end-start>8*3600000)throw new ApiError(400,'invalid_dates');
 const service=await readRecord(pool,s,'services',b.serviceId,req.user!.id);
 if(service.status!=='active')throw new ApiError(409,'service_unavailable');
 res.status(201).json(await transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['resident-bookings:'+req.user!.id]);
  if((await db.query(`SELECT 1 FROM resident_service_bookings WHERE user_id=$1 AND service_id=$2
   AND status IN('requested','confirming','confirmed') AND starts_at<$4 AND ends_at>$3`,
   [req.user!.id,service.id,b.startsAt,b.endsAt])).rowCount)throw new ApiError(409,'booking_overlap');
  const r=(await db.query(`INSERT INTO resident_service_bookings(organization_id,building_id,unit_id,user_id,service_id,title,starts_at,ends_at,note)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${bookingColumns}`,
   [s.organizationId,s.buildingId,s.unitId,req.user!.id,service.id,service.title,b.startsAt,b.endsAt,b.note])).rows[0];
  await record(db,req,s.c,'resident.service_booking.request','resident_service_booking',r.id);return r;
 }));
});
residentBookings.put('/service-bookings/:id',async(req,res)=>{
 const s=await residentScope(req,'requests.assign');writable(s);
 const b=z.object({action:z.enum(['confirm','reject','cancel']),version:z.number().int().positive(),categoryId:uuid.optional(),technicianId:uuid.optional()}).strict().parse(req.body);
 if(b.action!=='cancel'||s.administrative)await requirePermission(req,'requests.assign');
 if(!s.administrative&&(!enabled(s,'services')||b.action!=='cancel'))throw new ApiError(403,'forbidden');
 const id=uuid.parse(req.params.id);
 const initial=(await pool.query(`SELECT * FROM resident_service_bookings WHERE id=$1 AND organization_id=$2 AND building_id=$3
  AND ($4 OR(user_id=$5 AND unit_id=$6))`,[id,s.organizationId,s.buildingId,s.administrative,req.user!.id,s.unitId])).rows[0];
 if(!initial)throw new ApiError(404,'not_found');
 if(b.action==='confirm'&&initial.status==='confirmed'&&initial.request_id){
  res.json((await pool.query(`SELECT ${bookingColumns} FROM resident_service_bookings WHERE id=$1`,[id])).rows[0]);return;
 }
 if(b.action==='confirm'&&(!b.categoryId||!b.technicianId))throw new ApiError(400,'category_and_technician_required');
 // Resolve authenticated context before acquiring a transaction connection.
 const prepared=b.action==='confirm'?await prepareOperationalRequest(req,{
  key:initial.request_key,unitId:initial.unit_id,subject:initial.title,description:initial.note,
  categoryId:b.categoryId,technicianId:b.technicianId,reportedForUserId:initial.user_id,
  preferredVisitStart:new Date(initial.starts_at).toISOString(),preferredVisitEnd:new Date(initial.ends_at).toISOString(),
 }):null;
 const row=await transaction(async db=>{
  const r=(await db.query(`SELECT * FROM resident_service_bookings WHERE id=$1 AND organization_id=$2 AND building_id=$3
   AND ($4 OR (user_id=$5 AND unit_id=$6)) FOR UPDATE`,[id,s.organizationId,s.buildingId,s.administrative,req.user!.id,s.unitId])).rows[0];
  if(!r)throw new ApiError(404,'not_found');
  if(b.action==='confirm'&&r.status==='confirmed'&&r.request_id)return r;
  if(r.version!==b.version)throw new ApiError(409,'stale_version');
  if(b.action!=='confirm'){
   // Once an operational request exists, cancel through its existing workflow.
   if(r.status!=='requested')throw new ApiError(409,'invalid_transition');
   await db.query('UPDATE resident_service_bookings SET status=$2,version=version+1 WHERE id=$1',[id,b.action==='reject'?'rejected':'cancelled']);
  }else{
   if(!b.categoryId)throw new ApiError(400,'category_required');
   if(!(await db.query('SELECT id FROM request_categories WHERE id=$1 AND organization_id=$2 AND active',[b.categoryId,s.organizationId])).rowCount)throw new ApiError(400,'invalid_category');
   if(!['requested','confirming'].includes(r.status)||Date.parse(r.starts_at)<=Date.now())throw new ApiError(409,'invalid_transition');
   if(r.status==='confirming'&&(r.confirmed_by!==req.user!.id||r.confirmed_category_id!==b.categoryId))throw new ApiError(409,'confirmation_in_progress');
   // Serialize a single-service capacity decision; no second pooled connection while holding the lock.
   await db.query('SELECT id FROM resident_product_records WHERE id=$1 FOR UPDATE',[r.service_id]);
   if((await db.query(`SELECT 1 FROM resident_service_bookings WHERE id<>$1 AND service_id=$2 AND status IN('confirming','confirmed')
    AND starts_at<$4 AND ends_at>$3`,[id,r.service_id,r.starts_at,r.ends_at])).rowCount)throw new ApiError(409,'booking_overlap');
   // Request, assigned work order, booking and audit commit together. A failed
   // eligibility/SLA/availability check leaves the slot requested, not stuck.
   const request=await commitPreparedRequest(db,req,prepared!,appendRequestHistory);
   await db.query(`UPDATE resident_service_bookings SET status='confirmed',confirmed_by=$2,confirmed_category_id=$3,
    request_id=$4,version=version+1 WHERE id=$1`,[id,req.user!.id,b.categoryId,request.id]);
  }
  await record(db,req,s.c,'resident.service_booking.'+b.action,'resident_service_booking',id);
  return (await db.query('SELECT * FROM resident_service_bookings WHERE id=$1',[id])).rows[0];
 });
 res.json((await pool.query(`SELECT ${bookingColumns} FROM resident_service_bookings WHERE id=$1`,[id])).rows[0]);
});
residentBookings.get('/service-bookings/:id/options',async(req,res)=>{
 const s=await residentScope(req,'requests.assign');await requirePermission(req,'requests.assign');
 const row=(await pool.query('SELECT unit_id FROM resident_service_bookings WHERE id=$1 AND organization_id=$2 AND building_id=$3',
  [uuid.parse(req.params.id),s.organizationId,s.buildingId])).rows[0];
 if(!row)throw new ApiError(404,'not_found');
 res.json({categories:(await pool.query('SELECT id,name FROM request_categories WHERE organization_id=$1 AND active ORDER BY name',[s.organizationId])).rows,
  technicians:await eligiblePeople(pool,s.organizationId,s.buildingId,row.unit_id,'technician')});
});
