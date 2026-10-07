import {useEffect,useState} from 'react';
import {listOperationalVisits} from '@workspace/api-client-react';
import type {Language} from './i18n';
import type {RoleContext} from './types';
import {calendarWindow,conflictingVisits,todayYerevan} from './visit-calendar';
import './visit-calendar.css';

const labels={
 title:['Այցերի ժամանակացույց','Расписание визитов','Visit schedule'],
 from:['Սկսած','С','From'],to:['Մինչև','По','Through'],
 building:['Շենք','Здание','Building'],executor:['Կատարող','Исполнитель','Executor'],
 all:['Բոլորը','Все','All'],today:['Այսօր','Сегодня','Today'],
 refresh:['Թարմացնել','Обновить','Refresh'],loading:['Բեռնվում է…','Загрузка…','Loading…'],
 empty:['Այցեր չկան','Нет визитов по выбранным условиям','No matching visits'],
 error:['Չհաջողվեց բեռնել։ Փորձեք ավելի կարճ ժամանակահատված։','Не удалось загрузить. Повторите или сократите период.','Could not load. Retry or choose a shorter period.'],
 invalid:['Ընտրեք մինչև 62 օր ժամանակահատված։','Выберите период до 62 дней; конец не раньше начала.','Choose up to 62 days, ending on or after the start.'],
 overlap:['Այցերը համընկնում են','Визиты пересекаются','Overlapping visits'],
 unassigned:['Կատարող նշանակված չէ','Исполнитель не назначен','No executor assigned'],
 proposed:['Առաջարկված','Предложен','Proposed'],confirmed:['Հաստատված','Подтверждён','Confirmed'],
 note:['Միայն հասանելի այցերը։ Հերթափոխերն ու բացակայությունները չեն հաշվարկվում։','Только доступные вам визиты. Смены и отсутствия не учитываются; отсутствие визитов не означает доступность сотрудника.','Only visits you may access. Shifts and absences are not included; no visits does not mean an employee is available.'],
 count:['Այցեր','Визитов','Visits'],
} as const;
type Visit={id:string;request_id:string;subject:string;status:string;starts_at:string;ends_at:string;building_id:string;building_name:string;number?:string;technician_id:string|null;technician_name:string|null};
export default function VisitCalendar({c,language,onOpen}:{c:RoleContext;language:Language;onOpen:(id:string)=>void}){
 const t=(key:keyof typeof labels)=>labels[key][language==='hy'?0:language==='ru'?1:2];
 const query=new URLSearchParams(location.pathname==='/hayat/calendar'?location.search:'');
 const [from,setFrom]=useState(()=>query.get('from')??todayYerevan()),[to,setTo]=useState(()=>query.get('to')??todayYerevan()),[building,setBuilding]=useState(()=>query.get('building')??''),[executor,setExecutor]=useState(()=>query.get('executor')??''),[revision,setRevision]=useState(0);
 const [result,setResult]=useState<{scope:string;range:string;rows:Visit[]}>(),[error,setError]=useState(false);
 const window=calendarWindow(from,to),range=from+'/'+to;
 useEffect(()=>{
  if(location.pathname!=='/hayat/calendar')return;
  const params=new URLSearchParams({from,to});
  if(building)params.set('building',building);
  if(executor)params.set('executor',executor);
  history.replaceState(null,'','/hayat/calendar?'+params);
 },[from,to,building,executor]);
 useEffect(()=>{
  setResult(undefined);setError(false);
  if(!window)return;
  let active=true,serial=0;const abort=new AbortController();
  const load=async()=>{
   const turn=++serial;
   try{const rows=await listOperationalVisits(window,{signal:abort.signal});if(active&&turn===serial){setResult({scope:c.id,range,rows:rows as Visit[]});setError(false)}}
   catch{if(active&&turn===serial){setError(true);setResult(undefined)}}
  };
  void load();const refresh=()=>{if(document.visibilityState==='visible')void load()};
  const timer=globalThis.setInterval(refresh,30000);globalThis.addEventListener('focus',refresh);globalThis.addEventListener('online',refresh);
  return()=>{active=false;abort.abort();clearInterval(timer);globalThis.removeEventListener('focus',refresh);globalThis.removeEventListener('online',refresh)};
 },[c.id,from,to,revision]);
 const rows=result?.scope===c.id&&result.range===range?result.rows:undefined;
 const collisions=conflictingVisits(rows??[]);
 const visible=rows?.filter(v=>(!building||v.building_id===building)&&(!executor||(executor==='unassigned'?!v.technician_id:v.technician_id===executor)));
 const buildings=[...new Map(rows?.map(v=>[v.building_id,v.building_name])??[])] ;
 const people=[...new Map(rows?.filter(v=>v.technician_id).map(v=>[v.technician_id!,v.technician_name??t('unassigned')])??[])];
 const date=(s:string)=>new Intl.DateTimeFormat(language,{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Yerevan'}).format(new Date(s));
 return <section className="p-card vc-calendar">
  <header><h3>{t('title')}</h3><span>Asia/Yerevan</span></header>
  <div className="vc-filters">
   <label>{t('from')}<input type="date" value={from} onChange={e=>{setFrom(e.target.value);setBuilding('');setExecutor('')}}/></label>
   <label>{t('to')}<input type="date" value={to} onChange={e=>{setTo(e.target.value);setBuilding('');setExecutor('')}}/></label>
   <label>{t('building')}<select value={building} onChange={e=>setBuilding(e.target.value)}><option value="">{t('all')}</option>{building&&!buildings.some(([id])=>id===building)&&<option value={building}>{t('empty')}</option>}{buildings.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
   <label>{t('executor')}<select value={executor} onChange={e=>setExecutor(e.target.value)}><option value="">{t('all')}</option><option value="unassigned">{t('unassigned')}</option>{executor&&executor!=='unassigned'&&!people.some(([id])=>id===executor)&&<option value={executor}>{t('empty')}</option>}{people.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
   <button type="button" className="p-button" onClick={()=>{setFrom(todayYerevan());setTo(todayYerevan());setBuilding('');setExecutor('')}}>{t('today')}</button>
   <button type="button" className="p-button" onClick={()=>setRevision(n=>n+1)}>{t('refresh')}</button>
  </div>
  <p className="vc-note">{t('note')}</p>
  {!window?<p role="alert">{t('invalid')}</p>:error?<p role="alert" className="p-error">{t('error')}</p>:!rows?<p role="status">{t('loading')}</p>:<>
   <p>{t('count')}: {visible!.length} / {rows.length}</p>
   {!visible!.length?<p>{t('empty')}</p>:visible!.map(v=><button key={v.id} type="button" className="vc-visit" onClick={()=>onOpen(v.request_id)}>
    <strong>{v.subject}</strong><span>{date(v.starts_at)} — {date(v.ends_at)}</span>
    <span>{v.building_name}{v.number?' · '+v.number:''} · {v.technician_name??t('unassigned')}</span>
    <span>{t(v.status==='confirmed'?'confirmed':'proposed')}{collisions.has(v.id)?' · '+t('overlap'):''}</span>
   </button>)}
  </>}
 </section>;
}
