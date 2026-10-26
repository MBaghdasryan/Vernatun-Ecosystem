import type {ResidentWorkspace} from '@workspace/api-client-react';
import type {Language} from '../../portal/i18n';
import {L,S,integStatus,integName,type T} from './text';
export default function Building({l,ws}:{l:Language;ws:ResidentWorkspace}){
 const h=ws.home,w=ws.building,na=L(l,S.unknown);
 const amt=(v:string|null)=>v==null?na:(Number(v)/100).toLocaleString(l)+' '+h.currency;
 const rows:[T,string][]=[[S.open,h.openRequests==null?na:String(h.openRequests)],[S.unread,h.unreadNotifications==null?na:String(h.unreadNotifications)],[S.payable,amt(h.payableMinor)],[S.overdue,amt(h.overdueMinor)],[S.paid,amt(h.annualPaidMinor)]];
 return <><div className="im-card sx-building"><h2>{w.name}</h2><p>{w.address}</p><p>{w.organization}{w.unit?' · '+w.unit:''}{w.area?' · '+w.area+' m²':''}</p><small>{w.timezone}</small></div>
 <div className="sx-stats">{rows.map(([k,v],i)=><div key={i} className="im-card"><small>{L(l,k)}</small><strong>{v}</strong></div>)}</div>
 {ws.integrations.length>0&&<div className="im-card"><h3>{L(l,S.integ)}</h3>{ws.integrations.map(i=><p key={i.key}><span className={'im-chip '+(i.status==='ACTIVE'?'im-success':'im-warning')}>{integStatus[i.status]?L(l,integStatus[i.status]):na}</span> {integName[i.key]?L(l,integName[i.key]):i.key.replace(/[-_]/g,' ')}</p>)}{ws.integrations.some(i=>i.status!=='ACTIVE')&&<small>{L(l,S.blocked)}</small>}</div>}</>}
