import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {getSystemOverview,getSystemHealth,getSystemLogs,getSystemJobs,type SystemOverview,type SystemLogs,type SystemJobs,type GetSystemLogsParams} from '@workspace/api-client-react';
import {fmtDate,yerevanInstant} from './console-util';
import type {Language} from './i18n';
import type {RoleContext} from './types';
import './console.css';
import './system-console.css';
import {createSystemLogExport} from '@workspace/api-client-react';
import {getCsrfHeaders} from './client';
import SystemErrors from './SystemErrors';
import SystemBackups,{backupsLabel} from './SystemBackups';
import ApiCenter,{apiLabel} from './ApiCenter';
import {CachePanel,SessionsPanel,EnvironmentPanel,RetentionPanel,ADMIN_S,ENV_LABELS,canEnterSystem} from './SystemAdmin';
import {IntegrationsPanel,WebhooksPanel} from './SystemConnections';
import SystemModules from './SystemModules';
import SystemUpdates from './SystemUpdates';

type Tab='overview'|'health'|'logs'|'errors'|'jobs'|'cache'|'sessions'|'environment'|'retention'|'backups'|'api'|'integrations'|'webhooks'|'modules'|'updates';
const L=(l:Language)=>l==='hy'?0:l==='ru'?1:2;
const S:Record<string,[string,string,string]>={
 read_access_verified:['Հաստատված','Подтверждено','Verified'],probe_failed:['Ստուգումը ձախողվեց','Проверка не удалась','Probe failed'],probe_timeout:['Ժամանակը սպառվեց','Тайм-аут','Timed out'],
 emailEvidence:['Էլփոստի ցուցանիշները բոլոր մատակարարների պահպանված տվյալներն են, ոչ կենդանի ստուգում։ Ընդունումը առաքում չէ։ 24 ժամվա հաշվիչները հաշվում են եզակի նամակները՝ ըստ իրադարձության տեսակի․ մեկ նամակը կարող է լինել մի քանի հաշվիչում։ Անհայտ արդյունքը հաստատված ձախողում չէ։','Почтовые показатели — сохранённые данные всех провайдеров, не проверка соединения. Принятие не означает доставку. За 24 часа считаются уникальные письма по каждому типу события; одно письмо может попасть в несколько счётчиков. Неизвестный результат — не подтверждённый сбой.','Email metrics use retained evidence across all providers, not a live probe. Acceptance is not delivery. Each 24-hour event counter counts distinct messages; one message may appear in multiple counters. An unknown result is not a confirmed failure.'],
  system:['Համակարգ','Система','System'],overview:['Ամփոփում','Обзор','Overview'],health:['Վիճակ','Состояние','Health'],logs:['Մատյաններ','Журналы','Logs'],errors:['Սխալներ','Ошибки','Errors'],jobs:['Առաջադրանքներ','Задания','Jobs'],
  modules:['Մոդուլներ','Модули','Modules'],updates:['Թարմացումներ','Обновления','Updates'],
 healthy:['Առողջ','Исправно','Healthy'],degraded:['Վատթարացած','Деградация','Degraded'],down:['Անջատված','Недоступно','Down'],unavailable:['Անհասանելի','Нет данных','Unavailable'],not_configured:['Կարգավորված չէ','Не настроено','Not configured'],
 warning:['Զգուշացում','Предупреждение','Warning'],critical:['Կրիտիկական','Критично','Critical'],
 running:['Ընթացքում','Выполняется','Running'],completed:['Ավարտված','Завершено','Completed'],failed:['Ձախողված','Ошибка','Failed'],interrupted:['Ընդհատված','Прервано','Interrupted'],
 observedAt:['Դիտարկման պահը','Время наблюдения','Observed at'],aggregate:['Ընդհանուր վիճակ','Сводный статус','Aggregate status'],metric:['Ցուցանիշ','Показатель','Metric'],value:['Արժեք','Значение','Value'],status:['Կարգավիճակ','Статус','Status'],
 loading:['Բեռնվում է…','Загрузка…','Loading…'],retry:['Կրկնել','Повторить','Retry'],refresh:['Թարմացնել','Обновить','Refresh'],forbidden:['Այս բաժնի համար թույլտվություն չկա։','Нет разрешения на этот раздел.','You do not have permission for this section.'],error:['Չհաջողվեց բեռնել տվյալները։','Не удалось загрузить данные.','Could not load data.'],
 empty:['Գրառումներ չկան։','Записей нет.','No records.'],noMetrics:['Սերվերը ցուցանիշներ չի վերադարձրել։','Сервер не вернул показателей.','The server returned no metrics.'],
 from:['Սկսած','С','From'],to:['Մինչև','По','To'],level:['Մակարդակ','Уровень','Level'],category:['Կատեգորիա','Категория','Category'],user:['Օգտատիրոջ UUID','UUID пользователя','User UUID'],organization:['Կազմակերպության UUID','UUID организации','Organization UUID'],requestId:['Հարցման ID','ID запроса','Request ID'],httpStatus:['HTTP կարգավիճակ','HTTP-статус','HTTP status'],endpoint:['Endpoint','Endpoint','Endpoint'],errorCode:['Սխալի կոդ','Код ошибки','Error code'],job:['Առաջադրանք','Задание','Job'],q:['Որոնում','Поиск','Search'],
 invalidRange:['«Մինչև»-ն պետք է լինի «Սկսած»-ից հետո։','«По» должно быть позже «С».','"To" must be after "From".'],
 apply:['Կիրառել','Применить','Apply'],reset:['Մաքրել','Сбросить','Reset'],invalidUuid:['Մուտքագրեք ամբողջական UUID։','Введите полный UUID.','Enter a complete UUID.'],invalidStatus:['HTTP կարգավիճակը 100–599 թիվ է։','HTTP-статус — число 100–599.','HTTP status must be a number 100–599.'],
 time:['Ժամանակ','Время','Time'],event:['Իրադարձություն','Событие','Event'],service:['Ծառայություն','Сервис','Service'],latency:['Տևողություն','Задержка','Latency'],details:['Մանրամասներ','Подробнее','Details'],hide:['Թաքցնել','Скрыть','Hide'],actor:['Գործողի ID','ID исполнителя','Actor ID'],method:['Մեթոդ','Метод','Method'],
 prev:['Նախորդ','Назад','Previous'],next:['Հաջորդ','Далее','Next'],page:['Էջ','Страница','Page'],
 started:['Սկիզբ','Начало','Started'],finished:['Ավարտ','Завершение','Finished'],heartbeat:['Վերջին ազդանշան','Последний heartbeat','Last heartbeat'],
 jobsNote:['Միայն դիտում։ 1-ին փուլում առաջադրանքների կրկնում կամ չեղարկում հասանելի չէ։','Только просмотр. Повтор и отмена заданий в Фазе 1 недоступны.','Read-only. Retrying or cancelling jobs is not available in Phase 1.'],
 logsNote:['Ցուցադրվում են միայն գործառնական մետատվյալներ․ հարցումների մարմիններ, վերնագրեր և stack trace չեն ցուցադրվում։','Показываются только операционные метаданные; тела запросов, заголовки и стектрейсы не отображаются.','Operational metadata only; request bodies, headers and stack traces are never shown.'],
 autoRefresh:['Ավտոթարմացում՝ 30 վ','Автообновление: 30 с','Auto-refresh: 30 s'],any:['Բոլորը','Все','Any'],
 exportNote:['Արտահանումը կիրառում է հաստատված ֆիլտրերը՝ մինչև 31 օր և 5000 գրառում։','Экспорт использует применённые фильтры: до 31 дня и 5000 записей.','Export uses applied filters: up to 31 days and 5000 records.'],
 exportRange:['Ընտրեք և կիրառեք ամսաթվերի միջակայքը՝ մինչև 31 օր։','Выберите и примените диапазон дат не более 31 дня.','Select and apply a date range of at most 31 days.'],
 exportLarge:['Նեղացրեք միջակայքը կամ ֆիլտրերը։ Արտահանումը չափազանց մեծ է։','Сузьте диапазон или фильтры: экспорт слишком большой.','Narrow the range or filters: export is too large.'],
 exportDone:['Ֆայլը պատրաստ է։','Файл подготовлен для скачивания.','File prepared for download.'],
};
const M:Record<string,[string,string,string]>={
 email_last_accepted:['Վերջին ընդունումը մատակարարի կողմից','Последнее принятие провайдером','Last provider acceptance'],
 email_last_sent:['Վերջին հաստատված ուղարկումը','Последняя подтверждённая отправка','Last confirmed send'],
 email_last_delivered:['Վերջին հաստատված առաքումը','Последняя подтверждённая доставка','Last confirmed delivery'],
 email_failed_24h:['Ձախողված նամակներ · 24 ժամ','Письма с событием failed · 24 ч','Messages with failed event · 24h'],
 email_bounced_24h:['Վերադարձված նամակներ · 24 ժամ','Возвраты писем · 24 ч','Bounced messages · 24h'],
 email_complained_24h:['Բողոքներ · 24 ժամ','Жалобы на письма · 24 ч','Complained messages · 24h'],
 email_delayed_24h:['Հետաձգված նամակներ · 24 ժամ','Задержки писем · 24 ч','Delayed messages · 24h'],
 email_unknown_24h:['Անհայտ արդյունքով նամակներ · 24 ժամ','Неизвестный результат отправки · 24 ч','Unknown send outcomes · 24h'],
 environment:['Միջավայր','Окружение','Environment'],node:['Node.js տարբերակ','Версия Node.js','Node.js version'],uptime_seconds:['Աշխատանքի ժամանակ (վ)','Время работы (с)','Uptime (seconds)'],started_at:['Գործարկման պահ','Время запуска','Started at'],api:['API','API','API'],
 application_version:['Հավելվածի տարբերակ','Версия приложения','Application version'],frontend_version:['Frontend տարբերակ','Версия фронтенда','Frontend version'],build_version:['Build տարբերակ','Версия сборки','Build version'],git_commit:['Git commit','Git-коммит','Git commit'],
 storage:['Պահոց','Хранилище','Storage'],cache:['Քեշ','Кэш','Cache'],integrations:['Ինտեգրումներ','Интеграции','Integrations'],last_backup:['Վերջին պահուստային պատճեն','Последняя резервная копия','Last backup'],backup_storage:['Պահուստային պահոց','Хранилище резервных копий','Backup storage'],
 backup_encryption:['Պատճենների գաղտնագրում','Шифрование резервных копий','Backup encryption'],
 backup_type:['Պատճենի տեսակ','Тип последней копии','Last backup type'],
 backup_bytes:['Պատճենի չափը (բայթ)','Размер копии (байт)','Backup size (bytes)'],
 backup_age_seconds:['Պատճենի տարիքը (վրկ)','Возраст копии (сек.)','Backup age (seconds)'],
 pool_total:['DB կապեր՝ ընդհանուր','Соединения БД: всего','DB pool: total'],pool_idle:['DB կապեր՝ ազատ','Соединения БД: свободно','DB pool: idle'],pool_waiting:['DB կապեր՝ սպասող','Соединения БД: ожидают','DB pool: waiting'],log_events_dropped:['Կորցված մատյանային իրադարձություններ','Потерянные события журнала','Dropped log events'],
 email_configuration:['Էլ. փոստի կարգավորում','Настройка эл. почты','Email configuration'],email_delivery_probe:['Էլ. փոստի առաքման ստուգում','Проверка доставки почты','Email delivery probe'],storage_provider:['Պահոցի մատակարար','Провайдер хранилища','Storage provider'],
 database:['Տվյալների բազա','База данных','Database'],database_bytes:['Բազայի չափ (բայթ)','Размер БД (байт)','Database size (bytes)'],migration:['Վերջին միգրացիա','Последняя миграция','Latest migration'],
 read_access_verified:['Կարդալու հասանելիությունը հաստատված է','Доступ на чтение подтверждён','Read access verified'],probe_failed:['Ստուգումը ձախողվեց','Проверка не удалась','Probe failed'],probe_timeout:['Ստուգման ժամանակը սպառվեց','Тайм-аут проверки','Probe timed out'],storage_read_access:['Պահոցի կարդալու ստուգում','Проверка чтения хранилища','Storage read check'],
 jobs_running:['Ընթացիկ առաջադրանքներ (24ժ)','Выполняемые задания (24ч)','Running jobs (24h)'],jobs_failed:['Ձախողված առաջադրանքներ (24ժ)','Неудачные задания (24ч)','Failed jobs (24h)'],jobs_interrupted:['Ընդհատված առաջադրանքներ (24ժ)','Прерванные задания (24ч)','Interrupted jobs (24h)'],jobs:['Առաջադրանքներ','Задания','Jobs'],
};
for(const [k,v] of Object.entries(ENV_LABELS))M[k]??=v;
const LEVELS=['info','warning','error','fatal'] as const;
const CATEGORIES=['api','authentication','security','job','system','application','database','email','integration'] as const;
const CAT:Record<string,[string,string,string]>={api:['API','API','API'],authentication:['Նույնականացում','Аутентификация','Authentication'],security:['Անվտանգություն','Безопасность','Security'],job:['Առաջադրանք','Задание','Job'],system:['Համակարգ','Система','System'],application:['Հավելված','Приложение','Application'],database:['Տվյալների բազա','База данных','Database'],email:['Էլ. փոստ','Эл. почта','Email'],integration:['Ինտեգրում','Интеграция','Integration']};
const LEV:Record<string,[string,string,string]>={info:['Տեղեկություն','Инфо','Info'],warning:['Զգուշացում','Предупреждение','Warning'],error:['Սխալ','Ошибка','Error'],fatal:['Ճակատագրական','Фатально','Fatal']};
const MAX:Record<string,number>={endpoint:240,errorCode:60,job:60,q:100,requestId:36,user:36,organization:36,status:3};
export const systemLabel=(l:Language)=>S.system[L(l)];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLL=30000;
type Perm='system.health.read'|'logs.read'|'jobs.read'|'cache.read'|'sessions.read'|'environment.read'|'backups.read'|'api.read'|'integrations.read'|'plugins.read'|'updates.read';
const TABS:{key:Tab;perm:'system.read'|Perm}[]=[{key:'overview',perm:'system.read'},{key:'health',perm:'system.health.read'},{key:'logs',perm:'logs.read'},{key:'errors',perm:'logs.read'},{key:'jobs',perm:'jobs.read'},{key:'retention',perm:'logs.read'},{key:'cache',perm:'cache.read'},{key:'sessions',perm:'sessions.read'},{key:'environment',perm:'environment.read'},{key:'backups',perm:'backups.read'},{key:'api',perm:'api.read'},{key:'integrations',perm:'integrations.read'},{key:'webhooks',perm:'api.read'},{key:'modules',perm:'plugins.read'},{key:'updates',perm:'updates.read'}];
const statusOf=(e:unknown)=>typeof e==='object'&&e&&'status' in e?Number((e as {status:unknown}).status):0;

// Polls on mount, every 30s, on window focus; aborts in-flight requests and drops
// results from superseded requests so no stale scope is ever shown.
function usePolled<T>(fetcher:(signal:AbortSignal)=>Promise<T>,key:string){
 const [data,setData]=useState<T>();const [error,setError]=useState<unknown>();const [loading,setLoading]=useState(true);
 const ctrl=useRef<AbortController|undefined>(undefined);const fRef=useRef(fetcher);fRef.current=fetcher;
 const load=useCallback(()=>{ctrl.current?.abort();const c=new AbortController();ctrl.current=c;setLoading(true);
  fRef.current(c.signal).then(d=>{if(!c.signal.aborted){setData(d);setError(undefined)}}).catch(e=>{if(!c.signal.aborted){setError(e);setData(undefined)}}).finally(()=>{if(!c.signal.aborted)setLoading(false)})},[]);
 useEffect(()=>{setData(undefined);setError(undefined);load();const id=setInterval(load,POLL);const focus=()=>load();window.addEventListener('focus',focus);
  return()=>{clearInterval(id);window.removeEventListener('focus',focus);ctrl.current?.abort()}},[key,load]);
 return {data,error,loading,reload:load};
}

function Pill({s,l}:{s:string;l:Language}){const cls=['healthy','completed'].includes(s)?'green':['down','critical','failed'].includes(s)?'red':['degraded','warning','interrupted','running'].includes(s)?'amber':'grey';return <span className={'p-badge sc-pill '+cls} data-testid={'status-'+s}>{S[s]?.[L(l)]??s}</span>}
function Failure({error,l,onRetry}:{error:unknown;l:Language;onRetry:()=>void}){const st=statusOf(error);return <div className="sc-failure" role="alert" data-testid="status-error"><p className="p-error">{st===403?S.forbidden[L(l)]:S.error[L(l)]+(st?' (HTTP '+st+')':'')}</p><button className="p-button" onClick={onRetry} data-testid="button-retry">{S.retry[L(l)]}</button></div>}
function Skeleton(){return <div className="sc-skeleton" role="status" aria-busy="true" data-testid="status-loading"><span/><span/><span/></div>}

function Metrics({kind,ck,l}:{kind:'overview'|'health';ck:string;l:Language}){
 const tx=(k:string)=>S[k][L(l)];
 const q=usePolled<SystemOverview>(signal=>(kind==='overview'?getSystemOverview:getSystemHealth)({signal,credentials:'include'}),ck+':'+kind);
 if(q.error)return <Failure error={q.error} l={l} onRetry={q.reload}/>;
 if(!q.data)return <Skeleton/>;
 const d=q.data;
 return <section className="p-card sc-card" aria-busy={q.loading}>
  <div className="sc-head"><div><span className="sc-label">{tx('aggregate')}</span><Pill s={d.status} l={l}/></div><div><span className="sc-label">{tx('observedAt')}</span><strong data-testid="text-observed-at">{fmtDate(d.observedAt,l)}</strong></div><button className="p-button small" onClick={q.reload} disabled={q.loading} data-testid={'button-refresh-'+kind}>{tx('refresh')}</button></div>
  {d.metrics.length?<ul className="sc-metrics">{d.metrics.map(m=><li key={m.key} data-testid={'row-metric-'+m.key}><span className="sc-mkey">{M[m.key]?.[L(l)]??m.key}</span><strong className={m.value===null?'sc-null':''} data-testid={'text-metric-value-'+m.key}>{m.value===null?tx('unavailable'):(S[String(m.value)]?.[L(l)]??m.value)}</strong><Pill s={m.status} l={l}/></li>)}</ul>:<p className="sc-empty" data-testid="text-empty">{tx('noMetrics')}</p>}
  <p className="sc-note">{tx('emailEvidence')}</p>
  <p className="sc-note">{tx('autoRefresh')}</p>
 </section>;
}

const EMPTY={from:'',to:'',level:'',category:'',user:'',organization:'',requestId:'',status:'',endpoint:'',errorCode:'',job:'',q:''};
type Filters=typeof EMPTY;
function Logs({ck,l,canExport}:{ck:string;l:Language;canExport:boolean}){
 const tx=(k:string)=>S[k][L(l)];
 const initial=():Filters=>{const p=new URLSearchParams(location.search);const u=(p.get('user')??'').trim().slice(0,36);return {...EMPTY,user:u}};
 const [draft,setDraft]=useState<Filters>(initial);
 const [applied,setApplied]=useState<Filters>(()=>{const f=initial();return UUID.test(f.user)?f:{...f,user:''}});
 const [page,setPage]=useState(1);const [invalid,setInvalid]=useState<string[]>([]);const [open,setOpen]=useState<string>();
 const [exporting,setExporting]=useState(false);const [exportMessage,setExportMessage]=useState('');
 const exportController=useRef<AbortController|null>(null);
 useEffect(()=>()=>exportController.current?.abort(),[]);
 const params=():GetSystemLogsParams=>{const p:GetSystemLogsParams={page};for(const [k,v] of Object.entries(applied)){const t=v.trim();if(!t)continue;if(k==='from'||k==='to')(p as Record<string,unknown>)[k]=yerevanInstant(t);else if(k==='status')p.status=Number(t);else (p as Record<string,unknown>)[k]=t}return p};
 const key=ck+':logs:'+page+':'+JSON.stringify(applied);
 const download=async(format:'json'|'csv')=>{
  if(exportController.current)return;
  if(!applied.from||!applied.to||applied.from>applied.to||Date.parse(yerevanInstant(applied.to))-Date.parse(yerevanInstant(applied.from))>31*86400000){setExportMessage(tx('exportRange'));return}
  const controller=new AbortController();exportController.current=controller;setExporting(true);setExportMessage('');
  try{
   const {page:_page,...filters}=params();
   const file=await createSystemLogExport({...filters,format,from:filters.from!,to:filters.to!},{credentials:'include',headers:getCsrfHeaders(),signal:controller.signal});
   if(controller.signal.aborted)return;
   const url=URL.createObjectURL(new Blob([file.content],{type:file.contentType}));
   const link=document.createElement('a');link.href=url;link.download=file.filename;document.body.appendChild(link);link.click();link.remove();
   setTimeout(()=>URL.revokeObjectURL(url),1000);setExportMessage(tx('exportDone')+' ('+file.rows+')');
  }catch(e){if(!controller.signal.aborted)setExportMessage(tx(statusOf(e)===413?'exportLarge':statusOf(e)===403?'forbidden':'error'))}
  finally{exportController.current=null;if(!controller.signal.aborted)setExporting(false)}
 };
 const q=usePolled<SystemLogs>(signal=>getSystemLogs(params(),{signal,credentials:'include'}),key);
 const submit=(e:FormEvent)=>{e.preventDefault();const bad:string[]=[];if(draft.user.trim()&&!UUID.test(draft.user.trim()))bad.push('user');if(draft.organization.trim()&&!UUID.test(draft.organization.trim()))bad.push('organization');if(draft.requestId.trim()&&!UUID.test(draft.requestId.trim()))bad.push('requestId');if(draft.from&&draft.to&&draft.from>draft.to)bad.push('to');if(draft.status.trim()&&!(/^\d{3}$/.test(draft.status.trim())&&+draft.status>=100&&+draft.status<=599))bad.push('status');setInvalid(bad);if(bad.length)return;setPage(1);setApplied(draft)};
 const inp=(k:keyof Filters,label:string,type='text',extra?:Record<string,string>)=><label>{tx(label)}<input type={type} value={draft[k]} maxLength={MAX[k]??160} aria-invalid={invalid.includes(k)} onChange={e=>setDraft(d=>({...d,[k]:e.target.value}))} data-testid={'input-log-'+k} {...extra}/>{invalid.includes(k)&&<small className="p-field-error">{tx(k==='status'?'invalidStatus':k==='to'?'invalidRange':'invalidUuid')}</small>}</label>;
 const items=q.data?.items??[];
 return <div className="sc-stack">
  <form className="p-card cx-form" role="search" onSubmit={submit} data-testid="form-log-filters"><div className="cx-filters">
   {inp('from','from','datetime-local')}{inp('to','to','datetime-local')}
   <label>{tx('level')}<select value={draft.level} onChange={e=>setDraft(d=>({...d,level:e.target.value}))} data-testid="select-log-level"><option value="">{tx('any')}</option>{LEVELS.map(v=><option key={v} value={v}>{LEV[v][L(l)]}</option>)}</select></label>
   <label>{tx('category')}<select value={draft.category} onChange={e=>setDraft(d=>({...d,category:e.target.value}))} data-testid="select-log-category"><option value="">{tx('any')}</option>{CATEGORIES.map(v=><option key={v} value={v}>{CAT[v][L(l)]}</option>)}</select></label>{inp('user','user','text',{placeholder:'xxxxxxxx-xxxx-…',spellCheck:'false'})}{inp('organization','organization','text',{placeholder:'xxxxxxxx-xxxx-…',spellCheck:'false'})}{inp('requestId','requestId')}{inp('status','httpStatus','text',{inputMode:'numeric'})}{inp('endpoint','endpoint')}{inp('errorCode','errorCode')}{inp('job','job')}{inp('q','q')}
  </div><div className="cx-row"><button className="p-button orange" data-testid="button-apply-filters">{tx('apply')}</button><button type="button" className="p-button" onClick={()=>{setDraft(EMPTY);setApplied(EMPTY);setInvalid([]);setPage(1)}} data-testid="button-reset-filters">{tx('reset')}</button><button type="button" className="p-button" disabled={q.loading} onClick={q.reload} data-testid="button-refresh-logs">{tx('refresh')}</button></div>
  <p className="sc-note">{tx('logsNote')}</p></form>
  {canExport&&<section className="p-card sc-card" aria-busy={exporting}><div className="cx-row">{(['json','csv'] as const).map(format=><button type="button" className="p-button" key={format} disabled={exporting||q.loading||!!q.error} onClick={()=>void download(format)} data-testid={'button-export-'+format}>{exporting?tx('loading'):'↓ '+format.toUpperCase()}</button>)}</div><p className="sc-note">{tx('exportNote')}</p><p role="status">{exportMessage}</p></section>}
  {q.error?<Failure error={q.error} l={l} onRetry={q.reload}/>:!q.data?<Skeleton/>:<section className="p-card sc-card" aria-busy={q.loading}>
   <div className="cx-scroll"><table className="cx-table sc-table"><thead><tr><th>{tx('time')}</th><th>{tx('level')}</th><th>{tx('category')}</th><th>{tx('event')}</th><th>{tx('endpoint')}</th><th>{tx('httpStatus')}</th><th>{tx('errorCode')}</th><th><span className="sr-only">{tx('details')}</span></th></tr></thead><tbody>
    {items.map(i=>[<tr key={i.id} data-testid={'row-log-'+i.id}><td>{fmtDate(i.createdAt,l)}</td><td><span className={'sc-level sc-level-'+i.level}>{LEV[i.level]?.[L(l)]??i.level}</span></td><td>{CAT[i.category]?.[L(l)]??i.category}</td><td>{i.event}</td><td className="sc-mono">{i.method?i.method+' ':''}{i.endpoint??'—'}</td><td>{i.status??'—'}</td><td className="sc-mono">{i.errorCode??'—'}</td><td><button className="p-button small" aria-expanded={open===i.id} onClick={()=>setOpen(o=>o===i.id?undefined:i.id)} data-testid={'button-log-details-'+i.id}>{open===i.id?tx('hide'):tx('details')}</button></td></tr>,
     open===i.id&&<tr key={i.id+':d'} className="sc-detail"><td colSpan={8}><dl data-testid={'detail-log-'+i.id}>{([['requestId',i.requestId],['actor',i.actorId],['organization',i.organizationId],['service',i.service],['method',i.method],['latency',i.latencyMs===null?null:i.latencyMs+' ms'],['job',i.job]] as [string,string|null][]).map(([k,v])=><div key={k}><dt>{tx(k)}</dt><dd className="sc-mono">{v??'—'}</dd></div>)}</dl></td></tr>])}
    {!items.length&&<tr><td colSpan={8} className="sc-empty" data-testid="text-empty">{tx('empty')}</td></tr>}
   </tbody></table></div>
   <Pager page={page} hasMore={!!q.data.hasMore} loading={q.loading} setPage={setPage} l={l} id="logs"/>
  </section>}
 </div>;
}
function Pager({page,hasMore,loading,setPage,l,id}:{page:number;hasMore:boolean;loading:boolean;setPage:(f:(p:number)=>number)=>void;l:Language;id:string}){const tx=(k:string)=>S[k][L(l)];return <div className="cx-row" aria-live="polite"><button className="p-button" disabled={loading||page<=1} onClick={()=>setPage(p=>p-1)} data-testid={'button-prev-'+id}>{tx('prev')}</button><span data-testid={'text-page-'+id}>{tx('page')} {page}</span><button className="p-button" disabled={loading||!hasMore} onClick={()=>setPage(p=>p+1)} data-testid={'button-next-'+id}>{tx('next')}</button></div>}

function Jobs({ck,l}:{ck:string;l:Language}){
 const tx=(k:string)=>S[k][L(l)];const [page,setPage]=useState(1);
 const q=usePolled<SystemJobs>(signal=>getSystemJobs({page},{signal,credentials:'include'}),ck+':jobs:'+page);
 const items=q.data?.items??[];
 return <div className="sc-stack"><p className="p-info sc-readonly" data-testid="text-jobs-readonly">{tx('jobsNote')}</p>
  {q.error?<Failure error={q.error} l={l} onRetry={q.reload}/>:!q.data?<Skeleton/>:<section className="p-card sc-card" aria-busy={q.loading}>
   <div className="cx-row"><button className="p-button small" disabled={q.loading} onClick={q.reload} data-testid="button-refresh-jobs">{tx('refresh')}</button></div>
   <div className="cx-scroll"><table className="cx-table sc-table"><thead><tr><th>{tx('job')}</th><th>{tx('status')}</th><th>{tx('started')}</th><th>{tx('heartbeat')}</th><th>{tx('finished')}</th><th>{tx('errorCode')}</th></tr></thead><tbody>
    {items.map(j=><tr key={j.id} data-testid={'row-job-'+j.id}><td className="sc-mono">{j.job}</td><td><Pill s={j.status} l={l}/></td><td>{fmtDate(j.startedAt,l)}</td><td>{fmtDate(j.heartbeatAt,l)}</td><td>{fmtDate(j.finishedAt,l)}</td><td className="sc-mono">{j.errorCode??'—'}</td></tr>)}
    {!items.length&&<tr><td colSpan={6} className="sc-empty" data-testid="text-empty">{tx('empty')}</td></tr>}
   </tbody></table></div>
   <Pager page={page} hasMore={!!q.data.hasMore} loading={q.loading} setPage={setPage} l={l} id="jobs"/>
  </section>}</div>;
}

export function systemTab(path:string):Tab{const s=path.split('/')[3];return s==='health'||s==='logs'||s==='errors'||s==='jobs'||s==='cache'||s==='sessions'||s==='environment'||s==='retention'||s==='backups'||s==='api'||s==='integrations'||s==='webhooks'||s==='modules'||s==='updates'?s:'overview'}
export default function SystemConsole({c,language}:{c:RoleContext;language:Language}){
  const l=language;const tx=(k:string)=>k==='backups'?backupsLabel(l):k==='api'?apiLabel(l):k==='integrations'?['Ինտեգրումներ','Интеграции','Integrations'][L(l)]:k==='webhooks'?['Ելքային webhook-ներ','Исходящие webhooks','Outgoing webhooks'][L(l)]:k==='modules'?['Մոդուլներ և ընդլայնումներ','Модули и расширения','Modules & Extensions'][L(l)]:k==='updates'?['Թարմացումներ','Обновления','Updates'][L(l)]:(S[k]??ADMIN_S[k])[L(l)];
 const [tab,setTab]=useState<Tab>(()=>systemTab(location.pathname));
 useEffect(()=>{const pop=()=>setTab(systemTab(location.pathname));window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop)},[]);
 const visible=TABS.filter(x=>c.permissions.includes(x.perm)&&(x.key!=='webhooks'||c.permissions.includes('api.clients.manage')));
 const current=visible.some(x=>x.key===tab)?tab:(visible[0]?.key??'overview');
 const denied=current!==tab;
 useEffect(()=>{if(denied&&location.pathname.startsWith('/console/system/'))history.replaceState(null,'','/console/system/'+current)},[denied,current]);
 const ck=c.id;
 if(!canEnterSystem(c.permissions))return <div className="p-card"><p className="p-error" role="alert" data-testid="status-forbidden">{tx('forbidden')}</p></div>;
 const go=(k:Tab)=>{const u=new URLSearchParams(location.search).get('user');const url='/console/system/'+k+(k==='logs'&&u?'?user='+encodeURIComponent(u):'');if(location.pathname!=='/console/system/'+k)history.pushState(null,'',url);setTab(k)};
 return <div className="sc-wrap" data-testid="system-console">
  <nav className="sc-tabs" role="tablist" aria-label={tx('system')}>{visible.map(x=><button key={x.key} role="tab" aria-selected={current===x.key} className={current===x.key?'selected':''} onClick={()=>go(x.key)} data-testid={'tab-system-'+x.key}>{tx(x.key)}</button>)}</nav>
  <div role="tabpanel">
   {current==='overview'&&<Metrics key={ck+':o'} kind="overview" ck={ck} l={l}/>}
   {current==='health'&&<Metrics key={ck+':h'} kind="health" ck={ck} l={l}/>}
   {current==='logs'&&<Logs key={ck+':l'} ck={ck} l={l} canExport={c.permissions.includes('logs.export')}/>}
   {current==='errors'&&<SystemErrors key={ck+':e'} ck={ck} l={l} canManage={c.permissions.includes('logs.manage')}/>}
    {current==='jobs'&&<Jobs key={ck+':j'} ck={ck} l={l}/>}
    {current==='retention'&&<RetentionPanel key={ck+':r'} ck={ck} l={l} canManage={c.permissions.includes('logs.manage')}/>}
    {current==='backups'&&<SystemBackups key={ck+':b'} ck={ck} l={l} perms={{create:c.permissions.includes('backups.create'),download:c.permissions.includes('backups.download'),delete:c.permissions.includes('backups.delete'),policies:c.permissions.includes('backups.policies.manage'),restore:c.permissions.includes('backups.restore')}}/>}
    {current==='api'&&<ApiCenter key={ck+':a'} ck={ck} l={l} perms={{clients:c.permissions.includes('api.clients.manage'),keys:c.permissions.includes('api.keys.manage')}}/>}
    {current==='integrations'&&<IntegrationsPanel key={ck+':i'} ck={ck} l={l} perms={{integrationRead:c.permissions.includes('integrations.read'),integrationManage:c.permissions.includes('integrations.manage'),integrationTest:c.permissions.includes('integrations.test'),webhookRead:false,webhookManage:false,deliveryManage:false}}/>}
    {current==='webhooks'&&<WebhooksPanel key={ck+':w'} ck={ck} l={l} perms={{integrationRead:false,integrationManage:false,integrationTest:false,webhookRead:c.permissions.includes('api.read')&&c.permissions.includes('api.clients.manage'),webhookManage:c.permissions.includes('api.clients.manage'),deliveryManage:c.permissions.includes('jobs.manage')}}/>}
    {current==='cache'&&<CachePanel key={ck+':c'} ck={ck} l={l} canClear={c.permissions.includes('cache.clear')}/>}
    {current==='sessions'&&<SessionsPanel key={ck+':s'} ck={ck} l={l} canRevoke={c.permissions.includes('sessions.revoke')}/>}
    {current==='environment'&&<EnvironmentPanel key={ck+':v'} ck={ck} l={l}/>}
     {current==='modules'&&<SystemModules key={ck+':m'} language={l} canRead={c.permissions.includes('plugins.read')}/>}
     {current==='updates'&&<SystemUpdates key={ck+':u'} language={l} canRead={c.permissions.includes('updates.read')} canUpload={c.permissions.includes('updates.upload')} canStage={c.permissions.includes('updates.upload')} canBackups={c.permissions.includes('backups.read')}/>}
  </div>
 </div>;
}
