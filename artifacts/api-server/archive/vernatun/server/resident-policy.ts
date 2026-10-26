import type {Request} from 'express';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,context,requirePermission,type Context} from './access.js';

export const residentKinds=z.enum(['vehicles','mobile-devices','agreements','contacts','directory','services','subscriptions','conversations','discussions','listings','help','feedback']);
export type ResidentKind=z.infer<typeof residentKinds>;
export const residentSettings=z.object({directory:z.boolean(),discussions:z.boolean(),chat:z.boolean(),marketplace:z.boolean(),services:z.boolean()}).strict();
export const defaults={directory:false,discussions:false,chat:false,marketplace:false,services:false};
export type ResidentScope={c:Context;organizationId:string;buildingId:string;unitId:string|null;administrative:boolean;settings:typeof defaults};

export async function residentScope(req:Request):Promise<ResidentScope>{
 const c=await context(req),administrative=c.shell!=='home';
 let buildingId=c.building_id,organizationId=c.organization_id;
 if(administrative){
  await requirePermission(req,c.organization_id?'organization.settings':'organizations.manage');
  buildingId=z.string().uuid().parse(req.query.buildingId);
  const row=(await pool.query(`SELECT organization_id FROM buildings WHERE id=$1 AND ($2::uuid IS NULL OR organization_id=$2)
   AND ($3::uuid IS NULL OR id=$3)`,[buildingId,c.organization_id,c.building_id])).rows[0];
  if(!row)throw new ApiError(404,'not_found');organizationId=row.organization_id;
 }else{
  if(!['unit_owner','renter','family'].includes(c.role_key)||!buildingId||!organizationId||!c.unit_id)throw new ApiError(403,'forbidden');
  if(req.query.buildingId&&req.query.buildingId!==buildingId)throw new ApiError(403,'forbidden');
  await requirePermission(req,'properties.own');
 }
 const row=(await pool.query('SELECT directory,discussions,chat,marketplace,services FROM resident_building_settings WHERE building_id=$1 AND organization_id=$2',[buildingId,organizationId])).rows[0];
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
 conversations:z.object({...common,parentId:z.string().uuid().optional()}).strict(),
 discussions:z.object({...common,category:text(80).min(1)}).strict(),
 listings:z.object({...common,saleType:z.enum(['sale','rent']),priceMinor:price,currency}).strict(),
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
  if(kind==='discussions')a.push(...(row.status==='open'?['close','freeze','proposal']:['reopen']));
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
   if(!own&&row.status==='active')a.push('inquire');
   if(own&&['draft','rejected'].includes(row.status))a.push('edit','submit','delete');
   if(own&&row.status==='active')a.push('close');
  }
 }
 if((kind==='conversations'||kind==='discussions')&&!['closed','frozen','rejected','draft','submitted'].includes(row.status))a.push('message');
 if(kind==='conversations'&&!s.administrative)a.push('read');
 return a;
}
export function publicRecord(row:any,s:ResidentScope,userId:string){
 const {pushToken:_,...data}=row.data??{};
 if(row.kind==='mobile-devices')data.pushRegistered=!!row.data?.pushToken;
 return {id:row.id,kind:row.kind,title:row.title,body:row.body,status:row.status,version:row.version,createdAt:new Date(row.created_at).toISOString(),
  own:row.owner_user_id===userId,data,actions:actionsFor(row,s,userId),linkedRequestId:row.linked_request_id??null,
  accepted:row.accepted??false,saved:row.saved??false,supported:row.supported??false,supportCount:Number(row.support_count??0)};
}
// Privacy predicates are identical for list, detail, actions and messages.
export async function readRecord(db:PoolClient,s:ResidentScope,kind:ResidentKind,id:string,userId:string,lock=false){
 if(kind==='mobile-devices'&&!s.administrative){
  const device=(await db.query(`SELECT * FROM resident_product_records WHERE id=$1 AND kind='mobile-devices'
   AND owner_user_id=$2 AND deleted_at IS NULL ${lock?'FOR UPDATE':''}`,[id,userId])).rows[0];
  if(!device)throw new ApiError(404,'not_found');return device;
 }
 const row=(await db.query(`SELECT r.* FROM resident_product_records r WHERE r.id=$1 AND r.organization_id=$2 AND r.building_id=$3
  AND r.kind=$4 AND r.deleted_at IS NULL AND
  ($5 OR (r.owner_user_id=$6 AND (r.unit_id IS NULL OR r.unit_id=$7)) OR
   (r.kind='conversations' AND EXISTS(SELECT 1 FROM resident_product_records p WHERE p.id=r.parent_id
     AND p.kind='listings' AND p.owner_user_id=$6 AND p.unit_id=$7 AND p.deleted_at IS NULL)) OR
   (r.kind IN('contacts','agreements','services','help') AND r.status='active') OR
   (r.kind='discussions' AND r.status IN('open','closed','frozen')) OR
   (r.kind='listings' AND r.status='active'))
  ${lock?'FOR UPDATE':''}`,[id,s.organizationId,s.buildingId,kind,s.administrative,userId,s.unitId])).rows[0];
 if(!row)throw new ApiError(404,'not_found');return row;
}
