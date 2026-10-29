import {useState,useEffect,useCallback,useRef,type FormEvent} from 'react';
import {downloadFile,request} from './client';
import {ct} from './console-i18n';
import {errText,fmtDate,yerevanInstant} from './console-util';
import type {Language,Currency} from './i18n';
import type {RoleContext} from './types';
import './console.css';
type Row=Record<string,any>;
const EMPTY={organizationId:'',actor:'',action:'',entityType:'',result:'',from:'',to:'',sort:'created_at',direction:'desc'};
export default function AuditConsole({c,language}:{c:RoleContext;language:Language;currency:Currency}){
 const t=(k:string)=>ct(language,k);
 const [draft,setDraft]=useState(EMPTY),[filters,setFilters]=useState(EMPTY),[page,setPage]=useState(1),[size]=useState(25);
 const [data,setData]=useState<Row>(),[orgs,setOrgs]=useState<Row[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[tick,setTick]=useState(0);
 const canOrgs=c.permissions.includes('organizations.read'),crossOrg=c.permissions.includes('platform.audit');
 useEffect(()=>{if(canOrgs&&crossOrg)request<Row[]>('/organizations').then(setOrgs).catch(()=>setOrgs([]))},[canOrgs,crossOrg,c.id]);
 const sequence=useRef(0);
 const load=useCallback(async()=>{const ticket=++sequence.current;setLoading(true);setError('');
  const q=new URLSearchParams({paged:'true',page:String(page),pageSize:String(size)});
  const x:Record<string,string>={...filters};
  if(x.from)x.from=yerevanInstant(x.from);if(x.to)x.to=yerevanInstant(x.to);
  if(!crossOrg)x.organizationId='';
  if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x.actor)){x.actorId=x.actor;x.actor=''}
  for(const[k,v]of Object.entries(x))if(v)q.set(k,v);
  try{const result=await request<Row>('/audit?'+q);if(ticket===sequence.current)setData(result)}catch(e){if(ticket===sequence.current)setError(errText(language,e))}finally{if(ticket===sequence.current)setLoading(false)}},[filters,page,size,crossOrg,language]);
 useEffect(()=>{void load()},[load,tick,c.id]);
 const set=(k:string)=>(e:{target:{value:string}})=>setDraft(d=>({...d,[k]:e.target.value}));
 const submit=(e:FormEvent)=>{e.preventDefault();setPage(1);setFilters(draft)};
 const items:Row[]=data?.items??[],total=Number(data?.total??0),pages=Math.max(1,Math.ceil(total/size));
 const inp=(k:keyof typeof EMPTY,l:string,type='text')=><label>{t(l)}<input type={type} value={draft[k]} onChange={set(k)} maxLength={120}/></label>;
  async function exportCsv(){try{const q=new URLSearchParams(),x:Record<string,string>={...filters};
   if(x.from)x.from=yerevanInstant(x.from);if(x.to)x.to=yerevanInstant(x.to);
   if(!crossOrg)x.organizationId='';
   if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x.actor)){x.actorId=x.actor;x.actor=''}
   for(const[k,v]of Object.entries(x))if(v)q.set(k,v);
   const blob=await downloadFile('/audit/export.csv?'+q),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='audit-events.csv';a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setError(errText(language,e))}}
 return <div className="p-business cx-wrap">
  <form className="p-card cx-form" onSubmit={submit} role="search"><h3>{t('audit')}</h3><div className="cx-filters">
   {crossOrg&&canOrgs&&<label>{t('organization')}<select value={draft.organizationId} onChange={set('organizationId')}><option value="">{t('all')}</option>{orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
   {inp('actor','actor')}{inp('action','action')}{inp('entityType','entityType')}
   <label>{t('result')}<select value={draft.result} onChange={set('result')}><option value="">{t('all')}</option><option value="success">{t('success')}</option><option value="failure">{t('failure')}</option></select></label>
   {inp('from','from','datetime-local')}{inp('to','to','datetime-local')}
   <label>{t('sort')}<select value={draft.sort} onChange={set('sort')}>{['created_at','action','actor'].map(s=><option key={s} value={s}>{t(s==='actor'?'actor':s==='action'?'action':s)}</option>)}</select></label>
   <label>{t('direction')}<select value={draft.direction} onChange={set('direction')}><option value="desc">{t('desc')}</option><option value="asc">{t('asc')}</option></select></label></div>
    <div className="cx-row"><button className="p-button orange">{t('apply')}</button><button type="button" className="p-button" onClick={()=>{setDraft(EMPTY);setFilters(EMPTY);setPage(1)}}>{t('reset')}</button><button type="button" className="p-button" onClick={()=>void exportCsv()}>{language==='ru'?'Экспорт CSV':language==='hy'?'CSV արտահանում':'Export CSV'}</button><button type="button" className="p-button" disabled={loading} onClick={()=>setTick(n=>n+1)}>{t('refresh')}</button></div></form>
  {error&&<div role="alert"><p className="p-error">{error}</p><button className="p-button" onClick={()=>setTick(n=>n+1)}>{t('retry')}</button></div>}
  <section className="p-card" aria-busy={loading}>{loading&&!data?<p role="status">{t('loading')}</p>:<div className="cx-scroll"><table className="cx-table"><thead><tr><th>{t('created_at')}</th><th>{t('organization')}</th><th>{t('actor')}</th><th>{t('action')}</th><th>{t('entity')}</th><th>{t('result')}</th><th>{t('details')}</th></tr></thead><tbody>
   {items.map(i=><tr key={i.id}><td>{fmtDate(i.created_at,language)}</td><td>{i.organization_name??'—'}</td><td>{i.actor??'—'}</td><td>{i.action}</td><td>{i.entity_type}{i.entity_id?' · '+i.entity_id:''}</td><td>{i.result?t(i.result):'—'}</td><td><pre className="cx-pre">{JSON.stringify(i.details??{},null,1)}</pre></td></tr>)}
   {!items.length&&<tr><td colSpan={7}>{t('empty')}</td></tr>}</tbody></table></div>}
   <div className="cx-row" aria-live="polite"><button className="p-button" disabled={loading||page<=1} onClick={()=>setPage(p=>p-1)}>{t('prev')}</button><span>{t('page')} {page} {t('of')} {pages} · {t('total')}: {total}</span><button className="p-button" disabled={loading||page>=pages} onClick={()=>setPage(p=>p+1)}>{t('next')}</button></div></section></div>}
