import {Router} from 'express';
import {z} from 'zod';
import {pool} from './db.js';
import {context,requireAuth} from './access.js';
import {moduleForPermission} from './roles.js';
import {KPI_QUERIES,KPI_REGISTRY,type KpiKey} from './kpi-registry.js';
export const insights=Router();insights.use(requireAuth);

insights.get('/role-insights',async(req,res)=>{
 const c=await context(req);
 const currency=z.enum(['AMD','RUB','USD']).parse(req.query.currency??req.user!.currency);
 const period=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().parse(req.query.period);
 const mods=new Set(c.modules??[]);
 const can=(p:string)=>p.split(' OR ').some(permission=>{
  const mod=moduleForPermission(permission);
  return c.permissions.includes(permission)&&(!mod||mods.has(mod));
 });
 const cards:any[]=[];
 const scope=[c.organization_id,c.building_id,c.unit_id];
 const add=async(key:KpiKey,args:unknown[]=[],options:{queryId?:keyof typeof KPI_QUERIES;permission?:string;scope?:string;column?:string;invoiceCount?:number}={})=>{
  const definition=KPI_REGISTRY[key];
  const queryId=options.queryId??definition.queryId;
  const row=(await pool.query(KPI_QUERIES[queryId],args)).rows[0];
  const dataState=options.invoiceCount===0?'no_data':'measured';
  cards.push({
   key,value:String(row[options.column??'value']??'0'),
   ...(key==='charged'||key==='paid'||key==='balance'?{currency}:{}),
   definition:definition.definition,queryId,permission:options.permission??definition.permission,
   module:definition.module,scope:options.scope??definition.scope,dataState,
   noDataBehavior:definition.noDataBehavior
  });
 };
 if(can('organizations.read')){
  await add('organizations');await add('buildings');await add('activeSubscriptions');
  await add('openSupport',[],{queryId:'platform.open_support',scope:'platform',permission:'organizations.read'});
 }else if(can('support.cases')){
  await add('openSupport',[req.user!.id],{queryId:'support.assigned_open',scope:'authenticated_operator',permission:'support.cases'});
 }
 if(can('people.read'))await add('team',scope);
 if(can('properties.read')||can('properties.own'))await add('units',scope,{permission:c.permissions.includes('properties.read')?'properties.read':'properties.own'});
 if(can('support.access.request'))await add('activeGrants',[req.user!.id]);
 if(can('onboarding.manage'))await add('onboardingRemaining',[can('organizations.read'),req.user!.id],{
  scope:can('organizations.read')?'platform':'assigned_to_authenticated_operator'
 });
 if(can('people.invite'))await add('pendingInvites',scope);
 if(can('requests.read')||can('requests.own'))await add('openRequests',[...scope,can('requests.read'),req.user!.id],{
  permission:can('requests.read')?'requests.read':'requests.own'
 });
 if(can('workorders.assigned'))await add('assignedWork',[...scope,req.user!.id]);
 if(can('defects.read')||can('defects.assigned')){
  const args=[...scope,can('defects.read'),req.user!.id];
  const permission=can('defects.read')?'defects.read':'defects.assigned';
  await add('openDefects',args,{permission});await add('reviewDefects',args,{permission});
 }
 if(can('handover.read'))await add('handoverReady',scope);
 if(can('access.validate')||can('access.create'))await add('validPasses',[...scope,can('access.validate'),req.user!.id],{
  permission:can('access.validate')?'access.validate':'access.create'
 });
 if(can('billing.read')||can('billing.own')){
  const permission=can('billing.read')?'billing.read':'billing.own';
  const financeScope=can('billing.read')?'organization_building_unit':'organization_building_unit_and_authenticated_payer';
  const args=[...scope,can('billing.read'),req.user!.id,currency,period?period+'-01':null];
  const query=(await pool.query(KPI_QUERIES['finance.published_invoice_totals'],args)).rows[0];
  const invoiceCount=Number(query.invoice_count);
  for(const key of ['charged','paid','balance'] as const){
   const definition=KPI_REGISTRY[key];
   cards.push({key,value:String(query[key]),currency,definition:definition.definition,
    queryId:definition.queryId,permission,module:definition.module,scope:financeScope,
    dataState:invoiceCount===0?'no_data':'measured',noDataBehavior:definition.noDataBehavior});
  }
 }
 res.json({cards});
});
