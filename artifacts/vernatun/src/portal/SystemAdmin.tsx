import {useCallback,useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {getSystemCache,clearSystemCache,getSystemSessions,revokeSystemSessions,getSystemEnvironment,getSystemLogRetention,saveSystemLogRetention,type GetSystemLogRetention200,type SystemCache,type SystemSessions,type SystemOverview,type SystemSessionsItemsItem} from '@workspace/api-client-react';
import {fmtDate} from './console-util';
import {getCsrfHeaders} from './client';
import {ReauthPrompt,needsReauth,reauthDone} from './Reauth';
import type {Language} from './i18n';

const L=(l:Language)=>l==='hy'?0:l==='ru'?1:2;
export const ADMIN_S:Record<string,[string,string,string]>={
 cache:['Քեշ','Кэш','Cache'],sessions:['Սեսիաներ','Сеансы','Sessions'],environment:['Միջավայր','Окружение','Environment'],
 loading:['Բեռնվում է…','Загрузка…','Loading…'],retry:['Կրկնել','Повторить','Retry'],refresh:['Թարմացնել','Обновить','Refresh'],cancel:['Չեղարկել','Отмена','Cancel'],
 forbidden:['Այս բաժնի համար թույլտվություն չկա։','Нет разрешения на этот раздел.','You do not have permission for this section.'],error:['Չհաջողվեց բեռնել տվյալները։','Не удалось загрузить данные.','Could not load data.'],
 actionFailed:['Գործողությունը չհաջողվեց։','Действие не выполнено.','The action failed.'],autoRefresh:['Ավտոթարմացում՝ 30 վ','Автообновление: 30 с','Auto-refresh: 30 s'],
 provider:['Մատակարար','Провайдер','Provider'],scope:['Տիրույթ','Область','Scope'],redis:['Redis','Redis','Redis'],yes:['Կարգավորված է','Настроен','Configured'],no:['Կարգավորված չէ','Не настроен','Not configured'],
 namespace:['Անվանատարածք','Пространство имён','Namespace'],entries:['Գրառումներ','Записей','Entries'],ttl:['TTL (վ)','TTL (с)','TTL (s)'],
 cacheNote:['Redis-ը կարգավորված չէ։ Քեշը գոյություն ունի միայն այս սերվերային գործընթացի հիշողության մեջ և պարունակում է միայն պահոցի վիճակի (storage-health) ստուգման արդյունքը։ Կազմակերպության կամ օգտատիրոջ մակարդակի քեշ չկա, ուստի դրանք մաքրել հնարավոր չէ։ Մաքրումը սեսիաներին չի դիպչում։','Redis не настроен. Кэш существует только в памяти этого серверного процесса и содержит лишь результат проверки хранилища (storage-health). Кэша уровня организации или пользователя нет, поэтому очищать его нельзя. Очистка не затрагивает сеансы.','Redis is not configured. The cache lives only in this server process memory and holds only the storage-health probe result. No organization- or user-scoped cache exists, so none can be cleared. Clearing never touches sessions.'],
 clearTitle:['Մաքրել քեշը','Очистить кэш','Clear cache'],clearWhat:['Ինչ մաքրել','Что очистить','What to clear'],nsStorage:['Միայն storage-health','Только storage-health','storage-health only'],nsAll:['Գործընթացի ամբողջ քեշը (նույնն է՝ storage-health)','Весь кэш процесса (то же: storage-health)','Entire process cache (same: storage-health)'],
 clearConseq:['Հաջորդ վիճակի հարցումը կրկին կստուգի պահոցը։ Այլ գործընթացների քեշը չի մաքրվի։','Следующий запрос состояния заново проверит хранилище. Кэш других процессов не очищается.','The next health read will probe storage again. Caches in other processes are not cleared.'],
 typeConfirm:['Հաստատելու համար մուտքագրեք','Для подтверждения введите','Type to confirm'],clearGo:['Մաքրել','Очистить','Clear'],
 cleared:['Մաքրված գրառումներ՝ {n} · {ms} մվ · {s}','Очищено записей: {n} · {ms} мс · {s}','Cleared entries: {n} · {ms} ms · {s}'],
 sessionsNote:['Ցուցադրվում են միայն ակտիվ սեսիաները ամբողջ հարթակում։ Cookie-ն կամ սեսիայի իրական ID-ն երբեք չեն ցուցադրվում․ «Հղումը» միակողմանի հեշ է։ IP հասցեներ չեն հավաքվում։ Հին սեսիաների ստեղծման պահը և սարքը կարող են գրանցված չլինել։','Показаны только активные сеансы всей платформы. Cookie и настоящий ID сеанса никогда не показываются; «Ссылка» — односторонний хеш. IP-адреса не собираются. Для старых сеансов время создания и устройство могут быть не записаны.','Only active sessions across the platform are shown. Cookies and raw session IDs are never exposed; the reference is a one-way hash. No IP addresses are collected. Older sessions may have no recorded creation time or device.'],
 userFilter:['Օգտատիրոջ UUID','UUID пользователя','User UUID'],apply:['Կիրառել','Применить','Apply'],reset:['Մաքրել','Сбросить','Reset'],invalidUuid:['Մուտքագրեք ամբողջական UUID։','Введите полный UUID.','Enter a complete UUID.'],
 total:['Ընդամենը ակտիվ','Всего активных','Total active'],ref:['Հղում','Ссылка','Reference'],user:['Օգտատեր','Пользователь','User'],created:['Ստեղծված','Создан','Created'],activity:['Վերջին ակտիվություն','Последняя активность','Last activity'],expires:['Ավարտ','Истекает','Expires'],device:['Սարք','Устройство','Device'],
 notRecorded:['Գրանցված չէ','Не записано','Not recorded'],current:['Ձեր սեսիան','Ваш сеанс','Your session'],empty:['Ակտիվ սեսիաներ չկան։','Активных сеансов нет.','No active sessions.'],
 revokeOne:['Չեղարկել','Отозвать','Revoke'],revokeUser:['Բոլորը՝ օգտատիրոջ','Все сеансы пользователя','All for user'],
 revokeOneConseq:['Այս սարքում օգտատերը անմիջապես դուրս կգա և պետք է կրկին մուտք գործի։ Մյուս սեսիաները կմնան։','Пользователь будет сразу разлогинен на этом устройстве и должен войти снова. Остальные сеансы останутся.','The user is signed out on this device immediately and must sign in again. Other sessions stay active.'],
 revokeUserConseq:['Օգտատիրոջ բոլոր ակտիվ սեսիաները կչեղարկվեն բոլոր սարքերում։','Все активные сеансы пользователя будут отозваны на всех устройствах.','Every active session of this user is revoked on every device.'],
 revokeSelf:['Սա ներառում է ձեր ընթացիկ սեսիան․ դուք դուրս կգաք համակարգից։','Это включает ваш текущий сеанс: вы выйдете из системы.','This includes your current session: you will be signed out.'],
 revokeGo:['Չեղարկել սեսիաները','Отозвать сеансы','Revoke sessions'],revoked:['Չեղարկված սեսիաներ՝ {n}','Отозвано сеансов: {n}','Revoked sessions: {n}'],
 prev:['Նախորդ','Назад','Previous'],next:['Հաջորդ','Далее','Next'],page:['Էջ','Страница','Page'],
 encNote:['«Գործառնությունների գաղտնագրում»-ը առանձին բանալի է ապագա պահուստային պատճենների և ինտեգրման գաղտնիքների համար։ Ցուցադրվում է միայն՝ կարգավորված է, թե ոչ, բանալին երբեք չի ցուցադրվում։','«Шифрование операций» — отдельный ключ для будущих резервных копий и секретов интеграций. Показывается только, настроен ли он; сам ключ никогда не показывается.','"Encryption for operations" is a separate key for future backups and integration secrets. Only whether it is configured is shown; the key itself is never shown.'],
 unknownBrowser:['Անհայտ դիտարկիչ','Неизвестный браузер','Unknown browser'],unknownDevice:['Անհայտ սարք','Неизвестное устройство','Unknown device'],
 deviceNote:['Նոր սեսիաների համար պահվում է միայն ընդհանուր դիտարկիչ/սարք (օր.՝ Chrome / Windows), ոչ թե ամբողջական user-agent։','Для новых сеансов хранится только общий браузер/устройство (например, Chrome / Windows), а не полный user-agent.','New sessions store only a coarse browser/device (e.g. Chrome / Windows), never the full user-agent.'],
 envNote:['Միայն դիտում։ Ցուցադրվում են միայն ֆիքսված անվտանգ բանալիներ․ միջավայրի փոփոխականները չեն թվարկվում, գաղտնիքներ չեն ցուցադրվում։','Только просмотр. Показываются только фиксированные безопасные ключи; переменные окружения не перечисляются, секреты не показываются.','Read-only. Only a fixed allowlist of safe keys is shown; environment variables are never enumerated and secrets are never shown.'],
 retention:['Պահպանում','Хранение','Retention'],
 retTitle:['Գործառնական մատյանների պահպանում','Хранение операционных журналов','Operational log retention'],
 retWarn:['Միացնելիս համակարգը ավտոմատ և անդառնալիորեն կջնջի միայն ընտրված օրերից (7–3650) հին գործառնական մատյանները՝ րոպեում առավելագույնը 500 գրառում։ Բիզնես աուդիտի մատյանը և բիզնես գրառումները չեն ջնջվում։ Ձեռքով գործարկում հասանելի չէ։','При включении система автоматически и безвозвратно удаляет только операционные журналы старше выбранного числа дней (7–3650), не более 500 записей в минуту. Бизнес-аудит и бизнес-записи не удаляются. Ручной запуск недоступен.','When enabled, the system automatically and permanently deletes only operational logs older than the chosen number of days (7–3650), at most 500 records per minute. Business audit and business records are never deleted. Manual runs are not available.'],
 retState:['Վիճակ','Состояние','State'],retOn:['Միացված','Включено','Enabled'],retOff:['Անջատված','Выключено','Disabled'],retDays:['Պահպանման օրեր','Дней хранения','Retention days'],
 retRevision:['Տարբերակ','Ревизия','Revision'],retUpdated:['Թարմացված','Обновлено','Updated'],
 retEligible:['Ջնջման ենթակա (պահպանված {d} օրով)','Подлежит удалению (по сохранённым {d} дн.)','Eligible for deletion (at saved {d} days)'],
 retEligibleNote:['Նախադիտումը հաշվարկվում է պահպանված կարգավորմամբ, ոչ թե մուտքագրված, դեռ չպահպանված արժեքով։','Предпросмотр считается по сохранённой настройке, а не по введённому несохранённому значению.','The preview uses the saved setting, not the unsaved value you entered.'],
 retEnable:['Միացնել ավտոմատ ջնջումը','Включить автоудаление','Enable automatic deletion'],retSave:['Պահպանել քաղաքականությունը','Сохранить политику','Save policy'],
 retDaysInvalid:['Օրերը՝ ամբողջ թիվ 7-ից 3650։','Дни — целое число от 7 до 3650.','Days must be a whole number from 7 to 3650.'],
 retReadonly:['Փոփոխելու համար անհրաժեշտ է logs.manage թույլտվություն։','Для изменения нужно разрешение logs.manage.','Changing the policy requires the logs.manage permission.'],
 retConflict:['Քաղաքականությունը փոխվել է այլ տեղ։ Տվյալները վերբեռնվել են — ստուգեք և կրկին հաստատեք։','Политика изменена в другом месте. Данные перезагружены — проверьте и подтвердите снова.','The policy was changed elsewhere. Data was reloaded — review and confirm again.'],
 retStale:['Սերվերում նոր տարբերակ կա։ Պահպանումը կմերժվի՝ նախ վերանայեք։','На сервере новая ревизия. Сохранение будет отклонено — сначала проверьте.','A newer revision exists on the server. Saving will be rejected — review first.'],
 retReview:['Վերանայել ընթացիկը','Загрузить текущую','Load current'],retSaved:['Պահպանված է, տարբերակ {r}։','Сохранено, ревизия {r}.','Saved, revision {r}.'],
 key:['Բանալի','Ключ','Key'],value:['Արժեք','Значение','Value'],status:['Կարգավիճակ','Статус','Status'],observedAt:['Դիտարկման պահը','Время наблюдения','Observed at'],unavailable:['Անհասանելի','Нет данных','Unavailable'],
};
export const ENV_LABELS:Record<string,[string,string,string]>={
 environment:['Միջավայր','Окружение','Environment'],node:['Node.js տարբերակ','Версия Node.js','Node.js version'],database_engine:['Տվյալների բազայի շարժիչ','Движок БД','Database engine'],
 storage_provider:['Պահոցի մատակարար','Провайдер хранилища','Storage provider'],email_configuration:['Էլ. փոստի կարգավորում','Настройка эл. почты','Email configuration'],cache_provider:['Քեշի մատակարար','Провайдер кэша','Cache provider'],
 operations_encryption:['Գործառնությունների գաղտնագրում','Шифрование операций','Encryption for operations'],
 redis_configuration:['Redis կարգավորում','Настройка Redis','Redis configuration'],session_secret:['Սեսիայի գաղտնիք','Секрет сеансов','Session secret'],email_webhook_secret:['Էլ. փոստի webhook գաղտնիք','Секрет почтового webhook','Email webhook secret'],
};
const ENV_VALUES:Record<string,[string,string,string]>={configured:['Կարգավորված է','Настроено','Configured'],not_configured:['Կարգավորված չէ','Не настроено','Not configured'],unavailable:['Անհասանելի','Нет данных','Unavailable']};
const t=(k:string,l:Language)=>ADMIN_S[k]?.[L(l)]??k;
export const canEnterSystem=(p:string[])=>['system.read','cache.read','sessions.read','environment.read','backups.read','api.read'].some(x=>p.includes(x));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLL=30000;
const statusOf=(e:unknown)=>typeof e==='object'&&e&&'status' in e?Number((e as {status:unknown}).status):0;
const isReauth=(e:unknown)=>{if(needsReauth(e))return true;const d=typeof e==='object'&&e&&'data' in e?(e as {data:unknown}).data:null;if(!d||typeof d!=='object')return false;const o=d as Record<string,unknown>;return o.error==='recent_authentication_required'||o.code==='recent_authentication_required'};

// Same convention as SystemConsole: poll 30s + focus; abort on key change/unmount; drop superseded results.
function usePolled<T>(fetcher:(signal:AbortSignal)=>Promise<T>,key:string){
 const [data,setData]=useState<T>();const [error,setError]=useState<unknown>();const [loading,setLoading]=useState(true);
 const ctrl=useRef<AbortController|undefined>(undefined);const fRef=useRef(fetcher);fRef.current=fetcher;
 const load=useCallback(()=>{ctrl.current?.abort();const c=new AbortController();ctrl.current=c;setLoading(true);
  fRef.current(c.signal).then(d=>{if(!c.signal.aborted){setData(d);setError(undefined)}}).catch(e=>{if(!c.signal.aborted){setError(e);setData(undefined)}}).finally(()=>{if(!c.signal.aborted)setLoading(false)})},[]);
 useEffect(()=>{setData(undefined);setError(undefined);load();const id=setInterval(load,POLL);const focus=()=>load();window.addEventListener('focus',focus);
  return()=>{clearInterval(id);window.removeEventListener('focus',focus);ctrl.current?.abort()}},[key,load]);
 return {data,error,loading,reload:load};
}
function Failure({error,l,onRetry}:{error:unknown;l:Language;onRetry:()=>void}){const st=statusOf(error);return <div className="sc-failure" role="alert" data-testid="status-error"><p className="p-error">{st===403?t('forbidden',l):t('error',l)+(st?' (HTTP '+st+')':'')}</p><button className="p-button" onClick={onRetry} data-testid="button-retry">{t('retry',l)}</button></div>}
function Skeleton(){return <div className="sc-skeleton" role="status" aria-busy="true" data-testid="status-loading"><span/><span/><span/></div>}

// Typed-confirmation + reauth wrapper for a dangerous mutation.
function Danger({l,word,title,children,go,onCancel,testid}:{l:Language;word:string;title:string;children:ReactNode;go:(signal:AbortSignal)=>Promise<string|void>;onCancel?:()=>void;testid:string}){
 const [typed,setTyped]=useState('');const [busy,setBusy]=useState(false);const [msg,setMsg]=useState<{t:string;bad?:boolean}>();const [reauth,setReauth]=useState(false);
 const ctrl=useRef<AbortController|null>(null);useEffect(()=>()=>ctrl.current?.abort(),[]);
 const submit=async(e:FormEvent)=>{e.preventDefault();if(busy||typed!==word)return;const c=new AbortController();ctrl.current=c;setBusy(true);setMsg(undefined);
  try{const r=await go(c.signal);if(c.signal.aborted)return;setTyped('');setMsg(r?{t:r}:undefined)}
  catch(x){if(c.signal.aborted)return;if(isReauth(x)){setReauth(true);return}const st=statusOf(x);setMsg({t:(st===403?t('forbidden',l):t('actionFailed',l))+(st?' (HTTP '+st+')':''),bad:true})}
  finally{if(!c.signal.aborted)setBusy(false)}};
 if(reauth)return <ReauthPrompt language={l} onDone={()=>{setReauth(false);setMsg({t:reauthDone(l)})}} onCancel={()=>setReauth(false)}/>;
 return <form className="p-card sc-card sa-danger" onSubmit={submit} data-testid={'form-'+testid}><h3>{title}</h3>{children}
  <label>{t('typeConfirm',l)} <code className="sc-mono">{word}</code><input value={typed} onChange={e=>setTyped(e.target.value)} autoComplete="off" spellCheck={false} maxLength={20} data-testid={'input-confirm-'+testid}/></label>
  <div className="cx-row"><button className="p-button orange" disabled={busy||typed!==word} data-testid={'button-confirm-'+testid}>{busy?t('loading',l):title}</button>{onCancel&&<button type="button" className="p-button" onClick={onCancel} data-testid={'button-cancel-'+testid}>{t('cancel',l)}</button>}</div>
  {msg&&<p className={msg.bad?'p-error':'p-info'} role="status" data-testid={'status-'+testid}>{msg.t}</p>}</form>;
}

export function CachePanel({ck,l,canClear}:{ck:string;l:Language;canClear:boolean}){
 const q=usePolled<SystemCache>(signal=>getSystemCache({signal,credentials:'include'}),ck+':cache');
 const [ns,setNs]=useState<'storage-health'|'all'>('storage-health');
 return <div className="sc-stack">
  <p className="p-info sc-readonly" data-testid="text-cache-scope">{t('cacheNote',l)}</p>
  {q.error?<Failure error={q.error} l={l} onRetry={q.reload}/>:!q.data?<Skeleton/>:<section className="p-card sc-card" aria-busy={q.loading}>
   <div className="sc-head"><div><span className="sc-label">{t('provider',l)}</span><strong className="sc-mono" data-testid="text-cache-provider">{q.data.provider}</strong></div><div><span className="sc-label">{t('scope',l)}</span><strong className="sc-mono" data-testid="text-cache-scope-value">{q.data.scope}</strong></div><div><span className="sc-label">{t('redis',l)}</span><span className={'p-badge sc-pill '+(q.data.redisConfigured?'green':'grey')} data-testid="status-redis">{t(q.data.redisConfigured?'yes':'no',l)}</span></div><button className="p-button small" onClick={q.reload} disabled={q.loading} data-testid="button-refresh-cache">{t('refresh',l)}</button></div>
   <div className="cx-scroll"><table className="cx-table sc-table"><thead><tr><th>{t('namespace',l)}</th><th>{t('scope',l)}</th><th>{t('entries',l)}</th><th>{t('ttl',l)}</th></tr></thead><tbody>
    {q.data.namespaces.map(n=><tr key={n.name} data-testid={'row-cache-'+n.name}><td className="sc-mono">{n.name}</td><td className="sc-mono">{n.scope}</td><td data-testid={'text-cache-entries-'+n.name}>{n.entries}</td><td>{n.ttlSeconds}</td></tr>)}
    {!q.data.namespaces.length&&<tr><td colSpan={4} className="sc-empty">—</td></tr>}
   </tbody></table></div><p className="sc-note">{t('autoRefresh',l)}</p></section>}
  {canClear&&<Danger l={l} word="CLEAR CACHE" title={t('clearTitle',l)} testid="clear-cache" go={async signal=>{
    const r=await clearSystemCache({namespace:ns,confirmation:'CLEAR CACHE'},{signal,credentials:'include',headers:getCsrfHeaders()});q.reload();
    return t('cleared',l).replace('{n}',String(r.count)).replace('{ms}',String(r.durationMs)).replace('{s}',String(r.scope))}}>
   <fieldset className="sa-radios"><legend>{t('clearWhat',l)}</legend>
    <label><input type="radio" name="ns" checked={ns==='storage-health'} onChange={()=>setNs('storage-health')} data-testid="radio-ns-storage"/> {t('nsStorage',l)}</label>
    <label><input type="radio" name="ns" checked={ns==='all'} onChange={()=>setNs('all')} data-testid="radio-ns-all"/> {t('nsAll',l)}</label></fieldset>
   <p className="sc-note">{t('clearConseq',l)}</p></Danger>}
 </div>;
}

type Target={kind:'one';s:SystemSessionsItemsItem}|{kind:'user';userId:string;name:string;includesSelf:boolean};
export function SessionsPanel({ck,l,canRevoke}:{ck:string;l:Language;canRevoke:boolean}){
 const [draft,setDraft]=useState('');const [user,setUser]=useState('');const [page,setPage]=useState(1);const [bad,setBad]=useState(false);const [target,setTarget]=useState<Target>();const [done,setDone]=useState('');
 const q=usePolled<SystemSessions>(signal=>getSystemSessions({page,...(user?{userId:user}:{})},{signal,credentials:'include'}),ck+':sessions:'+page+':'+user);
 const submit=(e:FormEvent)=>{e.preventDefault();const v=draft.trim();if(v&&!UUID.test(v)){setBad(true);return}setBad(false);setPage(1);setUser(v)};
 const items=q.data?.items??[];const nr=<span className="sc-null">{t('notRecorded',l)}</span>;
 const revoke=async(signal:AbortSignal)=>{if(!target)return;
  const r=await revokeSystemSessions({...(target.kind==='one'?{sessionRef:target.s.ref}:{userId:target.userId}),confirmation:'REVOKE'},{signal,credentials:'include',headers:getCsrfHeaders()});
  if(r.currentRevoked){location.assign(import.meta.env.BASE_URL.replace(/\/$/,'')+'/console/system/sessions');return}
  setTarget(undefined);setDone(t('revoked',l).replace('{n}',String(r.count)));q.reload()};
 return <div className="sc-stack">
  <p className="p-info sc-readonly" data-testid="text-sessions-privacy">{t('sessionsNote',l)} {t('deviceNote',l)}</p>
  <form className="p-card cx-form" role="search" onSubmit={submit} data-testid="form-session-filter"><div className="cx-filters"><label>{t('userFilter',l)}<input value={draft} maxLength={36} spellCheck={false} placeholder="xxxxxxxx-xxxx-…" aria-invalid={bad} onChange={e=>setDraft(e.target.value)} data-testid="input-session-user"/>{bad&&<small className="p-field-error">{t('invalidUuid',l)}</small>}</label></div>
   <div className="cx-row"><button className="p-button orange" data-testid="button-apply-session-filter">{t('apply',l)}</button><button type="button" className="p-button" onClick={()=>{setDraft('');setUser('');setBad(false);setPage(1)}} data-testid="button-reset-session-filter">{t('reset',l)}</button><button type="button" className="p-button" disabled={q.loading} onClick={q.reload} data-testid="button-refresh-sessions">{t('refresh',l)}</button></div></form>
  {done&&<p className="p-info" role="status" data-testid="status-revoked">{done}</p>}
  {target&&canRevoke&&<Danger key={target.kind==='one'?target.s.ref:target.userId} l={l} word="REVOKE" title={t('revokeGo',l)} testid="revoke-sessions" go={revoke} onCancel={()=>setTarget(undefined)}>
   <p><strong>{target.kind==='one'?target.s.name:target.name}</strong> <span className="sc-mono">{target.kind==='one'?target.s.ref.slice(0,12)+'…':target.userId}</span></p>
   <p className="sc-note">{t(target.kind==='one'?'revokeOneConseq':'revokeUserConseq',l)}</p>
   {(target.kind==='one'?target.s.current:target.includesSelf)&&<p className="p-error" data-testid="text-revoke-self">{t('revokeSelf',l)}</p>}</Danger>}
  {q.error?<Failure error={q.error} l={l} onRetry={q.reload}/>:!q.data?<Skeleton/>:<section className="p-card sc-card" aria-busy={q.loading}>
   <div className="sc-head"><div><span className="sc-label">{t('total',l)}</span><strong data-testid="text-sessions-total">{q.data.total}</strong></div></div>
   <div className="cx-scroll"><table className="cx-table sc-table"><thead><tr><th>{t('user',l)}</th><th>{t('ref',l)}</th><th>{t('created',l)}</th><th>{t('activity',l)}</th><th>{t('expires',l)}</th><th>{t('device',l)}</th>{canRevoke&&<th><span className="sr-only">{t('revokeOne',l)}</span></th>}</tr></thead><tbody>
    {items.map(s=><tr key={s.ref} data-testid={'row-session-'+s.ref.slice(0,16)}>
     <td><strong>{s.name}</strong>{s.current&&<> <span className="p-badge sc-pill amber" data-testid="status-current-session">{t('current',l)}</span></>}<br/><small className="sc-mono">{s.userId}</small></td>
     <td className="sc-mono" title={s.ref}>{s.ref.slice(0,12)}…</td><td>{s.createdAt?fmtDate(s.createdAt,l):nr}</td><td>{s.lastActivityAt?fmtDate(s.lastActivityAt,l):nr}</td><td>{fmtDate(s.expiresAt,l)}</td><td>{s.device?s.device.replace('Unknown browser',t('unknownBrowser',l)).replace('Unknown device',t('unknownDevice',l)):nr}</td>
     {canRevoke&&<td><div className="cx-row"><button className="p-button small" onClick={()=>{setDone('');setTarget({kind:'one',s})}} data-testid={'button-revoke-session-'+s.ref.slice(0,16)}>{t('revokeOne',l)}</button><button className="p-button small" onClick={()=>{setDone('');setTarget({kind:'user',userId:s.userId,name:s.name,includesSelf:items.some(x=>x.userId===s.userId&&x.current)})}} data-testid={'button-revoke-user-'+s.ref.slice(0,16)}>{t('revokeUser',l)}</button></div></td>}
    </tr>)}
    {!items.length&&<tr><td colSpan={canRevoke?7:6} className="sc-empty" data-testid="text-empty">{t('empty',l)}</td></tr>}
   </tbody></table></div>
   <div className="cx-row" aria-live="polite"><button className="p-button" disabled={q.loading||page<=1} onClick={()=>setPage(p=>p-1)} data-testid="button-prev-sessions">{t('prev',l)}</button><span data-testid="text-page-sessions">{t('page',l)} {page}</span><button className="p-button" disabled={q.loading||!q.data.hasMore} onClick={()=>setPage(p=>p+1)} data-testid="button-next-sessions">{t('next',l)}</button></div>
   <p className="sc-note">{t('autoRefresh',l)}</p></section>}
 </div>;
}

export function EnvironmentPanel({ck,l}:{ck:string;l:Language}){
 const q=usePolled<SystemOverview>(signal=>getSystemEnvironment({signal,credentials:'include'}),ck+':environment');
 return <div className="sc-stack"><p className="p-info sc-readonly" data-testid="text-environment-readonly">{t('envNote',l)}</p><p className="sc-note" data-testid="text-env-encryption-note">{t('encNote',l)}</p>
  {q.error?<Failure error={q.error} l={l} onRetry={q.reload}/>:!q.data?<Skeleton/>:<section className="p-card sc-card" aria-busy={q.loading}>
   <div className="sc-head"><div><span className="sc-label">{t('observedAt',l)}</span><strong data-testid="text-env-observed">{fmtDate(q.data.observedAt,l)}</strong></div><button className="p-button small" onClick={q.reload} disabled={q.loading} data-testid="button-refresh-environment">{t('refresh',l)}</button></div>
   <div className="cx-scroll"><table className="cx-table sc-table"><thead><tr><th>{t('key',l)}</th><th>{t('value',l)}</th></tr></thead><tbody>
    {q.data.metrics.map(m=><tr key={m.key} data-testid={'row-env-'+m.key}><td>{ENV_LABELS[m.key]?.[L(l)]??m.key}<br/><small className="sc-mono">{m.key}</small></td><td className={'sc-mono'+(m.value===null?' sc-null':'')} data-testid={'text-env-'+m.key}>{m.value===null?t('unavailable',l):(ENV_VALUES[String(m.value)]?.[L(l)]??m.value)}</td></tr>)}
    {!q.data.metrics.length&&<tr><td colSpan={2} className="sc-empty">—</td></tr>}
   </tbody></table></div><p className="sc-note">{t('autoRefresh',l)}</p></section>}
 </div>;
}

export function RetentionPanel({ck,l,canManage}:{ck:string;l:Language;canManage:boolean}){
 const q=usePolled<GetSystemLogRetention200>(signal=>getSystemLogRetention({signal,credentials:'include'}),ck+':retention');
 const [base,setBase]=useState<GetSystemLogRetention200>();const [enabled,setEnabled]=useState(false);const [days,setDays]=useState('');
 const [typed,setTyped]=useState('');const [busy,setBusy]=useState(false);const [msg,setMsg]=useState<{t:string;bad?:boolean}>();const [reauth,setReauth]=useState(false);
 const ctrl=useRef<AbortController|null>(null);useEffect(()=>()=>ctrl.current?.abort(),[]);
 const adopt=(d:GetSystemLogRetention200)=>{setBase(d);setEnabled(d.enabled);setDays(String(d.days));setTyped('')};
 const want=useRef(true);
 useEffect(()=>{if(q.data&&want.current){want.current=false;adopt(q.data)}},[q.data]);
 const n=Number(days);const daysOk=/^\d+$/.test(days)&&n>=7&&n<=3650;
 const stale=!!(q.data&&base&&q.data.revision!==base.revision);
 const save=async(e:FormEvent)=>{e.preventDefault();if(!base||busy||!daysOk||typed!=='RETENTION')return;const c=new AbortController();ctrl.current=c;setBusy(true);setMsg(undefined);
  try{const r=await saveSystemLogRetention({enabled,days:n,revision:base.revision,confirmation:'RETENTION'},{signal:c.signal,credentials:'include',headers:getCsrfHeaders()});if(c.signal.aborted)return;
   want.current=true;setTyped('');setMsg({t:t('retSaved',l).replace('{r}',String(r.revision))});q.reload()}
  catch(x){if(c.signal.aborted)return;if(isReauth(x)){setReauth(true);return}const st=statusOf(x);
   if(st===409){want.current=true;setTyped('');setMsg({t:t('retConflict',l),bad:true});q.reload();return}
   setMsg({t:(st===403?t('forbidden',l):t('actionFailed',l))+(st?' (HTTP '+st+')':''),bad:true})}
  finally{if(!c.signal.aborted)setBusy(false)}};
 const d=q.data;
 return <div className="sc-stack"><p className="p-info sc-readonly" data-testid="text-retention-warning">{t('retWarn',l)}</p>
  {q.error?<Failure error={q.error} l={l} onRetry={q.reload}/>:!d?<Skeleton/>:<section className="p-card sc-card" aria-busy={q.loading}>
   <div className="sc-head"><div><span className="sc-label">{t('retState',l)}</span><span className={'p-badge sc-pill '+(d.enabled?'amber':'grey')} data-testid="status-retention-enabled">{t(d.enabled?'retOn':'retOff',l)}</span></div>
    <div><span className="sc-label">{t('retDays',l)}</span><strong data-testid="text-retention-days">{d.days}</strong></div>
    <div><span className="sc-label">{t('retRevision',l)}</span><strong data-testid="text-retention-revision">{d.revision}</strong></div>
    <div><span className="sc-label">{t('retUpdated',l)}</span><strong data-testid="text-retention-updated">{fmtDate(d.updatedAt,l)}</strong></div>
    <button className="p-button small" onClick={q.reload} disabled={q.loading} data-testid="button-refresh-retention">{t('refresh',l)}</button></div>
   <div><span className="sc-label">{t('retEligible',l).replace('{d}',String(d.days))}</span> <strong data-testid="text-retention-eligible">{d.eligible}</strong></div>
   <p className="sc-note">{t('retEligibleNote',l)}</p><p className="sc-note">{t('autoRefresh',l)}</p></section>}
  {!canManage?<p className="sc-note" data-testid="text-retention-readonly">{t('retReadonly',l)}</p>:reauth?<ReauthPrompt language={l} onDone={()=>{setReauth(false);setMsg({t:reauthDone(l)})}} onCancel={()=>setReauth(false)}/>:base&&
   <form className="p-card sc-card sa-danger" onSubmit={save} data-testid="form-retention"><h3>{t('retTitle',l)}</h3>
    {stale&&<div className="p-error" role="alert" data-testid="status-retention-stale">{t('retStale',l)} <button type="button" className="p-button small" onClick={()=>{if(q.data){adopt(q.data);setMsg(undefined)}}} data-testid="button-retention-review">{t('retReview',l)}</button></div>}
    <label className="sa-check"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} data-testid="checkbox-retention-enabled"/> {t('retEnable',l)}</label>
    <label>{t('retDays',l)}<input type="number" min={7} max={3650} step={1} value={days} aria-invalid={!daysOk} onChange={e=>setDays(e.target.value)} data-testid="input-retention-days"/>{!daysOk&&<small className="p-field-error">{t('retDaysInvalid',l)}</small>}</label>
    <p className="sc-note">{t('retWarn',l)}</p>
    <label>{t('typeConfirm',l)} <code className="sc-mono">RETENTION</code><input value={typed} onChange={e=>setTyped(e.target.value)} autoComplete="off" spellCheck={false} maxLength={20} data-testid="input-confirm-retention"/></label>
    <div className="cx-row"><button className="p-button orange" disabled={busy||!daysOk||typed!=='RETENTION'||stale} data-testid="button-save-retention">{busy?t('loading',l):t('retSave',l)}</button></div>
   </form>}
  {msg&&<p className={msg.bad?'p-error':'p-info'} role="status" data-testid="status-retention">{msg.t}</p>}
 </div>;
}
