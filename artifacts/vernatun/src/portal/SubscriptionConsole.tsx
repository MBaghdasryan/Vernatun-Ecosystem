import {useState,useEffect,useCallback,useRef,type FormEvent} from 'react';
import {request} from './client';
import {ct} from './console-i18n';
import {errText,toMinor,fromMinor,fmtDate,yerevanInput,yerevanInstant} from './console-util';
import type {Language,Currency} from './i18n';
import type {RoleContext} from './types';
import './console.css';
type Row=Record<string,any>;
const STATUSES=['trial','active','past_due','suspended','cancelled','expired'];
export default function SubscriptionConsole({c,language,currency}:{c:RoleContext;language:Language;currency:Currency}){
 const t=(k:string)=>ct(language,k);
 const allowed=c.permissions.includes('subscriptions.manage');
 const [data,setData]=useState<Row>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [org,setOrg]=useState(''),[policy,setPolicy]=useState<Row>(),[subId,setSubId]=useState(''),[planId,setPlanId]=useState('');
 const [mods,setMods]=useState<string[]>([]);
 const load=useCallback(async()=>{try{const d=await request<Row>('/subscriptions');setData(d);setError('')}catch(e){setError(errText(language,e))}},[language]);
 const currentOrg=useRef(org);currentOrg.current=org;const policySequence=useRef(0);
 const loadPolicy=useCallback(async(id:string)=>{if(currentOrg.current!==id)return;const ticket=++policySequence.current;setPolicy(undefined);if(!id)return;try{const result=await request<Row>('/organizations/'+id+'/subscription-policy');if(currentOrg.current===id&&ticket===policySequence.current)setPolicy(result)}catch(e){if(currentOrg.current===id&&ticket===policySequence.current){setPolicy(undefined);setError(errText(language,e))}}},[language]);
 useEffect(()=>{if(allowed)void load()},[allowed,load,c.id]);
 useEffect(()=>{void loadPolicy(org)},[org,loadPolicy,c.id]);
 if(!allowed)return <p role="alert" className="p-error">{t('denied')}</p>;
 if(!data)return <div className="cx-wrap">{error?<><p role="alert" className="p-error">{error}</p><button className="p-button" onClick={()=>void load()}>{t('retry')}</button></>:<p role="status">{t('loading')}</p>}</div>;
 const plans:Row[]=data.plans??[],subs:Row[]=data.subscriptions??[],orgs:Row[]=data.organizations??[],keys:string[]=data.moduleKeys??[];
 const plan=plans.find(p=>p.id===planId),sub=subs.find(s=>s.id===subId);
  async function run(fn:()=>Promise<unknown>,after?:()=>void){if(busy)return;setBusy(true);setError('');try{await fn();await load();await loadPolicy(currentOrg.current);after?.()}catch(e){setError(errText(language,e))}finally{setBusy(false)}}
 function pickPlan(id:string){setPlanId(id);const p=plans.find(x=>x.id===id);setMods(p?[...p.allowed_modules]:[])}
 const f=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();return new FormData(e.currentTarget)};
 function savePlan(e:FormEvent<HTMLFormElement>){const d=f(e);let amountMinor:string;try{amountMinor=toMinor(String(d.get('amount')))}catch{setError(t('error'));return}
  const body:Row={name:d.get('name'),amountMinor,currency:d.get('currency'),buildingLimit:Number(d.get('buildingLimit')),allowedModules:mods,graceDays:Number(d.get('graceDays'))};
  if(plan)void run(()=>request('/subscription-plans/'+plan.id,'PATCH',{...body,reason:d.get('reason')}),()=>pickPlan(''));else void run(()=>request('/subscription-plans','POST',body),()=>setMods([]))}
 function createSub(e:FormEvent<HTMLFormElement>){const d=f(e);const oid=String(d.get('organizationId'));
  void run(()=>request('/subscriptions','POST',{organizationId:oid,planId:d.get('planId'),startsOn:d.get('startsOn'),endsOn:d.get('endsOn'),status:d.get('status')}),()=>setOrg(oid))}
 function updateSub(e:FormEvent<HTMLFormElement>){const d=f(e);if(!sub)return;const g=String(d.get('graceUntil')||'');
  const body:Row={status:d.get('status'),reason:d.get('reason')};if(g)body.graceUntil=yerevanInstant(g);else if(sub.grace_until)body.graceUntil=null;
  void run(()=>request('/subscriptions/'+sub.id,'PATCH',body),()=>setSubId(''))}
 const closed=sub&&['cancelled','expired'].includes(sub.status);
 return <div className="p-business cx-wrap">
  <div className="cx-row"><button className="p-button" disabled={busy} onClick={()=>{void load();void loadPolicy(org)}}>{t('refresh')}</button></div>
  {error&&<p role="alert" className="p-error">{error}</p>}
  <section className="p-card"><h3>{t('plans')}</h3><div className="cx-scroll"><table className="cx-table"><thead><tr><th>{t('name')}</th><th>{t('amount')}</th><th>{t('buildingLimit')}</th><th>{t('modules')}</th><th>{t('graceDays')}</th><th/></tr></thead><tbody>
  {plans.map(p=><tr key={p.id} aria-selected={p.id===planId}><td>{p.name}</td><td>{fromMinor(p.amount_minor)} {p.currency}</td><td>{p.building_limit}</td><td>{p.allowed_modules.join(', ')}</td><td>{p.grace_days}</td><td><button className="p-button" onClick={()=>pickPlan(p.id)}>{t('edit')}</button></td></tr>)}
  {!plans.length&&<tr><td colSpan={6}>{t('empty')}</td></tr>}</tbody></table></div></section>
  <div className="cx-grid">
  <form key={planId||'new'} className="p-card p-edit-form cx-form" onSubmit={savePlan}><h3>{plan?t('edit')+': '+plan.name:t('plan')}</h3>
   <label>{t('name')}<input name="name" required maxLength={120} defaultValue={plan?.name}/></label>
   <label>{t('amount')}<input name="amount" required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" defaultValue={plan?fromMinor(plan.amount_minor):''}/></label>
   <label>{t('currency')}<select name="currency" defaultValue={plan?.currency??currency}>{['AMD','RUB','USD'].map(x=><option key={x}>{x}</option>)}</select></label>
   <label>{t('buildingLimit')}<input name="buildingLimit" type="number" min={1} max={100000} required defaultValue={plan?.building_limit}/></label>
   <label>{t('graceDays')}<input name="graceDays" type="number" min={0} max={365} required defaultValue={plan?.grace_days??0}/></label>
   <fieldset className="cx-mods"><legend>{t('modules')}</legend>{keys.map(k=><label key={k}><input type="checkbox" checked={mods.includes(k)} onChange={e=>setMods(m=>e.target.checked?[...m,k]:m.filter(x=>x!==k))}/>{t('module_'+k)}</label>)}</fieldset>
   {plan&&<label>{t('reason')}<input name="reason" required minLength={8} maxLength={500}/></label>}
   <div className="cx-row"><button className="p-button orange" disabled={busy}>{t('save')}</button>{plan&&<button type="button" className="p-button" onClick={()=>pickPlan('')}>{t('cancel')}</button>}</div></form>
  <form className="p-card p-edit-form cx-form" onSubmit={createSub}><h3>{t('subscriptions')}</h3>
   <label>{t('organization')}<select name="organizationId" required defaultValue=""><option value="">—</option>{orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
   <label>{t('plan')}<select name="planId" required defaultValue=""><option value="">—</option>{plans.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   <label>{t('startsOn')}<input name="startsOn" type="date" required/></label><label>{t('endsOn')}<input name="endsOn" type="date" required/></label>
   <label>{t('status')}<select name="status" defaultValue="trial">{['trial','active'].map(s=><option key={s} value={s}>{t(s)}</option>)}</select></label>
   <p className="p-info cx-warn" role="note">{t('subWarn')}</p><button className="p-button orange" disabled={busy}>{t('create')}</button></form></div>
  <section className="p-card"><h3>{t('subscriptions')}</h3><div className="cx-scroll"><table className="cx-table"><thead><tr><th>{t('organization')}</th><th>{t('plan')}</th><th>{t('amount')}</th><th>{t('until')}</th><th>{t('status')}</th><th>{t('graceUntil')}</th><th/></tr></thead><tbody>
  {subs.map(s=><tr key={s.id} aria-selected={s.id===subId}><td>{s.organization_name}</td><td>{s.plan_name}</td><td>{fromMinor(s.amount_minor)} {s.currency}</td><td>{fmtDate(String(s.ends_on).slice(0,10),language)}</td><td>{t(s.effective_status)}{s.effective_status!==s.status&&' ('+t(s.status)+')'}</td><td>{fmtDate(s.grace_until,language)}</td>
  <td className="cx-row"><button className="p-button" onClick={()=>setSubId(s.id)}>{t('edit')}</button><button className="p-button" onClick={()=>setOrg(s.organization_id)}>{t('policy')}</button></td></tr>)}
  {!subs.length&&<tr><td colSpan={7}>{t('empty')}</td></tr>}</tbody></table></div></section>
  {sub&&<form key={sub.id} className="p-card p-edit-form cx-form" onSubmit={updateSub}><h3>{sub.organization_name} · {sub.plan_name}</h3>
   {closed?<p className="p-info">{t('noReactivate')}</p>:<>
   <label>{t('status')}<select name="status" defaultValue={sub.status==='paused'?'suspended':sub.status}>{STATUSES.map(s=><option key={s} value={s}>{t(s)}</option>)}</select></label>
   <label>{t('graceUntil')}<input name="graceUntil" type="datetime-local" defaultValue={sub.grace_until?yerevanInput(sub.grace_until):''}/></label>
   <label>{t('reason')}<input name="reason" required minLength={8} maxLength={500}/></label>
   <p className="p-info">{t('noReactivate')}</p>
   <div className="cx-row"><button className="p-button orange" disabled={busy}>{t('save')}</button><button type="button" className="p-button" onClick={()=>setSubId('')}>{t('cancel')}</button></div></>}</form>}
  <section className="p-card" aria-live="polite"><h3>{t('policy')}</h3>
   <label className="cx-form">{t('organization')}<select value={org} onChange={e=>setOrg(e.target.value)}><option value="">—</option>{orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
   {!org||!policy?<p className="p-info">{t('noPolicy')}</p>:<PolicyPanel key={org} policy={policy} orgId={org} t={t} busy={busy} run={run}/>}</section>
 </div>}
function PolicyPanel({policy,orgId,t,busy,run}:{policy:Row;orgId:string;t:(k:string)=>string;busy:boolean;run:(fn:()=>Promise<unknown>,after?:()=>void)=>Promise<void>}){
 const [reason,setReason]=useState('');const ok=reason.trim().length>=8;
 return <div className="cx-wrap"><p>{policy.enforced?t('enforced'):t('notEnforced')} · {t('state')}: {t(policy.state)} {policy.readOnly&&'· '+t('readOnly')} · {t('buildingLimit')}: {policy.buildingLimit??'—'}</p>
  <label className="cx-form">{t('reason')}<input value={reason} onChange={e=>setReason(e.target.value)} minLength={8} maxLength={500}/></label>
  <div className="cx-row"><button className="p-button" disabled={busy||!ok} onClick={()=>{if(window.confirm(t('enforcementWarning')))void run(()=>request('/organizations/'+orgId+'/subscription-policy','PATCH',{enabled:!policy.enforced,reason}),()=>setReason(''))}}>{t('enforcement')}: {policy.enforced?t('disabled'):t('enabled')}</button></div>
  <div className="cx-scroll"><table className="cx-table"><thead><tr><th>{t('modules')}</th><th>{t('override')}</th><th>{t('effective')}</th></tr></thead><tbody>
  {(policy.overrides??[]).map((o:Row)=><tr key={o.module}><td>{t('module_'+o.module)}</td><td><select aria-label={o.module} disabled={busy||!ok} value={o.override_state??'inherited'} onChange={e=>void run(()=>request('/organizations/'+orgId+'/module-overrides/'+o.module,'PATCH',{state:e.target.value,reason}))}>{['inherited','enabled','disabled'].map(s=><option key={s} value={s}>{t(s)}</option>)}</select></td><td>{o.effective?t('yes'):t('no')}</td></tr>)}</tbody></table></div></div>}
