import {useEffect,useRef,useState} from 'react';
import {getAvailabilityOptions,getStaffAvailability,createAvailabilityBlock,changeAvailabilityBlock} from '@workspace/api-client-react';
import type {AvailabilityUnit,StaffAvailability as Data,AvailabilityBlock} from '@workspace/api-client-react';
import type {Language} from './i18n';
import type {RoleContext} from './types';
import {getCsrfHeaders} from './client';
import {todayYerevan} from './visit-calendar';
import './staff-availability.css';

const L={
 title:['Աշխատակիցների հասանելիություն','Доступность сотрудников','Staff availability'],
 unit:['Բնակարան','Помещение','Unit'],from:['Սկսած','С','From'],to:['Մինչև','По','Until'],
 check:['Ստուգել','Проверить','Check'],refresh:['Թարմացնել','Обновить','Refresh'],
 loading:['Բեռնվում է…','Загрузка…','Loading…'],
 error:['Չհաջողվեց բեռնել։ Կրկնեք։','Не удалось загрузить. Повторите.','Could not load. Retry.'],
 retry:['Կրկնել','Повторить','Retry'],
 noUnits:['Հասանելի բնակարաններ չկան','Нет доступных помещений','No units you may plan for'],
 noPeople:['Այս շրջանակում աշխատակիցներ չկան','В этой области нет сотрудников','No staff in this scope'],
 invalid:['Ավարտը պետք է լինի սկզբից հետո, մինչև 62 օր։','Конец должен быть позже начала, период до 62 дней.','End must be after start, at most 62 days.'],
 note:['Կարգավիճակը վերաբերում է միայն ձեզ թույլատրված շրջանակին և ընտրված միջակայքին։ Սա ընդհանուր ազատություն չէ և ավտոմատ ամրագրում չի կատարում։ 09–10 հասանելի լինելը չի նշանակում ամբողջ օրը։','Статус действует ТОЛЬКО в разрешённой вам области и для выбранного интервала. Это не глобальная свобода сотрудника и не автоматическая запись. «Доступен 09–10» не означает весь день.','Status applies ONLY within your permitted scope and the selected interval. It is not global free time and books nothing automatically. Available 09–10 does not mean the whole day.'],
  unknown:['Հասանելիությունը հայտնի չէ','Доступность не подтверждена','Availability unknown'],
 available_in_scope:['Հասանելի շրջանակում','Доступен в области','Available in scope'],
 busy:['Զբաղված — այց','Занят — визит','Busy — visit'],absent:['Բացակա','Отсутствует','Absent'],
 visits:['Այցեր','Визиты','Visits'],blocks:['Պլանավորման բլոկներ','Блоки планирования','Planning blocks'],
 noBlocks:['Բլոկներ չկան','Блоков нет','No blocks'],
 shift:['Հերթափոխ','Смена','Shift'],absence:['Բացակայություն','Отсутствие','Absence'],
 cancelled:['Չեղարկված','Отменён','Cancelled'],
 add:['Նոր բլոկ','Новый блок','New block'],editT:['Խմբագրել բլոկը','Изменить блок','Edit block'],
 person:['Աշխատակից','Сотрудник','Employee'],kind:['Տեսակ','Тип','Kind'],scope:['Շրջանակ','Область','Scope'],
 sBuilding:['Ամբողջ շենքը','Всё здание','Whole building'],sUnit:['Միայն բնակարանը','Только помещение','This unit only'],
 start:['Սկիզբ','Начало','Start'],end:['Ավարտ','Конец','End'],
 save:['Պահպանել','Сохранить','Save'],saving:['Պահպանվում է…','Сохранение…','Saving…'],
 edit:['Խմբագրել','Изменить','Edit'],cancel:['Չեղարկել բլոկը','Отменить блок','Cancel block'],
 confirm:['Հաստատել չեղարկումը','Подтвердить отмену','Confirm cancellation'],keep:['Ոչ','Нет','Keep'],
 close:['Փակել','Закрыть','Close'],
 saved:['Պահպանված է','Сохранено','Saved'],cancelledOk:['Բլոկը չեղարկված է','Блок отменён','Block cancelled'],
  stale:['Գրառումը փոխվել է։ Մուտքագրումը պահպանված է ձևում։ Փակեք ձևը և բացեք արդի գրառումը։','Запись изменилась. Ваш ввод сохранён в форме. Закройте форму и откройте актуальную запись перед повтором.','Record changed. Your input is kept in the form. Close the form and open the current record before retrying.'],
 net:['Կապը խզվեց։ Արդյունքն անհայտ է — կրկնեք նույն տվյալներով։','Связь прервана, результат неизвестен. Повторите — повтор безопасен.','Connection lost; result unknown. Retry safely with the same data.'],
 fail:['Չհաջողվեց պահպանել','Не удалось сохранить','Could not save'],
  ineligible:['Աշխատակցի լիազորությունը չի ընդգրկում ամբողջ միջակայքը կամ ընտրված շրջանակը։ Ստուգեք ժամերը և դերը։','Доступ сотрудника не охватывает весь период или выбранную область. Проверьте даты и назначение роли.','Employee access does not cover the entire interval or selected scope. Check dates and role assignment.'],
 rShift:['Հերթափոխը մինչև 24 ժամ','Смена до 24 часов','Shift up to 24 hours'],
 rAbs:['Բացակայությունը մինչև 62 օր','Отсутствие до 62 дней','Absence up to 62 days'],
 readOnly:['Միայն դիտում։ Տեսանելի են միայն թույլատրված տվյալները։','Только просмотр; сервер показывает лишь разрешённые данные.','Read only; the server shows only what you may see.'],
} as const;
type K=keyof typeof L;
const H=3600e3;
const nextPlanningDay=()=>new Date(Date.parse(todayYerevan()+'T00:00:00Z')+24*H).toISOString().slice(0,10);
const toIso=(v:string)=>v+':00+04:00';
const fromIso=(s:string)=>new Date(Date.parse(s)+4*H).toISOString().slice(0,16);
const valid=(v:string)=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)&&!isNaN(Date.parse(toIso(v)));
const span=(a:string,b:string)=>valid(a)&&valid(b)?Date.parse(toIso(b))-Date.parse(toIso(a)):NaN;
const uuid=()=>crypto.randomUUID();
const status=(e:unknown)=>(e as {status?:number})?.status;

export default function StaffAvailability({c,language}:{c:RoleContext;language:Language}){
 const t=(k:K)=>L[k][language==='hy'?0:language==='ru'?1:2];
 const [units,setUnits]=useState<AvailabilityUnit[]>(),[unitsErr,setUnitsErr]=useState(false),[unitsRev,setUnitsRev]=useState(0),[unit,setUnit]=useState('');
 const [editing,setEditing]=useState(false);
 useEffect(()=>{
  const ab=new AbortController();setUnits(undefined);setUnitsErr(false);
   getAvailabilityOptions({signal:ab.signal}).then(u=>{if(ab.signal.aborted)return;setUnits(u);setUnit(p=>u.some(x=>x.id===p)?p:u[0]?.id??'')}).catch(()=>{if(!ab.signal.aborted)setUnitsErr(true)});
  return()=>ab.abort();
 },[c.id,unitsRev]);
 return <section className="p-card vc-calendar sa-root" data-testid="staff-availability">
  <header><h3>{t('title')}</h3><span>Asia/Yerevan · +04:00</span></header>
  <p className="sa-note" role="note">{t('note')}</p>
  {unitsErr?<p className="p-error" role="alert">{t('error')} <button type="button" className="p-button" onClick={()=>setUnitsRev(n=>n+1)}>{t('retry')}</button></p>
  :!units?<div className="sa-skel" role="status" aria-label={t('loading')}><i/><i/><i/></div>
  :!units.length?<p className="sa-empty">{t('noUnits')}</p>
  :<>
    <div className="vc-filters"><label>{t('unit')}<select disabled={editing} data-testid="select-unit" value={unit} onChange={e=>setUnit(e.target.value)}>{units.map(u=><option key={u.id} value={u.id}>{u.building_name} · {u.number}</option>)}</select></label></div>
    {unit&&<Panel key={c.id+':'+unit} unit={units.find(u=>u.id===unit)!} t={t} language={language} onEditing={setEditing}/>}
  </>}
 </section>;
}

function Panel({unit,t,language,onEditing}:{unit:AvailabilityUnit;t:(k:K)=>string;language:Language;onEditing:(v:boolean)=>void}){
 const d=nextPlanningDay();
 const [from,setFrom]=useState(d+'T09:00'),[to,setTo]=useState(d+'T10:00'),[rev,setRev]=useState(0);
 const [res,setRes]=useState<{q:string;data:Data}>(),[err,setErr]=useState(false);
 const ms=span(from,to),ok=ms>0&&ms<=62*24*H,q=from+'|'+to;
 useEffect(()=>{
  setErr(false);if(!ok)return;
  const ab=new AbortController();let serial=0;
   const load=async()=>{const n=++serial;try{const data=await getStaffAvailability({unitId:unit.id,from:toIso(from),to:toIso(to)},{signal:ab.signal});if(n===serial&&!ab.signal.aborted){setRes({q,data});setErr(false)}}catch(e){if(n===serial&&!ab.signal.aborted){setErr(true);if([401,403,404].includes(status(e)??0)){setRes(undefined);onEditing(false)}}}};
  void load();const r=()=>{if(document.visibilityState==='visible'&&navigator.onLine)void load()};
  const id=setInterval(r,30000);addEventListener('focus',r);addEventListener('online',r);
  return()=>{ab.abort();clearInterval(id);removeEventListener('focus',r);removeEventListener('online',r)};
 },[unit.id,from,to,rev]);
 const data=res?.q===q?res.data:undefined;
 const fmt=(s:string)=>new Intl.DateTimeFormat(language,{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Yerevan'}).format(new Date(s));
 const [form,setForm]=useState<{block?:AvailabilityBlock}|null>(null),[msg,setMsg]=useState('');
 useEffect(()=>{onEditing(!!form);return()=>onEditing(false)},[form,onEditing]);
 const names=new Map(data?.people.map(p=>[p.id,p.name]));
 return <div className="sa-panel">
  <div className="vc-filters">
   <label>{t('from')}<input disabled={!!form} data-testid="input-from" type="datetime-local" value={from} onChange={e=>setFrom(e.target.value)}/></label>
   <label>{t('to')}<input disabled={!!form} data-testid="input-to" type="datetime-local" value={to} onChange={e=>setTo(e.target.value)}/></label>
   <button type="button" className="p-button" data-testid="button-refresh-availability" onClick={()=>setRev(n=>n+1)} disabled={!ok}>{t('refresh')}</button>
  </div>
  {msg&&<p className="sa-ok" role="status">{msg} <button type="button" onClick={()=>setMsg('')} aria-label={t('close')}>×</button></p>}
  {!ok?<p role="alert" className="p-error">{t('invalid')}</p>:err&&!data?<p role="alert" className="p-error">{t('error')} <button type="button" className="p-button" onClick={()=>setRev(n=>n+1)}>{t('retry')}</button></p>:!data?<div className="sa-skel" role="status" aria-label={t('loading')}><i/><i/><i/></div>:<>
   {err&&<p role="alert" className="p-error">{t('error')}</p>}
   {!data.people.length?<p className="sa-empty">{t('noPeople')}</p>:<ul className="sa-people">{data.people.map(p=><li key={p.id} data-testid={'row-person-'+p.id}><span className="sa-avatar">{p.name.slice(0,1)}</span><strong>{p.name}</strong><span className={'sa-badge sa-'+p.status}>{t(p.status)}</span><small>{t('visits')}: {p.visitCount}</small></li>)}</ul>}
   <div className="sa-head"><h4>{t('blocks')}</h4>{data.canManage&&!form&&<button type="button" className="p-button" data-testid="button-add-block" onClick={()=>{setMsg('');setForm({})}}>{t('add')}</button>}</div>
   {!data.canManage&&<p className="sa-note">{t('readOnly')}</p>}
   {form&&<BlockForm key={form.block?.id??'new'} block={form.block} initialStart={from} initialEnd={fromIso(new Date(Math.min(Date.parse(toIso(from))+9*H,Date.parse(toIso(to)))).toISOString())} unit={unit} data={data} t={t} close={()=>setForm(null)} done={m=>{setForm(null);setMsg(m);setRev(n=>n+1)}} refresh={()=>setRev(n=>n+1)}/>}
   {!data.blocks.length?<p className="sa-empty">{t('noBlocks')}</p>:<ul className="sa-blocks">{data.blocks.map(b=><li key={b.id} className={b.cancelled_at?'sa-cancelled':''} data-testid={'row-block-'+b.id}>
    <span className={'sa-kind sa-k-'+b.kind}>{t(b.kind)}</span>
    <strong>{names.get(b.technician_id)??b.technician_id.slice(0,8)}</strong>
    <span>{fmt(b.starts_at)} — {fmt(b.ends_at)}</span>
    <small>{b.unit_id?t('sUnit'):t('sBuilding')}{b.cancelled_at?' · '+t('cancelled'):''}</small>
    {data.canManage&&b.canEdit&&!b.cancelled_at&&<button disabled={!!form} type="button" className="p-button" data-testid={'button-edit-block-'+b.id} onClick={()=>{setMsg('');setForm({block:b})}}>{t('edit')}</button>}
   </li>)}</ul>}
  </>}
 </div>;
}

function BlockForm({block,unit,data,t,close,done,refresh,initialStart,initialEnd}:{block?:AvailabilityBlock;unit:AvailabilityUnit;data:Data;t:(k:K)=>string;close:()=>void;done:(m:string)=>void;refresh:()=>void;initialStart:string;initialEnd:string}){
 const [person,setPerson]=useState(block?.technician_id??''),[kind,setKind]=useState<'shift'|'absence'>(block?.kind??'shift'),[scope,setScope]=useState<'building'|'unit'>(block?(block.unit_id?'unit':'building'):'unit');
 const [start,setStart]=useState(block?fromIso(block.starts_at):initialStart),[end,setEnd]=useState(block?fromIso(block.ends_at):initialEnd);
 const [busy,setBusy]=useState(false),[err,setErr]=useState(''),[confirm,setConfirm]=useState(false);
 const attempt=useRef<{p:string;key:string}|undefined>(undefined);
 const ms=span(start,end),limit=kind==='shift'?24*H:62*24*H;
 const problem=!person?t('person'):!(ms>0)?t('invalid'):ms>limit?t(kind==='shift'?'rShift':'rAbs'):'';
 const keyFor=(p:string)=>{if(attempt.current?.p!==p)attempt.current={p,key:uuid()};return attempt.current.key};
 async function run(action:'save'|'cancel'){
  if(busy)return;if(action==='save'&&problem){setErr(problem);return}
  setBusy(true);setErr('');
  const opts={headers:getCsrfHeaders()};
  try{
   if(!block){const body={unitId:unit.id,technicianId:person,scope:data.canManageBuilding?scope:'unit' as const,kind,startsAt:toIso(start),endsAt:toIso(end)};await createAvailabilityBlock({key:keyFor(JSON.stringify(body)),...body},opts)}
   else if(action==='save'){const body={version:block.version,action:'update' as const,kind,startsAt:toIso(start),endsAt:toIso(end)};await changeAvailabilityBlock(block.id,{key:keyFor(block.id+JSON.stringify(body)),...body},opts)}
   else{const body={version:block.version,action:'cancel' as const};await changeAvailabilityBlock(block.id,{key:keyFor(block.id+JSON.stringify(body)),...body},opts)}
   attempt.current=undefined;done(t(action==='cancel'?'cancelledOk':'saved'));
  }catch(e){
   const s=status(e);
   if((e as {data?:{error?:string}})?.data?.error==='ineligible_technician')setErr(t('ineligible'));
   else if(s===409){setErr(t('stale'));refresh()}
   else if(!s||s>=500)setErr(t('net'));
   else setErr(t('fail')+' ('+s+')');
  }finally{setBusy(false);setConfirm(false)}
 }
 return <form className="sa-form" data-testid="form-block" onSubmit={e=>{e.preventDefault();void run('save')}}>
  <h4>{block?t('editT'):t('add')}</h4>
  <div className="vc-filters">
   <label>{t('person')}<select data-testid="select-person" value={person} disabled={busy||!!block} onChange={e=>setPerson(e.target.value)}><option value="">—</option>{data.people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   <label>{t('kind')}<select disabled={busy} data-testid="select-kind" value={kind} onChange={e=>setKind(e.target.value as 'shift'|'absence')}><option value="shift">{t('shift')}</option><option value="absence">{t('absence')}</option></select></label>
   <label>{t('scope')}<select data-testid="select-scope" value={data.canManageBuilding?scope:'unit'} disabled={busy||!!block||!data.canManageBuilding} onChange={e=>setScope(e.target.value as 'building'|'unit')}><option value="unit">{t('sUnit')} · {unit.number}</option>{(data.canManageBuilding||block?.unit_id===null)&&<option value="building">{t('sBuilding')} · {unit.building_name}</option>}</select></label>
   <label>{t('start')} (+04:00)<input disabled={busy} data-testid="input-block-start" type="datetime-local" value={start} onChange={e=>setStart(e.target.value)} required/></label>
   <label>{t('end')} (+04:00)<input disabled={busy} data-testid="input-block-end" type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)} required/></label>
  </div>
  <p className="sa-note">{t(kind==='shift'?'rShift':'rAbs')}</p>
  {err&&<p className="p-error" role="alert" data-testid="text-block-error">{err}</p>}
  <div className="sa-actions">
   <button className="p-button sa-primary" data-testid="button-save-block" disabled={busy}>{busy?t('saving'):t('save')}</button>
   <button type="button" className="p-button" onClick={close} disabled={busy}>{t('close')}</button>
   {block&&(!confirm?<button type="button" className="p-button sa-danger" data-testid="button-cancel-block" disabled={busy} onClick={()=>setConfirm(true)}>{t('cancel')}</button>
   :<><button type="button" className="p-button sa-danger" data-testid="button-confirm-cancel" disabled={busy} onClick={()=>void run('cancel')}>{t('confirm')}</button><button type="button" className="p-button" disabled={busy} onClick={()=>setConfirm(false)}>{t('keep')}</button></>)}
  </div>
 </form>;
}
