import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {MaintenancePlanInput} from '@workspace/api-client-react';
import {request,ApiClientError} from './client';
import {usePolling} from './Phase2';
import {date,type Language} from './i18n';
import type {RoleContext} from './types';
type Row=Record<string,any>;
const L={
 plans:['Սպասարկման պլաններ','Планы обслуживания','Maintenance plans'],create:['Ստեղծել պլան','Создать план','Create plan'],title:['Վերնագիր','Название','Title'],due:['Ժամկետ','Срок','Due date'],
 category:['Կատեգորիա','Категория','Category'],frequency:['Հաճախականություն','Периодичность','Frequency'],interval:['Միջակայք (օրեր)','Интервал (дни)','Interval (days)'],priority:['Առաջնահերթություն','Приоритет','Priority'],
 instructions:['Հրահանգներ','Инструкции','Instructions'],checklist:['Ստուգաթերթ՝ մեկ կետ յուրաքանչյուր տողում','Чек-лист: один пункт в строке','Checklist: one item per line'],
 active:['Ակտիվ','Активен','Active'],automatic:['Ավտոմատ ստեղծում','Автоматическое создание','Automatic generation'],
 once:['Մեկ անգամ','Однократно','Once'],daily:['Ամեն օր','Ежедневно','Daily'],weekly:['Շաբաթական','Еженедельно','Weekly'],monthly:['Ամսական','Ежемесячно','Monthly'],quarterly:['Եռամսյակային','Ежеквартально','Quarterly'],semiannual:['Կիսամյակային','Раз в полгода','Semiannual'],annual:['Տարեկան','Ежегодно','Annual'],custom:['Այլ','Свой интервал','Custom'],
 low:['Ցածր','Низкий','Low'],normal:['Սովորական','Обычный','Normal'],high:['Բարձր','Высокий','High'],urgent:['Շտապ','Срочный','Urgent'],emergency:['Վթարային','Аварийный','Emergency'],
 save:['Պահպանել','Сохранить','Save'],generate:['Ստեղծել հայտ','Создать заявку','Generate request'],events:['Կատարումներ','Выполнения','Runs'],noEvents:['Կատարումներ դեռ չկան','Выполнений пока нет','No runs yet'],
 noPlans:['Պլաններ չկան','Планов пока нет','No plans yet'],loading:['Բեռնվում է…','Загрузка…','Loading…'],error:['Գործողությունը չհաջողվեց։ Ստուգեք դաշտերը։','Действие не выполнено. Проверьте поля.','Action failed. Check the fields.'],
 retry:['Կրկնել','Повторить','Retry'],conflict:['Պլանը փոխվել է։ Մերժեք փոփոխությունները և թարմացրեք։','План изменён. Сбросьте правки и обновите.','Plan changed elsewhere. Discard edits and refresh.'],discard:['Չեղարկել','Сбросить','Discard'],
 changed:['Սերվերի տարբերակը նորացել է','На сервере есть новая версия','A newer version exists on the server'],readonly:['Ավարտված պլան՝ միայն դիտման համար','Завершённый план, только чтение','Completed plan, read only'],
 needCat:['Ակտիվացնելու համար ընտրեք կատեգորիա','Для активации выберите категорию','Choose a category to activate'],created:['Պլանը ստեղծված է','План создан','Plan created'],generated:['Հայտը ստեղծված է','Заявка создана','Request generated'],replayed:['Արդեն ստեղծված էր','Уже была создана','Already generated'],
 open:['Բացել հայտը','Открыть заявку','Open request'],manual:['Ձեռքով','Вручную','Manual'],note:['Ղեկավարի հաստատումը փակում է աշխատանքը։ Նշագրով ավարտ չկա։','Работу закрывает независимое одобрение управляющего. Отметки «выполнено» нет.','Independent manager approval closes the work. There is no complete checkbox.'],
 status:['Կարգավիճակ','Статус','Status'],technician:['Կատարող','Исполнитель','Technician'],report:['Հաշվետվություն','Отчёт','Report'],photos:['Լուսանկարներ','Фото','Photos'],queued:['Հերթում','В очереди','Queued'],new:['Նոր','Новая','New'],assigned:['Նշանակված','Назначена','Assigned'],in_progress:['Ընթացքում','В работе','In progress'],review:['Ղեկավարի ստուգում','Проверка управляющего','Manager review'],resident_review:['Բնակչի ստուգում','Проверка жителя','Resident review'],closed:['Փակված','Закрыта','Closed'],
} as const;
const FREQ=['once','daily','weekly','monthly','quarterly','semiannual','annual','custom'];
const PRI=['low','normal','high','urgent','emergency'];
export default function MaintenancePlans({c,asset,language,onChanged}:{c:RoleContext;asset:Row;language:Language;onChanged:()=>void}){
 const t=(k:string)=>(L as Record<string,readonly string[]>)[k]?.[language==='hy'?0:language==='ru'?1:2]??k;
 const can=(p:string)=>c.permissions.includes(p);
 const [plans,setPlans]=useState<Row[]>(asset.plans??[]);const [cats,setCats]=useState<Row[]>([]);const [catsLoading,setCatsLoading]=useState(true);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [ok,setOk]=useState('');const [busy,setBusy]=useState(false);
 const [drafts,setDrafts]=useState<Record<string,Row>>({});const [freq,setFreq]=useState('once');const [open,setOpen]=useState<string>();const [events,setEvents]=useState<Record<string,Row[]|'error'>>({});
 const ctx=useRef(0);const key=asset.id+'|'+c.id;const curKey=useRef(key);curKey.current=key;const busyRef=useRef(false);
 const fail=(e:unknown)=>{setOk('');setError(t(e instanceof ApiClientError&&e.code==='stale_version'?'conflict':'error')+(e instanceof ApiClientError&&e.code!=='stale_version'?' ('+e.code+')':''))};
 async function refresh(){const k=curKey.current;const n=ctx.current;try{const list=await request<Row[]>('/assets');if(k!==curKey.current||n!==ctx.current)return;const a=list.find(x=>x.id===asset.id);if(a){setPlans(a.plans??[]);setError(e=>e)}setLoading(false)}catch(e){if(k===curKey.current&&n===ctx.current){setLoading(false);fail(e)}}}
 async function loadEvents(id:string){const k=curKey.current;try{const ev=await request<Row[]>('/maintenance/'+id+'/events');if(k===curKey.current)setEvents(o=>({...o,[id]:ev}))}catch{if(k===curKey.current)setEvents(o=>o[id]?o:({...o,[id]:'error'}))}}
 async function loadCats(){const k=curKey.current;setCatsLoading(true);try{if(can('assets.manage')){const r=await request<Row[]>('/operations/categories');if(k===curKey.current)setCats(r.filter(x=>x.active!==false))}}catch(e){if(k===curKey.current)fail(e)}finally{if(k===curKey.current)setCatsLoading(false)}}
 useEffect(()=>{ctx.current++;busyRef.current=false;setBusy(false);setCats([]);setPlans(asset.plans??[]);setDrafts({});setOpen(undefined);setEvents({});setError('');setOk('');setLoading(true);void refresh();void loadCats();return()=>{ctx.current++}},[key]);
 usePolling(()=>{void refresh();if(open)void loadEvents(open)},[key,open],false);
 async function run(fn:(live:()=>boolean)=>Promise<any>,msg:string|((r:any)=>string)){if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');setOk('');const n=ctx.current;const live=()=>n===ctx.current;try{const res=await fn(live);if(!live())return;setOk(t(typeof msg==='function'?msg(res):msg));await refresh();if(live())onChanged()}catch(e){if(live())fail(e)}finally{if(live()){busyRef.current=false;setBusy(false)}}}
 function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget;const f=new FormData(form);
  const body:MaintenancePlanInput={assetId:asset.id,title:String(f.get('title')).trim(),dueOn:String(f.get('dueOn')),categoryId:String(f.get('categoryId')),frequency:f.get('frequency') as MaintenancePlanInput['frequency'],priority:f.get('priority') as MaintenancePlanInput['priority'],instructions:String(f.get('instructions')??''),checklist:String(f.get('checklist')??'').split('\n').map(x=>x.trim()).filter(Boolean),active:f.get('active')==='on',automatic:f.get('automatic')==='on'};
  if(body.frequency==='custom')body.intervalDays=Number(f.get('intervalDays'));
   void run(async live=>{await request('/maintenance','POST',body);if(live()){form.reset();setFreq('once')}},'created')}
 const today=new Date().toISOString().slice(0,10);
 const draftOf=(p:Row)=>drafts[p.id];
 const patch=(p:Row,v:Row)=>setDrafts(o=>({...o,[p.id]:{version:o[p.id]?.version??p.version,active:p.active,automatic:p.automatic,categoryId:p.category_id??'',...o[p.id],...v}}));
 const save=(p:Row)=>{const d=draftOf(p);if(!d)return;if(d.active&&!d.categoryId){setError(t('needCat'));return}void run(async live=>{await request('/maintenance/'+p.id+'/configure','POST',{version:d.version,active:d.active,automatic:d.automatic,...(d.categoryId?{categoryId:d.categoryId}:{})});if(live())setDrafts(o=>{const n={...o};delete n[p.id];return n})},'save')};
 const toggle=(id:string)=>{if(open===id){setOpen(undefined);return}setOpen(id);void loadEvents(id)};
 const link=(ev:Row)=>'/'+(location.pathname.split('/')[1]||'')+'/requests?requestId='+ev.request_id;
 const catSel=(name:string,req:boolean,val?:string,on?:(v:string)=>void)=><select name={name} required={req} {...(on?{value:val,onChange:(e:any)=>on(e.target.value)}:{defaultValue:''})}><option value="">—</option>{cats.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>;
 return <section className="p-card p-maint" aria-busy={busy}><h3>{asset.name} · {t('plans')}</h3><p className="p-info">{t('note')}</p>
   {error&&<p className="p-error" role="alert">{error} <button className="p-button" onClick={()=>{setError('');setLoading(true);void refresh();void loadCats()}}>{t('retry')}</button></p>}{ok&&<p role="status">{ok}</p>}
  {loading&&<p role="status">{t('loading')}</p>}{!loading&&!plans.length&&<p>{t('noPlans')}</p>}
  {plans.map(p=>{const d=draftOf(p);const readonly=!!p.completed_at;const due=p.due_on&&String(p.due_on).slice(0,10)<=today;const ev=events[p.id];const stale=d&&d.version!==p.version;
   return <div className="p-card" key={p.id} data-testid={'plan-'+p.id}><h4>{p.title} · {date(p.due_on,language)}</h4><small>{t(p.frequency??'once')}{p.frequency==='custom'&&p.interval_days?' · '+p.interval_days:''} · {t(p.priority??'normal')}{p.active?' · '+t('active'):''}</small>
   {readonly?<p>{t('readonly')}{p.report?' · '+p.report:''}</p>:<>
    {can('assets.manage')&&<div className="p-edit-form"><label className="p-check-item"><input type="checkbox" checked={d?d.active:!!p.active} onChange={e=>patch(p,{active:e.target.checked})}/>{t('active')}</label><label className="p-check-item"><input type="checkbox" checked={d?d.automatic:!!p.automatic} onChange={e=>patch(p,{automatic:e.target.checked})}/>{t('automatic')}</label><label>{t('category')}{catSel('categoryId',!p.category_id&&!!(d?.active),d?d.categoryId:(p.category_id??''),v=>patch(p,{categoryId:v}))}</label>
     {stale&&<p className="p-info">{t('changed')}</p>}{d&&<><button className="p-button orange" disabled={busy} onClick={()=>save(p)}>{t('save')}</button> <button className="p-button" disabled={busy} onClick={()=>setDrafts(o=>{const n={...o};delete n[p.id];return n})}>{t('discard')}</button></>}</div>}
    {can('requests.assign')&&p.active&&due&&<button className="p-button orange" disabled={busy||!!d} onClick={()=>void run(async live=>{const r=await request<Row>('/maintenance/'+p.id+'/generate','POST',{cycleNo:p.cycle_no});if(live()){setOpen(p.id);await loadEvents(p.id)}return r},r=>r?.replayed?'replayed':'generated')}>{t('generate')}</button>}</>}
   <button className="p-button" onClick={()=>toggle(p.id)}>{t('events')}</button>
   {open===p.id&&<div>{!ev?<p role="status">{t('loading')}</p>:ev==='error'?<p className="p-error" role="alert">{t('error')} <button className="p-button" onClick={()=>void loadEvents(p.id)}>{t('retry')}</button></p>:!ev.length?<p>{t('noEvents')}</p>:ev.map(x=><div className="p-history" key={x.id}><strong>{date(x.created_at??x.due_on,language)} · {t(x.work_status??x.status??'queued')}</strong><small>{x.technician_name?t('technician')+': '+x.technician_name:t('manual')}</small>{x.report&&<p>{x.report}</p>}{Array.isArray(x.checklist)&&x.checklist.map((i:Row,n:number)=><small key={n} className="p-check-item">{i.done?'[x] ':'[ ] '}{i.text}</small>)}{Array.isArray(x.photos)&&x.photos.length>0&&<small>{t('photos')}: {x.photos.length}</small>}{x.request_id&&<a className="p-button" href={link(x)}>{t('open')}</a>}</div>)}</div>}
   </div>})}
  {can('assets.manage')&&<form className="p-edit-form" onSubmit={submit}><h3>{t('create')}</h3>
   <label>{t('title')}<input name="title" required minLength={3} maxLength={160}/></label>
   <label>{t('category')}{catSel('categoryId',true)}</label>
   <label>{t('frequency')}<select name="frequency" value={freq} onChange={e=>setFreq(e.target.value)}>{FREQ.map(x=><option key={x} value={x}>{t(x)}</option>)}</select></label>
   {freq==='custom'&&<label>{t('interval')}<input name="intervalDays" type="number" min={1} max={3650} step={1} required/></label>}
   <label>{t('priority')}<select name="priority" defaultValue="normal">{PRI.map(x=><option key={x} value={x}>{t(x)}</option>)}</select></label>
   <label>{t('due')}<input name="dueOn" type="date" required/></label>
   <label>{t('instructions')}<textarea name="instructions" maxLength={4000}/></label>
   <label>{t('checklist')}<textarea name="checklist" maxLength={4000}/></label>
   <label className="p-check-item"><input type="checkbox" name="active" defaultChecked={false}/>{t('active')}</label>
   <label className="p-check-item"><input type="checkbox" name="automatic" defaultChecked={false}/>{t('automatic')}</label>
   {catsLoading&&<p role="status">{t('loading')}</p>}<button className="p-button orange" disabled={busy||catsLoading||!cats.length}>{t('create')}</button></form>}
 </section>}
