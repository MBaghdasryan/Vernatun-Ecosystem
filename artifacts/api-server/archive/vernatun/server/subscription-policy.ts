import type {Pool,PoolClient} from 'pg';
import {pool} from './db.js';

export const moduleKeys=['requests','finance','handover','access','community','maintenance','meters','documents'] as const;
export type ModuleKey=typeof moduleKeys[number];
export type SubscriptionPolicy={
 enforced:boolean;state:string;readOnly:boolean;grace:boolean;modules:string[];
 subscriptionId:string|null;buildingLimit:number|null;
 overrides:{module:string;enabled:boolean;override_state:string;override_reason:string;effective:boolean}[];
};
export async function subscriptionPolicy(org:string,db:Pool|PoolClient=pool):Promise<SubscriptionPolicy>{
 const organization=(await db.query('SELECT subscription_enforced FROM organizations WHERE id=$1',[org])).rows[0];
 const entries=(await db.query('SELECT module,enabled,override_state,override_reason FROM module_entitlements WHERE organization_id=$1 ORDER BY module',[org])).rows;
 const subscription=(await db.query(`SELECT s.*,p.allowed_modules,p.building_limit,
  s.starts_on<=(now() AT TIME ZONE 'Asia/Yerevan')::date AS started,
  s.ends_on>=(now() AT TIME ZONE 'Asia/Yerevan')::date AS within_dates,
  s.grace_until>now() AS within_grace
  FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id WHERE s.organization_id=$1
  ORDER BY (s.starts_on<=(now() AT TIME ZONE 'Asia/Yerevan')::date) DESC,s.starts_on DESC,s.created_at DESC,s.id DESC LIMIT 1`,[org])).rows[0];
 const enforced=organization?.subscription_enforced===true;
 let state=subscription?.status??'none';
 if(enforced&&subscription){
  if(!subscription.started)state='not_started';
  else if(!subscription.within_dates&&['active','trial','past_due'].includes(state))state='expired';
  else if(state==='paused')state='suspended';
 }
 const grace=enforced&&state==='past_due'&&subscription?.within_grace===true;
 const readOnly=enforced&&!(['active','trial'].includes(state)||grace);
 const allowed=new Set<string>(subscription?.allowed_modules??[]);
 const overrides=entries.map(e=>({...e,effective:e.override_state==='enabled'||
  (e.override_state!=='disabled'&&e.enabled&&(!enforced||allowed.has(e.module)))}));
 return {enforced,state:enforced?state:'legacy',grace,readOnly,modules:overrides.filter(e=>e.effective).map(e=>e.module),
  subscriptionId:subscription?.id??null,buildingLimit:subscription?.building_limit??null,overrides};
}

export async function platformHousekeeping(){
 await pool.query('SELECT expire_support_grants(NULL)');
 await pool.query(`WITH expired AS (
  UPDATE subscriptions s SET status='expired',updated_at=now()
  FROM organizations o WHERE o.id=s.organization_id AND o.subscription_enforced
   AND s.status IN ('trial','active','past_due') AND s.ends_on<(now() AT TIME ZONE 'Asia/Yerevan')::date
  RETURNING s.id,s.organization_id
 ) INSERT INTO audit_events(organization_id,action,entity_type,entity_id,details)
 SELECT organization_id,'subscription.expire','subscription',id::text,'{"result":"success"}'::jsonb FROM expired`);
}
