import type {Request} from 'express';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,context,requirePermission,type Context} from './access.js';
import {canConvert} from './resident-conversion.js';

export const residentKinds=z.enum(['vehicles','mobile-devices','agreements','contacts','directory','services','subscriptions','conversations','discussions','listings','help','feedback']);
export type ResidentKind=z.infer<typeof residentKinds>;
export const residentSettings=z.object({directory:z.boolean(),discussions:z.boolean(),chat:z.boolean(),marketplace:z.boolean(),services:z.boolean(),
 activationRequired:z.boolean().default(false),financeTransparency:z.boolean().default(false)}).strict();
export const defaults={directory:false,discussions:false,chat:false,marketplace:false,services:false,activationRequired:false,financeTransparency:false};
export type ResidentScope={c:Context;organizationId:string;buildingId:string;unitId:string|null;administrative:boolean;settings:typeof defaults};

export async function residentScope(req:Request,operation:false|true|'requests.assign'=false):Promise<ResidentScope>{
 const c=await context(req),administrative=c.shell!=='home';
 let buildingId=c.building_id,organizationId=c.organization_id;
 if(administrative){
  if(operation===true&&c.organization_id&&!c.unit_id&&!c.permissions.includes('organization.settings')){
   // Operational staff can process discussions, not change resident settings,
   // inspect private conversations, or administer other resident records.
   if(!c.modules?.includes('community'))throw new ApiError(403,'module_disabled');
   await requirePermission(req,c.permissions.includes('meetings.manage')?'meetings.manage':'requests.assign');
  }else await requirePermission(req,operation==='requests.assign'?operation:c.organization_id?'organization.settings':'organizations.manage');
  buildingId=z.string().uuid().parse(req.query.buildingId);
  const row=(await pool.query(`SELECT organization_id FROM buildings WHERE id=$1 AND ($2::uuid IS NULL OR organization_id=$2)
   AND ($3::uuid IS NULL OR id=$3)`,[buildingId,c.organization_id,c.building_id])).rows[0];
  if(!row)throw new ApiError(404,'not_found');organizationId=row.organization_id;
 }else{
  if(!['unit_owner','renter','family'].includes(c.role_key)||!buildingId||!organizationId||!c.unit_id)throw new ApiError(403,'forbidden');
  if(req.query.buildingId&&req.query.buildingId!==buildingId)throw new ApiError(403,'forbidden');
  await requirePermission(req,'properties.own');
 }
 const row=(await pool.query('SELECT directory,discussions,chat,marketplace,services,activation_required AS "activationRequired",finance_transparency AS "financeTransparency" FROM resident_building_settings WHERE building_id=$1 AND organization_id=$2',[buildingId,organizationId])).rows[0];
 return {c,organizationId:organizationId!,buildingId:buildingId!,unitId:administrative?null:c.unit_id,administrative,settings:row??defaults};
}
export function enabled(s:ResidentScope,kind:ResidentKind){
 if(s.administrative)return !['directory','mobile-devices'].includes(kind);
 if(kind==='directory')return s.settings.directory&&s.c.modules?.includes('community');
 if(['discussions','conversations','listings'].includes(kind))return s.c.modules?.includes('community')&&
  (kind==='discussions'?s.settings.discussions:kind==='conversations'?s.settings.chat:s.settings.marketplace);
 if(['services','subscriptions'].includes(kind))return s.settings.services&&s.c.modules?.includes('requests')&&s.c.permissions.includes('requests.create');
 return true;
}
export function assertEnabled(s:ResidentScope,kind:ResidentKind){if(!enabled(s,kind))throw new ApiError(403,'module_disabled')}
export function writable(s:ResidentScope){
 if((s.c as Context&{subscription?:{readOnly:boolean}}).subscription?.readOnly)throw new ApiError(403,'subscription_read_only');
}
const common={title:z.string().trim().min(1).max(200),body:z.string().trim().max(5000),version:z.number().int().positive().optional()};
const text=(max:number)=>z.string().trim().max(max);
const price=z.string().regex(/^\d{1,14}$/);
const currency=z.enum(['AMD','RUB','USD']);
export const payloadSchemas={
 vehicles:z.object({...common,plate:text(24).min(1),country:z.string().regex(/^[A-Z]{2,3}$/),vehicleType:z.enum(['car','motorcycle','bicycle','other']),make:text(80).optional(),model:text(80).optional(),color:text(40).optional()}).strict(),
 'mobile-devices':z.object({...common,installationId:z.string().uuid(),platform:z.enum(['ios','android','web']),appVersion:text(40),osVersion:text(80),pushToken:text(4096).optional()}).strict(),
 agreements:z.object({...common,category:z.enum(['terms','privacy','management','hoa','marketing','notifications','ai','biometric']),mandatory:z.boolean(),withdrawable:z.boolean()}).strict(),
 contacts:z.object({...common,category:z.enum(['management','security','concierge','technician','cleaning','emergency','other']),phone:z.string().regex(/^\+?[0-9 ()-]{3,30}$/),email:z.union([z.string().email().max(254),z.literal('')]).optional(),hours:text(200).optional()}).strict(),
 services:z.object({...common,category:text(80).min(1),priceMinor:price,currency,mandatory:z.boolean().optional()}).strict(),
 subscriptions:z.object({...common,parentId:z.string().uuid(),quantity:z.number().int().min(1).max(1000)}).strict(),
 conversations:z.object({...common,parentId:z.string().uuid().optional(),viewingAt:z.string().datetime({offset:true}).optional(),viewingConsent:z.boolean().optional()}).strict(),
 discussions:z.object({...common,category:text(80).min(1)}).strict(),
 listings:z.object({...common,saleType:z.enum(['sale','rent']),priceMinor:price,currency,
  area:z.number().min(1).max(100000).optional(),rooms:z.number().int().min(0).max(100).optional(),floor:z.number().int().min(-10).max(300).optional(),
  latitude:z.number().finite().min(-90).max(90).optional(),longitude:z.number().finite().min(-180).max(180).optional()
 }).strict().refine(v=>(v.latitude===undefined)===(v.longitude===undefined),{message:'coordinates_pair_required'}),
 help:z.object({...common,category:z.enum(['hy','ru','en'])}).strict(),
 feedback:z.object({...common,category:z.enum(['idea','improvement','problem'])}).strict(),
};
export const sharedKinds=['contacts','agreements','services','discussions','listings','help'];
export const adminOnlyKinds=['contacts','agreements','services','help'];
export function actionsFor(row:any,s:ResidentScope,userId:string){
 const own=row.owner_user_id===userId,kind=row.kind as ResidentKind;
 const a:string[]=[];
 if(row.status==='revoked'||row.status==='ended')return a;
 if(s.administrative){
  if(adminOnlyKinds.includes(kind))a.push('edit','delete');
  if(kind==='subscriptions'&&row.status==='requested')a.push('approve','reject');
  if(kind==='subscriptions'&&['active','cancel_requested'].includes(row.status))a.push('cancel');
  if(kind==='discussions'){
   if(s.c.permissions.includes('organization.settings')||s.c.permissions.includes('organizations.manage'))
    a.push(...(row.status==='open'?['close','freeze']:['reopen']));
   if(row.status==='open'){
    if(!row.linked_request_id&&canConvert(s,'request'))a.push('request');
    if(!row.data.proposalConversion&&canConvert(s,'proposal'))a.push('proposal');
   }
  }
  if(kind==='listings'&&row.status==='submitted')a.push('approve','reject');
  if(kind==='listings'&&row.status==='active')a.push('close');
 }else{
  if(own&&['vehicles','mobile-devices','conversations','feedback'].includes(kind))a.push('delete');
  if(own&&kind==='vehicles')a.push('edit');
  if(kind==='agreements'){a.push('accept');if(row.data.withdrawable)a.push('withdraw')}
  if(kind==='services'&&row.status==='active')a.push('subscribe');
  if(own&&kind==='subscriptions'&&['requested','active'].includes(row.status))a.push('cancel');
  if(kind==='discussions'&&row.status==='open')a.push('support','unsupport','report');
  if(kind==='listings'){
   a.push('save','unsave','report');
   if(!own&&row.status==='active'&&enabled(s,'conversations'))a.push('inquire');
   if(own&&s.c.role_key==='unit_owner'&&['draft','rejected'].includes(row.status))a.push('edit','submit','delete');
   if(own&&s.c.role_key==='unit_owner'&&row.status==='active')a.push('close');
  }
 }
 if((kind==='conversations'||kind==='discussions')&&!['closed','frozen','rejected','draft','submitted'].includes(row.status)&&
  (!s.administrative||s.c.permissions.includes('organization.settings')||s.c.permissions.includes('organizations.manage')))a.push('message');
 if(kind==='conversations'&&row.parent_id&&s.settings.marketplace&&row.status==='open'){
  if(own&&['requested','confirmed'].includes(row.data.viewingStatus))a.push('cancel_viewing');
  if(!own&&!s.administrative&&s.c.role_key==='unit_owner'&&row.data.viewingStatus==='requested')a.push('confirm_viewing','decline_viewing');
 }
 if(kind==='conversations'&&!s.administrative)a.push('read');
 return a;
}
export function validListingCoordinates(data:any):data is {latitude:number;longitude:number}{
 return typeof data?.latitude==='number'&&typeof data?.longitude==='number'&&
  Number.isFinite(data.latitude)&&Number.isFinite(data.longitude)&&
  Math.abs(data.latitude)<=90&&Math.abs(data.longitude)<=180;
}
// Match governance's draft visibility boundary in every record serializer,
// including lists and responses to unrelated resident actions.
export const publishedProposalSql=`EXISTS(SELECT 1 FROM agenda_items pa JOIN meetings pm ON pm.id=pa.meeting_id
 WHERE pa.source_discussion_id=r.id AND pm.organization_id=r.organization_id
 AND pm.building_id=r.building_id AND pm.mode='weighted' AND pm.was_published) AS proposal_visible`;
export function publicRecord(row:any,s:ResidentScope,userId:string){
 const {pushToken:_,...data}=row.data??{};
 const own=row.owner_user_id===userId;
 if(row.kind==='listings'){
  const storedStatus=['pending','verified','rejected'].includes(row.location_verification_status)
   ?row.location_verification_status:'pending';
  const verified=storedStatus==='verified'&&validListingCoordinates(data);
  data.locationVerificationStatus=verified?'verified':storedStatus==='rejected'?'rejected':'pending';
  if(!s.administrative&&!own&&!verified){delete data.latitude;delete data.longitude;}
 }
 // Idempotency inputs belong to staff, not to the public discussion payload.
 for(const k of ['requestConversion','proposalConversion']){
  if(data[k])data[k]={id:data[k].id,...(data[k].meetingId?{meetingId:data[k].meetingId}:{})};
 }
 if(!s.c.modules?.includes('community')||!s.c.permissions.includes('meetings.read')||
  (!s.c.permissions.includes('meetings.manage')&&!row.proposal_visible))delete data.proposalConversion;
 if(row.kind==='mobile-devices')data.pushRegistered=!!row.data?.pushToken;
 return {id:row.id,kind:row.kind,title:row.title,body:row.body,status:row.status,version:row.version,createdAt:new Date(row.created_at).toISOString(),
  own,data,actions:actionsFor(row,s,userId),linkedRequestId:row.linked_request_id??null,
  accepted:row.accepted??false,saved:row.saved??false,supported:row.supported??false,supportCount:Number(row.support_count??0),
  ...(row.kind==='listings'?{photos:row.photos??[]}: {})};
}
// Privacy predicates are identical for list, detail, actions and messages.
export async function readRecord(db:PoolClient|typeof pool,s:ResidentScope,kind:ResidentKind,id:string,userId:string,lock=false){
 if(kind==='mobile-devices'&&!s.administrative){
  const device=(await db.query(`SELECT * FROM resident_product_records WHERE id=$1 AND kind='mobile-devices'
   AND owner_user_id=$2 AND deleted_at IS NULL ${lock?'FOR UPDATE':''}`,[id,userId])).rows[0];
  if(!device)throw new ApiError(404,'not_found');return device;
 }
 const row=(await db.query(`SELECT r.*,${publishedProposalSql},
  ARRAY(SELECT p.id FROM resident_listing_photos p WHERE p.listing_id=r.id ORDER BY p.created_at,p.id) AS photos
  FROM resident_product_records r WHERE r.id=$1 AND r.organization_id=$2 AND r.building_id=$3
  AND r.kind=$4 AND r.deleted_at IS NULL AND
  (r.kind<>'conversations' OR r.parent_id IS NULL OR $8)
  AND
  ($5 OR (r.owner_user_id=$6 AND (r.unit_id IS NULL OR r.unit_id=$7)) OR
   (r.kind='conversations' AND EXISTS(SELECT 1 FROM resident_product_records p WHERE p.id=r.parent_id
     AND p.kind='listings' AND p.owner_user_id=$6 AND p.unit_id=$7 AND p.deleted_at IS NULL)) OR
   (r.kind IN('contacts','agreements','services','help') AND r.status='active') OR
   (r.kind='discussions' AND r.status IN('open','closed','frozen')) OR
   (r.kind='listings' AND r.status='active'))
  ${lock?'FOR UPDATE OF r':''}`,[id,s.organizationId,s.buildingId,kind,s.administrative,userId,s.unitId,s.settings.marketplace||s.administrative])).rows[0];
 if(!row)throw new ApiError(404,'not_found');return row;
}
