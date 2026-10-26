import {Router} from 'express';
import {residentHomeSummary} from './resident-home.js';
import {z} from 'zod';
import {pool} from './db.js';
import {ApiError,contexts,requireAuth,requirePermission} from './access.js';
import {record,transaction,invoiceAmounts} from './operations.js';
import {defaults,enabled,residentKinds,residentScope,residentSettings,writable} from './resident-policy.js';

export const residentWorkspace=Router();
residentWorkspace.use(requireAuth);
const profileInput=z.object({
 name:z.string().trim().min(1).max(120),phone:z.union([z.literal(''),z.string().regex(/^\+?[0-9 ()-]{7,30}$/)]),
 language:z.enum(['hy','ru','en']),theme:z.enum(['system','light','dark']),preferredChannel:z.enum(['email','phone']),
 showName:z.boolean(),showUnit:z.boolean(),showPhone:z.boolean(),allowMessages:z.boolean(),
}).strict();

residentWorkspace.get('/admin/buildings',async(req,res)=>{
 const all=await contexts(req.user!.id),c=all.find(x=>x.id===req.session.contextId);
 if(!c||c.shell==='home')throw new ApiError(403,'forbidden');
 await requirePermission(req,c.organization_id?(c.permissions.includes('requests.assign')?'requests.assign':'organization.settings'):'organizations.manage');
 res.json((await pool.query(`SELECT b.id,b.name,o.name AS organization FROM buildings b JOIN organizations o ON o.id=b.organization_id
  WHERE ($1::uuid IS NULL OR b.organization_id=$1) AND ($2::uuid IS NULL OR b.id=$2) ORDER BY o.name,b.name,b.id LIMIT 500`,
  [c.organization_id,c.building_id])).rows);
});
residentWorkspace.put('/settings',async(req,res)=>{
 const s=await residentScope(req);if(!s.administrative)throw new ApiError(403,'forbidden');writable(s);
 const b=residentSettings.parse(req.body);
 await transaction(async db=>{
  await db.query(`INSERT INTO resident_building_settings(building_id,organization_id,directory,discussions,chat,marketplace,services,updated_by,activation_required,finance_transparency)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(building_id) DO UPDATE SET
   activation_required=excluded.activation_required,finance_transparency=excluded.finance_transparency,
   directory=excluded.directory,discussions=excluded.discussions,chat=excluded.chat,marketplace=excluded.marketplace,
   services=excluded.services,updated_by=excluded.updated_by,updated_at=now()`,
   [s.buildingId,s.organizationId,b.directory,b.discussions,b.chat,b.marketplace,b.services,req.user!.id,b.activationRequired,b.financeTransparency]);
  await record(db,req,{...s.c,organization_id:s.organizationId},'resident.settings.update','building',s.buildingId,{settings:b});
 });res.json(b);
});
residentWorkspace.put('/profile',async(req,res)=>{
 const s=await residentScope(req);if(s.administrative)throw new ApiError(403,'forbidden');writable(s);
 const b=profileInput.parse(req.body);
 await transaction(async db=>{
  // Email and verification flags deliberately cannot be modified here.
  await db.query('UPDATE users SET name=$2,locale=$3 WHERE id=$1',[req.user!.id,b.name,b.language]);
  await db.query(`INSERT INTO resident_profiles(user_id,phone,theme,preferred_channel,show_name,show_unit,show_phone,allow_messages)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,theme=excluded.theme,
   preferred_channel=excluded.preferred_channel,show_name=excluded.show_name,show_unit=excluded.show_unit,
   show_phone=excluded.show_phone,allow_messages=excluded.allow_messages,updated_at=now()`,
   [req.user!.id,b.phone,b.theme,b.preferredChannel,b.showName,b.showUnit,b.showPhone,b.allowMessages]);
  await record(db,req,s.c,'resident.profile.update','user',req.user!.id,{fields:Object.keys(b)});
 });res.json(b);
});
residentWorkspace.get('/workspace',async(req,res)=>{
 const s=await residentScope(req),user=req.user!;
 const building=(await pool.query(`SELECT b.id,b.name,b.address,o.name AS organization,o.timezone,
  u.number AS unit,u.area::text AS area FROM buildings b JOIN organizations o ON o.id=b.organization_id
  LEFT JOIN units u ON u.id=$3 AND u.organization_id=b.organization_id AND u.building_id=b.id
  WHERE b.id=$1 AND b.organization_id=$2`,[s.buildingId,s.organizationId,s.unitId])).rows[0];
 if(!building)throw new ApiError(404,'not_found');
 const p=(await pool.query(`SELECT p.*,u.name,u.locale FROM users u LEFT JOIN resident_profiles p ON p.user_id=u.id WHERE u.id=$1`,[user.id])).rows[0];
 const capabilities=Object.fromEntries(residentKinds.options.map(k=>[k,!!enabled(s,k)]));
 // Own invoice balances use the existing allocations/adjustments calculation.
 // No data is exposed to family/staff simply because this aggregate exists.
 const canFinance=!s.administrative&&s.c.permissions.includes('billing.own')&&s.c.modules?.includes('finance');
 let payableMinor:string|null=null,overdueMinor:string|null=null,annualPaidMinor:string|null=null;
 if(canFinance){
  await requirePermission(req,'billing.own');
  const totals=(await pool.query(`WITH own AS(SELECT i.period,${invoiceAmounts} FROM invoices i
   WHERE i.organization_id=$1 AND i.unit_id=$2 AND i.payer_user_id=$3 AND i.currency=$4 AND i.status='published')
   SELECT COALESCE(sum(greatest(balance_minor::bigint,0)),0)::text AS payable,
   COALESCE(sum(greatest(balance_minor::bigint,0)) FILTER(WHERE period<date_trunc('month',now() AT TIME ZONE $5)::date),0)::text AS overdue
   FROM own`,[s.organizationId,s.unitId,user.id,user.currency,building.timezone])).rows[0];
  payableMinor=totals.payable;overdueMinor=totals.overdue;
  // Payment dates, not invoice periods, define this year's payments.
  annualPaidMinor=(await pool.query(`SELECT COALESCE(sum(a.amount_minor),0)::text AS amount
   FROM payment_allocations a JOIN payments p ON p.id=a.payment_id AND p.organization_id=a.organization_id
   JOIN invoices i ON i.id=a.invoice_id AND i.organization_id=a.organization_id
   WHERE i.organization_id=$1 AND i.unit_id=$2 AND i.payer_user_id=$3 AND i.currency=$4
   AND p.created_at>=date_trunc('year',now() AT TIME ZONE $5) AT TIME ZONE $5`,
   [s.organizationId,s.unitId,user.id,user.currency,building.timezone])).rows[0].amount;
 }
 const unreadNotifications=s.administrative?null:Number((await pool.query(`SELECT count(*) FROM notifications WHERE user_id=$1
  AND organization_id=$2 AND read_at IS NULL AND in_app_enabled AND (visible_after IS NULL OR visible_after<=now())`,[user.id,s.organizationId])).rows[0].count);
 let openRequests:number|null=null;
 if(!s.administrative&&s.c.modules?.includes('requests')&&s.c.permissions.includes('requests.own')){
  await requirePermission(req,'requests.own');
  openRequests=Number((await pool.query(`SELECT count(*) FROM resident_requests WHERE organization_id=$1 AND unit_id=$2
   AND (author_user_id=$3 OR reported_for_user_id=$3 OR (reported_for_user_id IS NULL AND source IN('dispatcher_phone','manager','system')))
   AND status<>'closed'`,[s.organizationId,s.unitId,user.id])).rows[0].count);
 }
 res.json({contextId:s.c.id,administrative:s.administrative,building:{...building,role:s.c.role_key},profile:{
  name:p.name,phone:p.phone??'',language:p.locale,theme:p.theme??'system',preferredChannel:p.preferred_channel??'email',
  showName:p.show_name??false,showUnit:p.show_unit??false,showPhone:p.show_phone??false,allowMessages:p.allow_messages??false},
  settings:s.settings??defaults,capabilities,
  integrations:[
   {key:'propertyPayments',status:'CONTRACT_REQUIRED'},{key:'utilities',status:'CONTRACT_REQUIRED'},
   {key:'savedPaymentMethods',status:'UNSUPPORTED'},{key:'autopay',status:'UNSUPPORTED'},
   {key:'ble',status:'NOT_CONFIGURED'},{key:'intercom',status:'NOT_CONFIGURED'},
   {key:'cameras',status:'NOT_CONFIGURED'},{key:'biometrics',status:'NOT_CONFIGURED'},
   {key:'ai',status:'NOT_CONFIGURED'},{key:'push',status:'NOT_CONFIGURED'},
  ],home:{payableMinor,overdueMinor,annualPaidMinor,unreadNotifications,openRequests,currency:user.currency,
   summary:await residentHomeSummary(s,user.id,user.currency,!!canFinance)}});
});

export const residentContexts=Router();
residentContexts.get('/contexts',requireAuth,async(req,res)=>{
 const available=await contexts(req.user!.id);
 res.json(available.filter(c=>c.shell==='home').map(c=>({id:c.id,role:c.role_key,organization:c.organization_name??'',building:c.building_name??'',unit:c.unit_number??''})));
});
