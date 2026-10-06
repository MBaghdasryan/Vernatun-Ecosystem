import {useState,useEffect,useCallback,useRef,type FormEvent} from 'react';
import {request} from './client';
import {ct} from './console-i18n';
import {errText,fmtDate} from './console-util';
import {roleName,type Language,type Currency} from './i18n';
import {roleRoutes} from '../../shared/products';
import type {RoleContext} from './types';
import './console.css';
type Row=Record<string,any>;
const DELEGABLE=Object.keys(roleRoutes).filter(r=>r!=='platform_admin'&&r!=='support');
const UNIT_ROLES=['unit_owner','renter','family'];
export default function InvitationConsole({c,language}:{c:RoleContext;language:Language;currency:Currency}){
 const t=(k:string)=>ct(language,k);
 const platform=c.permissions.includes('platform.invite'),people=c.permissions.includes('people.invite');
 const [loaded,setLoaded]=useState<{contextId:string;rows:Row[]}>();
 const activeContext=useRef(c.id);activeContext.current=c.id;
 const list=loaded?.contextId===c.id?loaded.rows:undefined;
 const [orgs,setOrgs]=useState<Row[]>([]),[blds,setBlds]=useState<Row[]>([]),[units,setUnits]=useState<Row[]>([]);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState<Row>(),[role,setRole]=useState(platform?'org_admin':''),[bld,setBld]=useState('');
 const [editing,setEditing]=useState(''),[address,setAddress]=useState('');
 const load=useCallback(async()=>{try{const rows=await request<Row[]>('/invitations');if(activeContext.current===c.id){setLoaded({contextId:c.id,rows});setError('')}}catch(e){if(activeContext.current===c.id)setError(errText(language,e))}},[language,c.id]);
 useEffect(()=>{void load();setNotice(undefined);setEditing('')},[load]);
 useEffect(()=>{const timer=window.setInterval(()=>{if(!busy&&document.visibilityState==='visible')void load()},30000);return()=>window.clearInterval(timer)},[load,busy]);
 useEffect(()=>{if(platform)request<Row[]>('/organizations').then(setOrgs).catch(()=>{});else if(people){request<Row[]>('/properties').then(setBlds).catch(()=>{});request<Row[]>('/units').then(setUnits).catch(()=>{})}},[platform,people,c.id]);
 if(!platform&&!people)return <p role="alert" className="p-error">{t('denied')}</p>;
 const needsUnit=!platform&&UNIT_ROLES.includes(role);
 async function act(fn:()=>Promise<unknown>){if(busy)return;setBusy(true);setError('');setNotice(undefined);try{await fn();await load()}catch(e){await load();setError(errText(language,e))}finally{setBusy(false)}}
 function create(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget,d=new FormData(form);
  const body:Row={email:String(d.get('email')).trim(),role};
  if(platform)body.organizationId=d.get('organizationId');
  else if(needsUnit){if(!d.get('buildingId')||!d.get('unitId')){setError(t('needUnit'));return}body.buildingId=d.get('buildingId');body.unitId=d.get('unitId')}
  else if(!platform&&d.get('buildingId'))body.buildingId=d.get('buildingId');
  void act(async()=>{setNotice(await request<Row>('/invitations','POST',body));form.reset();setBld('');if(!platform)setRole('')})}
 const canResend=(i:Row)=>i.status!=='accepted'&&i.status!=='revoked'&&!i.accepted_at&&!i.revoked_at&&(!platform||i.role_key==='org_admin')&&!i.delegation_id;
 const roles=platform?['org_admin']:DELEGABLE;
 return <div className="p-business cx-wrap">
  <div className="cx-row"><button className="p-button" disabled={busy} onClick={()=>void load()}>{t('refresh')}</button></div>
  {error&&<div role="alert"><p className="p-error">{error}</p>{!list&&<button className="p-button" onClick={()=>void load()}>{t('retry')}</button>}</div>}
  {notice&&<div className="p-card" role="status"><p>{notice.delivery==='local_only'?t('local'):t('sent')}</p>{notice.delivery!=='local_only'&&<p className="p-info">{t('smtpNote')}</p>}{notice.url&&<label className="cx-form">{t('localLink')}<input readOnly value={notice.url} onFocus={e=>e.currentTarget.select()}/></label>}<button className="p-button" onClick={()=>setNotice(undefined)}>{t('cancel')}</button></div>}
  <form className="p-card p-edit-form cx-form" onSubmit={create}><h3>{t('invite')}</h3>
   <label>{t('email')}<input name="email" type="email" required maxLength={254} autoComplete="off"/></label>
   {platform&&<label>{t('organization')}<select name="organizationId" required defaultValue=""><option value="">—</option>{orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
   <label>{t('role')}<select value={role} onChange={e=>setRole(e.target.value)} required disabled={platform}>{!platform&&<option value="">—</option>}{roles.map(r=><option key={r} value={r}>{roleName(language,r)}</option>)}</select></label>
   {!platform&&<label>{t('building')}<select name="buildingId" required={needsUnit||!!c.building_id} value={bld} onChange={e=>setBld(e.target.value)}><option value="">—</option>{blds.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
   {needsUnit&&<label>{t('unit')}<select name="unitId" required defaultValue=""><option value="">—</option>{units.filter(u=>!bld||u.building_id===bld).map(u=><option key={u.id} value={u.id}>{u.building_name} · {u.number}</option>)}</select></label>}
   <button className="p-button orange" disabled={busy||!role}>{t('create')}</button></form>
  <section className="p-card"><h3>{t('invitations')}</h3>{!list?<p role="status">{t('loading')}</p>:<div className="cx-scroll"><table className="cx-table"><thead><tr><th>{t('email')}</th><th>{t('role')}</th><th>{t('organization')}</th><th>{t('expires')}</th><th>{t('status')}</th><th>{t('delivery')}</th><th/></tr></thead><tbody>
   {list.map(i=><tr key={i.id}><td>{i.email}</td><td>{roleName(language,i.role_key)}</td><td>{i.organization_name??'—'}</td><td>{fmtDate(i.expires_at,language)}</td><td>{t(i.status)}</td>
   <td><span role="status">{t('delivery_'+(i.delivery_outcome??'unknown'))}</span>
    {i.delivery_outcome_at&&<><br/><small>{fmtDate(i.delivery_outcome_at,language)}</small></>}
    {i.delivery_outcome==='accepted'&&<><br/><small>{t('smtpNote')}</small></>}
    {i.delivery_outcome==='delivered'&&<><br/><small>{t('deliveredNote')}</small></>}
   </td>
   <td className="cx-row">{canResend(i)?<button className="p-button" disabled={busy} onClick={()=>void act(async()=>setNotice(await request<Row>('/invitations/'+i.id+'/resend','POST',{})))}>{t('resend')}</button>:i.status==='pending'&&<small>{t('noResend')}</small>}
   {canResend(i)&&<button className="p-button" disabled={busy} onClick={()=>{setEditing(i.id);setAddress(i.email)}}>{t('correctEmail')}</button>}
   {editing===i.id&&canResend(i)&&<form className="cx-form" onSubmit={e=>{e.preventDefault();void act(async()=>{
    setNotice(await request<Row>('/invitations/'+i.id+'/resend','POST',{email:address.trim()}));setEditing('');
   })}}><label>{t('email')}<input type="email" required maxLength={254} value={address} onChange={e=>setAddress(e.target.value)}/></label>
    <button className="p-button" disabled={busy}>{t('correctAndResend')}</button><button type="button" className="p-button" disabled={busy} onClick={()=>setEditing('')}>{t('cancel')}</button></form>}
   {i.status==='pending'&&<button className="p-button" disabled={busy} onClick={()=>{if(window.confirm(t('confirmRevoke')))void act(()=>request('/invitations/'+i.id,'DELETE'))}}>{t('revoke')}</button>}</td></tr>)}
   {!list.length&&<tr><td colSpan={7}>{t('empty')}</td></tr>}</tbody></table></div>}</section></div>}
