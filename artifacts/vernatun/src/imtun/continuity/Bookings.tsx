import {useState} from 'react';
import {getResidentAdminBuildings,getResidentServiceBookingOptions} from '@workspace/api-client-react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {createResidentServiceBooking,getResidentRecords,getResidentServiceBookings,reviewResidentServiceBooking} from '@workspace/api-client-react';
import type {ResidentContinuity,ResidentServiceBooking} from '@workspace/api-client-react';
import type {RoleContext} from '../../portal/types';
import type {Language} from '../../portal/i18n';
import {viewRoute} from '../../../shared/products';
import {useAct} from '../superapp/useAct';
import {contKey,tt,fmtTime} from './core';
import './continuity.css';
const st=(l:Language,s:ResidentServiceBooking['status'])=>({requested:tt(l,'Հարցված','Запрошено','Requested'),confirming:tt(l,'Հաստատվում է','Подтверждается','Confirming'),confirmed:tt(l,'Հաստատված','Подтверждено','Confirmed'),rejected:tt(l,'Մերժված','Отклонено','Rejected'),cancelled:tt(l,'Չեղարկված','Отменено','Cancelled')})[s];
const iso=(v:string)=>new Date(v).toISOString();
export default function Bookings({c,l,d}:{c:RoleContext;l:Language;d:ResidentContinuity}){
 const qc=useQueryClient(),refresh=()=>{void qc.invalidateQueries({queryKey:contKey(c.id)})},a=useAct(l,refresh);
 const [sid,setSid]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[note,setNote]=useState('');
 const svc=useQuery({queryKey:['resident-cx-services',c.id],enabled:d.canBook,queryFn:()=>getResidentRecords('services')});
 const bad=!from||!to||new Date(from).getTime()<=Date.now()||new Date(to)<=new Date(from);
 if(!d.canBook)return <div className="im-card im-empty"><p>{tt(l,'Ամրագրումը միացված չէ այս շենքում։','Запись на услуги не включена.','Service booking is not enabled.')}</p></div>;
 return <section className="cx sx-section"><div className="im-section-title"><h2>{tt(l,'Ծառայության ամրագրում','Запись на услугу','Book a service')}</h2></div>
 <form className="im-card sx-form" onSubmit={e=>{e.preventDefault();void a.run(async()=>{await createResidentServiceBooking({serviceId:sid,startsAt:iso(from),endsAt:iso(to),note:note.trim()});setNote('');setFrom('');setTo('')})}}>
 <label>{tt(l,'Ծառայություն','Услуга','Service')}<select required value={sid} onChange={e=>setSid(e.target.value)}><option value="">—</option>{svc.data?.items.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
 <label>{tt(l,'Սկիզբ','Начало','Starts')}<input type="datetime-local" required value={from} onChange={e=>setFrom(e.target.value)}/></label>
 <label>{tt(l,'Ավարտ','Окончание','Ends')}<input type="datetime-local" required value={to} onChange={e=>setTo(e.target.value)}/></label>
 <label>{tt(l,'Նշում','Комментарий','Note')}<textarea maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label>
 {(from||to)&&bad&&<small role="status">{tt(l,'Ընտրեք ապագա ժամանակ, ավարտը՝ սկզբից հետո։','Выберите будущее время; окончание после начала.','Pick a future time; end must be after start.')}</small>}
 <button className="im-button" disabled={a.busy||bad||!sid}>{tt(l,'Ուղարկել հարցում','Отправить запрос','Request slot')}</button>{a.err&&<p role="alert" className="sx-err">{a.err}</p>}</form>
 <div className="im-card sx-form"><h3>{tt(l,'Իմ ամրագրումները','Мои записи','My bookings')}</h3>
 <ul className="cx-list">{d.bookings.map(b=><li key={b.id} className="cx-row"><strong>{b.title}</strong><span>{fmtTime(l,b.startsAt)} – {fmtTime(l,b.endsAt)}</span><span className="cx-badge">{st(l,b.status)}</span>
 {b.requestId&&<a className="sx-link" href={viewRoute('imtun','requests',c.role_key)+'?requestId='+encodeURIComponent(b.requestId)}>{tt(l,'Բացել հայտը','Открыть заявку','Open request')}</a>}
 {b.status==='requested'&&<button className="im-button" disabled={a.busy} onClick={()=>void a.run(()=>reviewResidentServiceBooking(b.id,{action:'cancel',version:b.version}))}>{tt(l,'Չեղարկել','Отменить','Cancel')}</button>}</li>)}</ul>
 {!d.bookings.length&&<p>{tt(l,'Ամրագրումներ չկան','Записей нет','No bookings yet')}</p>}</div></section>}
type Act=ReturnType<typeof useAct>;
function QueueRow({b,l,buildingId,scope,a}:{b:ResidentServiceBooking;l:Language;buildingId:string;scope:string;a:Act}){
 const o=useQuery({queryKey:['resident-cx-opts',scope,b.id],enabled:b.status==='requested',queryFn:()=>getResidentServiceBookingOptions(b.id,{buildingId})});
 const [cat,setCat]=useState(''),[tech,setTech]=useState('');
 const ok=!!o.data&&o.data.categories.some(x=>x.id===cat)&&o.data.technicians.some(x=>x.id===tech);
 return <li className="cx-row"><strong>{b.title}</strong><span>{fmtTime(l,b.startsAt)} – {fmtTime(l,b.endsAt)}</span><span className="cx-badge">{st(l,b.status)}</span>
 {b.status==='requested'&&<>
 {o.isPending&&<span aria-busy="true">…</span>}{o.isError&&<span role="alert">{tt(l,'Ընտրանքները հասանելի չեն։','Варианты недоступны.','Options are unavailable.')} <button type="button" onClick={()=>o.refetch()}>{tt(l,'Կրկնել','Повторить','Retry')}</button></span>}
 {o.data&&<><label>{tt(l,'Կատեգորիա','Категория','Category')}<select value={cat} onChange={e=>setCat(e.target.value)}><option value="">—</option>{o.data.categories.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
 <label>{tt(l,'Տեխնիկ','Исполнитель','Technician')}<select value={tech} onChange={e=>setTech(e.target.value)}><option value="">—</option>{o.data.technicians.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
 {(!o.data.categories.length||!o.data.technicians.length)&&<small>{tt(l,'Հաստատման համար պետք են կատեգորիա և տեխնիկ։','Для подтверждения нужны категория и исполнитель.','Confirming needs an available category and technician.')}</small>}</>}
 <button className="im-button" disabled={a.busy||!ok} onClick={()=>void a.run(()=>reviewResidentServiceBooking(b.id,{action:'confirm',version:b.version,categoryId:cat,technicianId:tech},{buildingId}))}>{tt(l,'Հաստատել','Подтвердить','Confirm')}</button>
 <button className="im-button" disabled={a.busy} onClick={()=>void a.run(()=>reviewResidentServiceBooking(b.id,{action:'reject',version:b.version},{buildingId}))}>{tt(l,'Մերժել','Отклонить','Reject')}</button></>}</li>}
export function StaffBookings({l,buildingId,scope}:{l:Language;buildingId:string;scope:string}){
 const qc=useQueryClient(),key=['resident-cx-staff',scope],q=useQuery({queryKey:key,queryFn:()=>getResidentServiceBookings({buildingId})});
 const a=useAct(l,()=>{void qc.invalidateQueries({queryKey:key})});
 return <section className="cx im-card sx-form" aria-labelledby="cx-sq"><h3 id="cx-sq">{tt(l,'Ամրագրումների հերթ','Очередь записей','Booking queue')}</h3>
 <small>{tt(l,'Հաստատումը ստեղծում է հայտ, նշանակված աշխատանք և ամրագրում մեկ գործարքով։','Подтверждение атомарно создаёт заявку, назначенное задание и запись.','Confirming atomically creates the request, an assigned work order and the booking.')}</small>
 {q.isPending&&<div className="sx-skel" aria-busy="true">…</div>}{q.isError&&<div className="im-notice" role="alert">{tt(l,'Չհաջողվեց բեռնել։','Не удалось загрузить.','Could not load.')} <button onClick={()=>q.refetch()}>{tt(l,'Կրկնել','Повторить','Retry')}</button></div>}
 {q.data&&!q.data.length&&<p>{tt(l,'Հերթը դատարկ է','Очередь пуста','Queue is empty')}</p>}
 <ul className="cx-list">{q.data?.map(b=><QueueRow key={b.id+b.version} b={b} l={l} buildingId={buildingId} scope={scope} a={a}/>)}</ul>{a.err&&<p role="alert" className="sx-err">{a.err}</p>}</section>}
export function StaffBookingQueue({c,l}:{c:RoleContext;l:Language}){
 const can=c.permissions.includes('requests.assign'),bq=useQuery({queryKey:['resident-cx-bldgs',c.id],enabled:can&&!c.building_id,queryFn:()=>getResidentAdminBuildings()});
 const [pick,setPick]=useState('');
 if(!can)return null;
 const buildingId=c.building_id||pick||bq.data?.[0]?.id||'';
 return <>{!c.building_id&&bq.data&&bq.data.length>1&&<label className="sx-form">{tt(l,'Շենք','Здание','Building')}<select value={buildingId} onChange={e=>setPick(e.target.value)}>{bq.data.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
 {bq.isError&&<p role="alert">{tt(l,'Շենքերը չբեռնվեցին։','Здания не загрузились.','Buildings did not load.')}</p>}
 {buildingId&&<StaffBookings key={c.id+buildingId} l={l} buildingId={buildingId} scope={c.id+':'+buildingId}/>}</>}
