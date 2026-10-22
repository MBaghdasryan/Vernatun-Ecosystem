import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {CalendarClock,Check,Clock3,Edit3,Plus,RefreshCw,X} from 'lucide-react';
import {request} from './client';
import type {Language} from './i18n';
import type {RoleContext} from './types';
import {useMe,type Row} from './phase5-ui';
import './platform-support-meetings.css';

type Meeting=Row&{id:string;title:string;starts_at:string;ends_at:string;timezone:string;status:'scheduled'|'confirmed'|'completed'|'cancelled';version:number;created_by:string;organization_name?:string|null};
type Organization={id:string;name:string};
type Copy={
 title:string;new:string;loading:string;failed:string;retry:string;none:string;meetingTitle:string;organization:string;
 noOrganization:string;start:string;end:string;timezone:string;location:string;notes:string;save:string;cancel:string;
 edit:string;confirm:string;complete:string;scheduled:string;confirmed:string;completed:string;cancelled:string;
 saving:string;internal:string;hint:string;conflict:string;future:string;badTime:string;myMeeting:string;
};
const TEXT:Record<Language,Copy>={
 hy:{title:'Ներքին հանդիպումների ժամանակացույց',new:'Պլանավորել հանդիպում',loading:'Բեռնվում է…',failed:'Չհաջողվեց բեռնել հանդիպումները։',retry:'Կրկնել',none:'Այս ժամանակահատվածում հանդիպումներ չկան։',meetingTitle:'Թեմա',organization:'Կազմակերպություն',noOrganization:'Ներքին հանդիպում',start:'Սկիզբ',end:'Ավարտ',timezone:'Ժամային գոտի',location:'Վայր կամ ներքին նշում',notes:'Նշումներ',save:'Պահպանել',cancel:'Չեղարկել',edit:'Խմբագրել',confirm:'Հաստատել',complete:'Նշել ավարտված',scheduled:'Պլանավորված',confirmed:'Հաստատված',completed:'Ավարտված',cancelled:'Չեղարկված',saving:'Պահպանվում է…',internal:'Միայն ներքին պլանավորում․ հրավերներ կամ նամակներ չեն ուղարկվում։',hint:'Ժամանակը ցուցադրվում է նշված ժամային գոտով։ Ավարտված և չեղարկված գրառումները մնում են պատմության մեջ։',conflict:'Կազմակերպչի օրացույցում այս ժամին արդեն հանդիպում կա։',future:'Ընտրեք ապագա ժամ, առնվազն 5 րոպե հետո։',badTime:'Սկզբի և ավարտի ժամանակը ստուգեք (առավելագույնը՝ 12 ժամ)։',myMeeting:'Իմ հանդիպումը'},
 ru:{title:'Расписание внутренних встреч поддержки',new:'Запланировать встречу',loading:'Загрузка…',failed:'Не удалось загрузить встречи.',retry:'Повторить',none:'В этом периоде встреч нет.',meetingTitle:'Тема',organization:'Организация',noOrganization:'Внутренняя встреча',start:'Начало',end:'Окончание',timezone:'Часовой пояс',location:'Место или внутренняя пометка',notes:'Заметки',save:'Сохранить',cancel:'Отменить',edit:'Изменить',confirm:'Подтвердить',complete:'Отметить завершённой',scheduled:'Запланирована',confirmed:'Подтверждена',completed:'Завершена',cancelled:'Отменена',saving:'Сохранение…',internal:'Только внутреннее планирование: приглашения и письма не отправляются.',hint:'Время показано в выбранном часовом поясе. Завершённые и отменённые встречи остаются в истории.',conflict:'В календаре организатора уже есть встреча на это время.',future:'Выберите будущее время, минимум через 5 минут.',badTime:'Проверьте начало и окончание (не более 12 часов).',myMeeting:'Моя встреча'},
 en:{title:'Internal support meeting schedule',new:'Plan a meeting',loading:'Loading…',failed:'Could not load meetings.',retry:'Retry',none:'No meetings in this period.',meetingTitle:'Topic',organization:'Organization',noOrganization:'Internal meeting',start:'Start',end:'End',timezone:'Time zone',location:'Location or internal note',notes:'Notes',save:'Save',cancel:'Cancel',edit:'Edit',confirm:'Confirm',complete:'Mark completed',scheduled:'Scheduled',confirmed:'Confirmed',completed:'Completed',cancelled:'Cancelled',saving:'Saving…',internal:'Internal planning only: no invitations or emails are sent.',hint:'Times use the selected time zone. Completed and cancelled entries remain in history.',conflict:'The organizer already has a meeting at that time.',future:'Choose a future time, at least 5 minutes from now.',badTime:'Check the start and end (12-hour maximum).',myMeeting:'My meeting'}
};
const pad=(v:number)=>String(v).padStart(2,'0');
function valueAt(date:Date,zone:string){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
 return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function instantAt(value:string,zone:string){
 const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
 if(!match)throw new Error('bad_time');
 const target=Date.UTC(+match[1],+match[2]-1,+match[3],+match[4],+match[5]);let guess=target;
 for(let i=0;i<4;i++){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess)).map(x=>[x.type,x.value]));
  const shown=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute);
  const correction=target-shown;if(!correction)break;guess+=correction;
 }
 if(valueAt(new Date(guess),zone)!==value)throw new Error('bad_time');
 return new Date(guess).toISOString();
}
const futureStart=(zone:string)=>valueAt(new Date(Date.now()+60*60_000),zone);
export default function PlatformSupportMeetings({c,language}:{c:RoleContext;language:Language}){
 const t=TEXT[language]??TEXT.en,me=useMe(),all=c.permissions.includes('organizations.manage')||c.permissions.includes('support.assign');
 const zone=useMemo(()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Yerevan'}catch{return 'Asia/Yerevan'}},[]);
 const [rows,setRows]=useState<Meeting[]>(),[organizations,setOrganizations]=useState<Organization[]>([]);
 const [failed,setFailed]=useState(false),[orgFailed,setOrgFailed]=useState(false),[revision,setRevision]=useState(0);
 const [edit,setEdit]=useState<Meeting|undefined>(),[creating,setCreating]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const [form,setForm]=useState({title:'',organizationId:'',startsAt:futureStart(zone),endsAt:valueAt(new Date(Date.now()+90*60_000),zone),timezone:zone,location:'',notes:''});
 useEffect(()=>{let live=true;setRows(undefined);setFailed(false);void request<{meetings:Meeting[]}>('/platform/implementation-meetings').then(r=>{if(live)setRows(r.meetings)}).catch(()=>{if(live)setFailed(true)});return()=>{live=false}},[c.id,revision]);
 useEffect(()=>{let live=true;const path=c.permissions.includes('organizations.read')?'/organizations':'/platform/onboarding';void request<Row[]>(path).then(data=>{if(!live)return;const unique=new Map<string,Organization>();for(const r of data)if(r.id&&r.name)unique.set(r.id,{id:r.id,name:r.name});else if(r.organization_id&&r.organization_name)unique.set(r.organization_id,{id:r.organization_id,name:r.organization_name});setOrganizations([...unique.values()].sort((a,b)=>a.name.localeCompare(b.name)))}).catch(()=>{if(live)setOrgFailed(true)});return()=>{live=false}},[c.id]);
 const start=(row?:Meeting)=>{
  setError('');setEdit(row);setCreating(!row);
  setForm(row?{title:row.title,organizationId:row.organization_id??'',startsAt:valueAt(new Date(row.starts_at),row.timezone),endsAt:valueAt(new Date(row.ends_at),row.timezone),timezone:row.timezone,location:row.location??'',notes:row.notes??''}:
   {title:'',organizationId:'',startsAt:futureStart(zone),endsAt:valueAt(new Date(Date.now()+90*60_000),zone),timezone:zone,location:'',notes:''});
 };
 const submit=async(e:FormEvent)=>{e.preventDefault();if(saving)return;setSaving(true);setError('');try{
  const startsAt=instantAt(form.startsAt,form.timezone),endsAt=instantAt(form.endsAt,form.timezone);
  if(Date.parse(endsAt)<=Date.parse(startsAt)||Date.parse(endsAt)-Date.parse(startsAt)>12*60*60_000)throw new Error('bad_duration');
  if(Date.parse(startsAt)<Date.now()+5*60_000)throw new Error('past');
  if(edit){
   await request(`/platform/implementation-meetings/${edit.id}/change`,'POST',{key:crypto.randomUUID(),version:edit.version,action:'edit',title:form.title,organizationId:form.organizationId||null,startsAt,endsAt,timezone:form.timezone,location:form.location,notes:form.notes});
  }else{
   await request('/platform/implementation-meetings','POST',{key:crypto.randomUUID(),title:form.title,organizationId:form.organizationId||null,startsAt,endsAt,timezone:form.timezone,location:form.location,notes:form.notes});
  }
  setEdit(undefined);setCreating(false);setRevision(v=>v+1);
 }catch(e:any){setError(e?.message==='meeting_schedule_conflict'?t.conflict:e?.message==='meeting_must_be_future'?t.future:e?.message==='bad_time'||e?.message==='bad_duration'?t.badTime:language==='hy'?'Չհաջողվեց պահպանել հանդիպումը։':language==='ru'?'Не удалось сохранить встречу.':'Could not save the meeting.')}
 finally{setSaving(false)}};
 async function act(row:Meeting,action:'confirm'|'cancel'|'complete'){
  if(saving)return;setSaving(true);setError('');try{await request(`/platform/implementation-meetings/${row.id}/change`,'POST',{key:crypto.randomUUID(),version:row.version,action});setRevision(v=>v+1)}
  catch{setError(language==='hy'?'Չհաջողվեց փոխել հանդիպման վիճակը։':language==='ru'?'Не удалось изменить состояние встречи.':'Could not update the meeting status.')}
  finally{setSaving(false)}
 }
 const canManage=all||rows?.some(r=>r.created_by===me);
 return <section className="p-card psm" aria-labelledby="psm-title">
  <header className="psm-head"><div><h2 id="psm-title"><CalendarClock size={20}/>{t.title}</h2><p className="p5-muted">{t.internal}</p></div><button className="p-button orange" disabled={saving} onClick={()=>start()}><Plus size={16}/>{t.new}</button></header>
  <p className="p5-muted">{t.hint}</p>
  {error&&<p className="psm-error" role="alert">{error}</p>}
  {(creating||edit)&&<form className="psm-form" onSubmit={submit}>
   <label>{t.meetingTitle}<input required minLength={2} maxLength={200} value={form.title} disabled={saving} onChange={e=>setForm({...form,title:e.target.value})}/></label>
   <label>{t.organization}<select value={form.organizationId} disabled={saving} onChange={e=>setForm({...form,organizationId:e.target.value})}><option value="">{t.noOrganization}</option>{organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
   <div className="psm-grid"><label>{t.start}<input type="datetime-local" required value={form.startsAt} disabled={saving} onChange={e=>setForm({...form,startsAt:e.target.value})}/></label><label>{t.end}<input type="datetime-local" required value={form.endsAt} disabled={saving} onChange={e=>setForm({...form,endsAt:e.target.value})}/></label></div>
   <label>{t.timezone}<input required maxLength={100} value={form.timezone} disabled={saving} onChange={e=>setForm({...form,timezone:e.target.value})}/></label>
   <label>{t.location}<input maxLength={500} value={form.location} disabled={saving} onChange={e=>setForm({...form,location:e.target.value})}/></label>
   <label>{t.notes}<textarea maxLength={8000} value={form.notes} disabled={saving} onChange={e=>setForm({...form,notes:e.target.value})}/></label>
   {orgFailed&&<p className="p5-muted">{language==='hy'?'Կազմակերպությունների ցանկը հասանելի չէ։':language==='ru'?'Список организаций недоступен.':'Organization list unavailable.'}</p>}
   <div className="psm-actions"><button className="p-button orange" disabled={saving}>{saving?t.saving:t.save}</button><button type="button" className="p-button" disabled={saving} onClick={()=>{setEdit(undefined);setCreating(false);setError('')}}>{t.cancel}</button></div>
  </form>}
  {failed?<div role="alert" className="psm-state">{t.failed} <button className="rh-link" onClick={()=>setRevision(v=>v+1)}><RefreshCw size={14}/>{t.retry}</button></div>:
   !rows?<p role="status" className="psm-state">{t.loading}</p>:!rows.length?<p className="psm-state">{t.none}</p>:
   <ol className="psm-list">{rows.map(row=><li key={row.id} className={'psm-item psm-'+row.status}>
    <div className="psm-main"><div><strong>{row.title}</strong><span className="psm-status">{t[row.status]}</span></div>
     <time dateTime={row.starts_at}>{new Intl.DateTimeFormat(language,{timeZone:row.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(row.starts_at))} – {new Intl.DateTimeFormat(language,{timeZone:row.timezone,timeStyle:'short'}).format(new Date(row.ends_at))} · {row.timezone}</time>
     <span>{row.organization_name||t.noOrganization}{row.location?' · '+row.location:''}</span>{row.notes&&<p>{row.notes}</p>}
    </div>
    {canManage&&(all||row.created_by===me)&&<div className="psm-row-actions">
      {['scheduled','confirmed'].includes(row.status)&&<button type="button" className="p-button" disabled={saving} onClick={()=>start(row)}><Edit3 size={14}/>{t.edit}</button>}
      {row.status==='scheduled'&&<button type="button" className="p-button" disabled={saving} onClick={()=>void act(row,'confirm')}><Check size={14}/>{t.confirm}</button>}
      {['scheduled','confirmed'].includes(row.status)&&<button type="button" className="p-button" disabled={saving} onClick={()=>void act(row,'cancel')}><X size={14}/>{t.cancel}</button>}
      {row.status==='confirmed'&&Date.parse(row.ends_at)<=Date.now()&&<button type="button" className="p-button" disabled={saving} onClick={()=>void act(row,'complete')}><Clock3 size={14}/>{t.complete}</button>}
     </div>}
   </li>)}</ol>}
 </section>;
}
