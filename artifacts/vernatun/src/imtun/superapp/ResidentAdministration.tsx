import {useEffect,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {getResidentAdminBuildings,getResidentWorkspace,updateResidentBuildingSettings} from '@workspace/api-client-react';
import type {ResidentBuildingSettings,ResidentRecordKind} from '@workspace/api-client-react';
import type {RoleContext} from '../../portal/types';
import type {Language} from '../../portal/i18n';
import {L,S} from './text';
import {A,settingKeys,staffKinds} from './adminText';
import {useAct} from './useAct';
import AdminRecords from './AdminRecords';
import {StaffBookings} from '../continuity/Bookings';
import './admin.css';
function Settings({value,l,buildingId,refresh}:{value:ResidentBuildingSettings;l:Language;buildingId:string;refresh:()=>void}){
 const [s,setS]=useState(value),[ok,setOk]=useState(false),a=useAct(l,refresh);
  useEffect(()=>setS(value),[value]);
 return <form className="im-card sx-form" onSubmit={e=>{e.preventDefault();void a.run(async()=>{await updateResidentBuildingSettings(s,{buildingId});setOk(true)})}}><h3>{L(l,A.settings)}</h3>
 {settingKeys.map(k=><label key={k} className="sx-check"><input type="checkbox" checked={s[k]} onChange={e=>{setOk(false);setS({...s,[k]:e.target.checked})}}/>{L(l,A[k])}</label>)}<small>{L(l,A.dirHint)}</small>
 <button className="im-button" disabled={a.busy}>{L(l,S.save)}</button>{ok&&<p role="status">{L(l,A.saved)}</p>}{a.err&&<p role="alert" className="sx-err">{a.err}</p>}</form>}
export default function ResidentAdministration({c,language:l}:{c:RoleContext;language:Language}){
 const qc=useQueryClient(),bq=useQuery({queryKey:['resident-admin-buildings',c.id],queryFn:()=>getResidentAdminBuildings()});
 const [pick,setPick]=useState(''),[kind,setKind]=useState<ResidentRecordKind>('contacts');
 const buildingId=pick||bq.data?.[0]?.id||'',scope=c.id+':'+buildingId;
 const ws=useQuery({queryKey:['resident-admin-ws',scope],enabled:!!buildingId,queryFn:()=>getResidentWorkspace({buildingId})});
  return <div className="sx-root sx-admin" key={c.id}><div><h2>{L(l,A.title)}</h2><p>{L(l,A.intro)}</p></div>
 {bq.isPending&&<div className="im-card sx-skel" aria-busy="true">{L(l,S.loading)}</div>}{bq.isError&&<div className="im-notice" role="alert">{L(l,S.fail)} <button onClick={()=>bq.refetch()}>{L(l,S.retry)}</button></div>}
 {bq.data&&!bq.data.length&&<div className="im-card im-empty"><p>{L(l,A.noBuildings)}</p></div>}
 {!!bq.data?.length&&<><label className="sx-form"><span>{L(l,A.building)}</span><select className="sx-search" value={buildingId} onChange={e=>setPick(e.target.value)}>{bq.data.map(b=><option key={b.id} value={b.id}>{b.name} · {b.organization}</option>)}</select></label>
 {ws.isPending&&<div className="im-card sx-skel" aria-busy="true">{L(l,S.loading)}</div>}{ws.isError&&<div className="im-notice" role="alert">{L(l,S.fail)} <button onClick={()=>ws.refetch()}>{L(l,S.retry)}</button></div>}
 {ws.data&&!ws.data.administrative&&<div className="im-card im-empty"><p>{L(l,A.denied)}</p></div>}
  {ws.data?.administrative&&<><Settings key={scope} value={ws.data.settings} l={l} buildingId={buildingId} refresh={()=>{void qc.invalidateQueries({queryKey:['resident-admin-ws',scope]})}}/>
 <div className="sx-hub im-quick" role="tablist" aria-label={L(l,A.tabs)}>{staffKinds.map(([k,lab])=><button key={k} role="tab" aria-selected={kind===k} className={kind===k?'active':''} onClick={()=>setKind(k)}>{L(l,[...lab] as any)}</button>)}</div>
 <AdminRecords key={scope+kind} kind={kind} l={l} scope={scope} buildingId={buildingId}/>
 {c.permissions.includes('requests.assign')?<StaffBookings key={scope} l={l} buildingId={buildingId} scope={scope}/>:<div className="im-card"><p>{L(l,['Ամրագրումների հերթը հասանելի չէ․ պակասում է հայտերի նշանակման իրավունքը։','Очередь записей недоступна: нет права назначать заявки.','The booking queue is not available: this role cannot assign requests.'])}</p></div>}</>}</>}</div>}
