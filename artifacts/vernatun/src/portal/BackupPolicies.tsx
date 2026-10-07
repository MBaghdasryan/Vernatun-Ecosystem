import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {getSystemBackupPolicies,updateSystemBackupPolicy,type BackupPolicy,type BackupPolicyInputFrequency,type BackupPolicyInputProvider} from '@workspace/api-client-react';
import {fmtDate} from './console-util';
import {getCsrfHeaders} from './client';
import {ReauthPrompt,needsReauth,reauthDone} from './Reauth';
import type {Language} from './i18n';

type T3=[string,string,string];
const L=(l:Language)=>l==='hy'?0:l==='ru'?1:2;
const S:Record<string,T3>={
 title:['Պահուստավորման քաղաքականություններ','Политики резервного копирования','Backup policies'],
 intro:['Ժամանակացույցերը լռելյայն անջատված են։ Առաջին գործարկումը տեղի է ունենում միացնելուց կամ հաճախականությունը փոխելուց մեկ ինտերվալ հետո՝ UTC օրացույցով (ամսականը՝ օրացուցային ամիս)։ Բաց թողնված գործարկումները միավորվում են մեկում և կարող են սպասել ակտիվ հերթի ավարտին։ Ժամանակացույցը կանգնեցնելը չի չեղարկում արդեն հերթագրված պատճենը։','По умолчанию расписания выключены. Первый запуск — через один интервал после включения или смены частоты, по календарю UTC (ежемесячно — календарный месяц). Пропущенные запуски объединяются в один и могут ждать завершения активной очереди. Остановка расписания не отменяет уже поставленную в очередь копию.','Schedules are disabled by default. The first run is due one interval after enabling or changing frequency, on a UTC calendar (monthly means calendar month). Missed runs are coalesced into one and may wait behind an active queue. Stopping a schedule does not cancel a backup that is already queued.'],
 kind:['Տեսակ','Тип','Kind'],state:['Վիճակ','Состояние','State'],on:['Միացված','Включено','Enabled'],off:['Անջատված','Выключено','Disabled'],
 frequency:['Հաճախականություն','Частота','Frequency'],daily:['Ամենօրյա','Ежедневно','Daily'],weekly:['Շաբաթական','Еженедельно','Weekly'],monthly:['Ամսական','Ежемесячно','Monthly'],
 provider:['Պահոց','Хранилище','Storage'],app_storage:['App Storage','App Storage','App Storage'],local:['Տեղային','Локальное','Local'],s3:['S3','S3','S3'],notConfigured:['կարգավորված չէ','не настроено','not configured'],
 retention:['Պահպանում (օր)','Хранение (дн.)','Retention (days)'],keepLast:['Պահել վերջին','Хранить последние','Keep last'],autoDelete:['Ավտոջնջում','Автоудаление','Auto-delete'],
 nextRun:['Հաջորդ գործարկում','Следующий запуск','Next run'],lastQueued:['Վերջին հերթագրում','Последняя постановка','Last queued'],revision:['Տարբերակ','Ревизия','Revision'],never:['Երբեք','Никогда','Never'],notScheduled:['Պլանավորված չէ','Не запланировано','Not scheduled'],
 edit:['Խմբագրել','Изменить','Edit'],close:['Փակել','Закрыть','Close'],save:['Պահպանել քաղաքականությունը','Сохранить политику','Save policy'],loading:['Բեռնվում է…','Загрузка…','Loading…'],
 enable:['Միացնել ժամանակացույցը','Включить расписание','Enable schedule'],
 retentionHint:['30–3650 օր․ 30 օրը նվազագույնն է։','30–3650 дней; 30 — минимум.','30–3650 days; 30 is the floor.'],keepHint:['1–100 վերջին ստուգված պլանավորված պատճեն միշտ պահվում է։','1–100 последних проверенных плановых копий всегда сохраняются.','1–100 latest verified scheduled copies are always kept.'],
 badRetention:['Մուտքագրեք ամբողջ թիվ 30-ից 3650։','Введите целое число от 30 до 3650.','Enter a whole number from 30 to 3650.'],badKeep:['Մուտքագրեք ամբողջ թիվ 1-ից 100։','Введите целое число от 1 до 100.','Enter a whole number from 1 to 100.'],
 autoTitle:['Ավտոմատ ջնջում (կամընտիր, լռելյայն անջատված)','Автоматическое удаление (по выбору, по умолчанию выключено)','Automatic deletion (opt-in, off by default)'],
 autoWarn:['Միացնելիս համակարգը անդառնալիորեն կջնջի միայն այս քաղաքականության սեփական, ստուգված պլանավորված պատճենները, որոնք հին են և՛ ընթացիկ պահպանման ժամկետից, և՛ իրենց սկզբնական պահման ժամկետից, միշտ պահելով վերջին «Պահել վերջին» քանակը։ Ձեռքով ստեղծված պատճենները երբեք ավտոմատ չեն ջնջվում։ Անջատված քաղաքականությունը նշանակում է, որ մաքրումը նույնպես անջատված է։ Ջնջված պատճենը վերականգնել հնարավոր չէ։','При включении система безвозвратно удаляет только собственные проверенные плановые копии этой политики, которые старше и текущего срока хранения, и своего исходного срока удержания, всегда сохраняя последние «Хранить последние». Ручные копии никогда не удаляются автоматически. Выключенная политика означает, что очистка тоже выключена. Удалённую копию восстановить нельзя.','When enabled, the system permanently deletes only this policy\'s own verified scheduled copies that are older than both the current retention and their original hold, always keeping the latest Keep-last count. Manual backups are never auto-deleted. A disabled policy means cleanup is off too. A deleted copy cannot be recovered.'],
 autoAck:['Ես հասկանում եմ, որ ավտոջնջումը անդառնալի է։','Я понимаю, что автоудаление необратимо.','I understand automatic deletion is irreversible.'],
 typeConfirm:['Հաստատելու համար մուտքագրեք','Для подтверждения введите','Type to confirm'],
 stale:['Այս քաղաքականությունը փոխվել է սերվերում ձեր խմբագրման ընթացքում։ Պահպանումն անջատված է՝ վերանայեք ընթացիկ վիճակը։','Политика изменилась на сервере во время редактирования. Сохранение отключено — загрузите текущее состояние.','This policy changed on the server while you were editing. Saving is disabled — review the current state.'],
 review:['Բեռնել ընթացիկը','Загрузить текущее','Load current'],
 saved:['Պահպանված է, տարբերակ {r}։','Сохранено, ревизия {r}.','Saved, revision {r}.'],
 empty:['Քաղաքականություններ չկան։','Политик нет.','No policies.'],readonly:['Փոփոխելու համար անհրաժեշտ է backups.policies.manage թույլտվություն։','Для изменения нужно разрешение backups.policies.manage.','Editing requires the backups.policies.manage permission.'],
 encOff:['Գաղտնագրման բանալին կարգավորված չէ․ պլանավորված պատճենները չեն ստեղծվի։','Ключ шифрования не настроен — плановые копии не будут создаваться.','The encryption key is not configured — scheduled backups will not be created.'],
 forbidden:['Այս բաժնի համար թույլտվություն չկա։','Нет разрешения на этот раздел.','You do not have permission for this section.'],error:['Չհաջողվեց բեռնել տվյալները։','Не удалось загрузить данные.','Could not load data.'],retry:['Կրկնել','Повторить','Retry'],refresh:['Թարմացնել','Обновить','Refresh'],
 enableBlocked:['Միացված ժամանակացույցը պահպանել հնարավոր չէ, քանի դեռ գաղտնագրման բանալին կարգավորված չէ Secrets-ում։ Անջատելը հասանելի է։','Нельзя сохранить включённое расписание, пока ключ шифрования не настроен в Secrets. Выключить можно.','An enabled schedule cannot be saved until the encryption key is configured in Secrets. Disabling is allowed.'],
 providerBlocked:['Միացված ժամանակացույցի համար ընտրեք կարգավորված պահոցը։ Անջատելիս պահպանված պահոցը մնում է անփոփոխ։','Для включённого расписания выберите настроенное хранилище. При выключении сохранённое хранилище не меняется.','An enabled schedule needs the configured provider. Disabling keeps the saved provider unchanged.'],
 dirty:['Չպահպանված փոփոխություններ','Несохранённые изменения','Unsaved changes'],
};
const ERR:Record<string,T3>={
 backup_policy_changed:['Քաղաքականությունը փոխվել է այլ տեղ։ Պահպանված վիճակը վերբեռնվել է — վերանայեք և կրկին հաստատեք։','Политика изменена в другом месте. Сохранённое состояние перезагружено — проверьте и подтвердите снова.','The policy was changed elsewhere. The saved state was reloaded — review and confirm again.'],
 backup_storage_provider_changed:['Ընտրված պահոցը այլևս կարգավորված չէ։ Ընտրեք կարգավորված պահոցը։','Выбранное хранилище больше не настроено. Выберите настроенное.','The chosen storage is no longer configured. Choose the configured provider.'],
 backup_storage_not_configured:['Պահոցը կարգավորված չէ։','Хранилище не настроено.','Backup storage is not configured.'],
 operations_encryption_not_configured:['Գաղտնագրման բանալին կարգավորված չէ Secrets-ում։','Ключ шифрования не настроен в Secrets.','The encryption key is not configured in Secrets.'],
 failed:['Գործողությունը չհաջողվեց։','Действие не выполнено.','The action failed.'],
};
const FREQ:BackupPolicyInputFrequency[]=['daily','weekly','monthly'];
const PROV:BackupPolicyInputProvider[]=['app_storage','local','s3'];
const POLL=30000;
const statusOf=(e:unknown)=>typeof e==='object'&&e&&'status' in e?Number((e as {status:unknown}).status):0;
const codeOf=(e:unknown)=>{if(typeof e==='object'&&e&&'code' in e&&typeof (e as {code:unknown}).code==='string')return (e as {code:string}).code;const d=typeof e==='object'&&e&&'data' in e?(e as {data:unknown}).data:null;if(d&&typeof d==='object'){const o=d as Record<string,unknown>;if(typeof o.error==='string')return o.error;if(typeof o.code==='string')return o.code}return ''};
const isReauth=(e:unknown)=>needsReauth(e)||codeOf(e)==='recent_authentication_required';

type Draft={enabled:boolean;frequency:string;provider:string;retentionDays:string;keepLast:string;autoDelete:boolean};
const toDraft=(p:BackupPolicy):Draft=>({enabled:p.enabled,frequency:p.frequency,provider:p.provider,retentionDays:String(p.retentionDays),keepLast:String(p.keepLast),autoDelete:p.autoDelete});
const same=(a:Draft,b:Draft)=>JSON.stringify(a)===JSON.stringify(b);

export default function BackupPolicies({ck,l,canManage,provider,encryption,kindLabel}:{ck:string;l:Language;canManage:boolean;provider:string|null;encryption:string;kindLabel:(k:string)=>string}){
 const t=(k:string)=>S[k]?.[L(l)]??k;
 const [data,setData]=useState<BackupPolicy[]>();const [error,setError]=useState<unknown>();const [loading,setLoading]=useState(true);
 const ctrl=useRef<AbortController|undefined>(undefined);
 const load=useCallback(()=>{ctrl.current?.abort();const c=new AbortController();ctrl.current=c;setLoading(true);
  getSystemBackupPolicies({signal:c.signal,credentials:'include'}).then(d=>{if(!c.signal.aborted){setData(d);setError(undefined)}}).catch(e=>{if(!c.signal.aborted){setError(e);setData(undefined)}}).finally(()=>{if(!c.signal.aborted)setLoading(false)})},[]);
 useEffect(()=>{setData(undefined);setError(undefined);load();const id=setInterval(load,POLL);const f=()=>load();window.addEventListener('focus',f);return()=>{clearInterval(id);window.removeEventListener('focus',f);ctrl.current?.abort()}},[ck,load]);
 const [open,setOpen]=useState<string>();
 const st=statusOf(error);
 return <section className="p-card sc-card bp-wrap" aria-busy={loading} data-testid="section-backup-policies">
  <div className="sc-head"><h3 className="sb-h">{t('title')}</h3><button className="p-button small" onClick={load} disabled={loading} data-testid="button-refresh-policies">{t('refresh')}</button></div>
  <p className="sc-note">{t('intro')}</p>
  {encryption!=='configured'&&<p className="p-error" data-testid="text-policy-encryption">{t('encOff')}</p>}
  {!canManage&&<p className="sc-note" data-testid="text-policy-readonly">{t('readonly')}</p>}
  {error?<div className="sc-failure" role="alert" data-testid="status-policies-error"><p className="p-error">{st===403?t('forbidden'):t('error')+(st?' (HTTP '+st+')':'')}</p><button className="p-button" onClick={load} data-testid="button-retry-policies">{t('retry')}</button></div>
  :!data?<div className="sc-skeleton" role="status" aria-busy="true"><span/><span/></div>
  :!data.length?<p className="sc-empty" data-testid="text-policies-empty">{t('empty')}</p>
  :<ul className="bp-list">{data.map(p=><li key={p.kind} className={'bp-item'+(p.enabled?' on':'')} data-testid={'row-policy-'+p.kind}>
    <div className="bp-summary">
     <div className="bp-title"><strong>{kindLabel(p.kind)}</strong><span className={'p-badge sc-pill '+(p.enabled?'green':'grey')} data-testid={'status-policy-'+p.kind}>{t(p.enabled?'on':'off')}</span>{p.autoDelete&&<span className="p-badge sc-pill amber" data-testid={'status-policy-autodelete-'+p.kind}>{t('autoDelete')}</span>}</div>
     <dl className="bp-facts">
      <div><dt>{t('frequency')}</dt><dd>{t(p.frequency)}</dd></div>
      <div><dt>{t('provider')}</dt><dd className="sc-mono">{t(p.provider)}{p.provider!==provider&&<small className="sc-null"> · {t('notConfigured')}</small>}</dd></div>
      <div><dt>{t('retention')}</dt><dd>{p.retentionDays}</dd></div>
      <div><dt>{t('keepLast')}</dt><dd>{p.keepLast}</dd></div>
      <div><dt>{t('nextRun')}</dt><dd data-testid={'text-policy-next-'+p.kind}>{p.enabled&&p.nextRunAt?new Intl.DateTimeFormat(l==='hy'?'hy-AM':l==='ru'?'ru-RU':'en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(p.nextRunAt))+' UTC':t('notScheduled')}</dd></div>
      <div><dt>{t('lastQueued')}</dt><dd>{p.lastQueuedAt?fmtDate(p.lastQueuedAt,l):t('never')}</dd></div>
      <div><dt>{t('revision')}</dt><dd>{p.revision}</dd></div>
     </dl>
     {canManage&&<button className="p-button small" aria-expanded={open===p.kind} onClick={()=>setOpen(o=>o===p.kind?undefined:p.kind)} data-testid={'button-edit-policy-'+p.kind}>{open===p.kind?t('close'):t('edit')}</button>}
    </div>
    {canManage&&open===p.kind&&<Editor key={ck+':'+p.kind} saved={p} t={t} l={l} provider={provider} encryption={encryption} reload={load}/>}
   </li>)}</ul>}
 </section>;
}

function Editor({saved,t,l,provider,encryption,reload}:{saved:BackupPolicy;t:(k:string)=>string;l:Language;provider:string|null;encryption:string;reload:()=>void}){
 // Draft is seeded once from a baseline; polling only updates `saved`, never the draft.
 const [base,setBase]=useState(saved);const [d,setD]=useState<Draft>(()=>toDraft(saved));
 const [typed,setTyped]=useState('');const [ack,setAck]=useState(false);const [busy,setBusy]=useState(false);const [msg,setMsg]=useState<{t:string;bad?:boolean}>();const [reauth,setReauth]=useState(false);
 const adoptNext=useRef(false);const c=useRef<AbortController|null>(null);useEffect(()=>()=>c.current?.abort(),[]);
 const adopt=(p:BackupPolicy)=>{setBase(p);setD(toDraft(p));setTyped('');setAck(false)};
 useEffect(()=>{if(adoptNext.current&&saved.revision!==base.revision){adoptNext.current=false;adopt(saved)}},[saved,base.revision]);
 const stale=saved.revision!==base.revision;
 const r=Number(d.retentionDays),k=Number(d.keepLast);
 const rOk=/^\d+$/.test(d.retentionDays)&&r>=30&&r<=3650,kOk=/^\d+$/.test(d.keepLast)&&k>=1&&k<=100;
 // Disabled saves are always allowed and keep the saved provider; only enabled saves need config.
 const provOk=!d.enabled||d.provider===provider;
 const encOk=!d.enabled||encryption==='configured';
 const needAck=d.autoDelete&&(!base.autoDelete||(d.enabled&&!base.enabled));
 const dirty=!same(d,toDraft(base));
 const can=!busy&&!stale&&rOk&&kOk&&provOk&&encOk&&(!needAck||ack)&&typed==='BACKUP POLICY'&&dirty;
 const set=<K extends keyof Draft>(key:K,v:Draft[K])=>setD(x=>({...x,[key]:v}));
 const submit=async(e:FormEvent)=>{e.preventDefault();if(!can)return;const ac=new AbortController();c.current=ac;setBusy(true);setMsg(undefined);
  try{const p=await updateSystemBackupPolicy(base.kind,{enabled:d.enabled,frequency:d.frequency as BackupPolicyInputFrequency,provider:d.provider as BackupPolicyInputProvider,retentionDays:r,keepLast:k,autoDelete:d.autoDelete,revision:base.revision,confirmation:'BACKUP POLICY'},{signal:ac.signal,credentials:'include',headers:getCsrfHeaders()});
   if(ac.signal.aborted)return;adopt(p);setMsg({t:t('saved').replace('{r}',String(p.revision))});reload()}
  catch(x){if(ac.signal.aborted)return;if(isReauth(x)){setReauth(true);return}const code=codeOf(x);
   if(code==='backup_policy_changed'||statusOf(x)===409){adoptNext.current=true;setTyped('');setAck(false);reload()}
   setMsg({t:(ERR[code]??(statusOf(x)===409?ERR.backup_policy_changed:ERR.failed))[L(l)],bad:true})}
  finally{if(!ac.signal.aborted)setBusy(false)}};
 if(reauth)return <ReauthPrompt language={l} onDone={()=>{setReauth(false);setMsg({t:reauthDone(l)})}} onCancel={()=>setReauth(false)}/>;
 const id=base.kind;
 return <form className="bp-editor sa-danger" onSubmit={submit} data-testid={'form-policy-'+id}>
  {stale&&<div className="p-error bp-stale" role="alert" data-testid={'status-policy-stale-'+id}>{t('stale')} <button type="button" className="p-button small" onClick={()=>{adoptNext.current=false;adopt(saved);setMsg(undefined)}} data-testid={'button-policy-review-'+id}>{t('review')}</button></div>}
  <label className="sa-check"><input type="checkbox" checked={d.enabled} onChange={e=>{const on=e.target.checked;setD(x=>({...x,enabled:on,provider:on?x.provider:base.provider}))}} data-testid={'checkbox-policy-enabled-'+id}/> {t('enable')}</label>
  {d.enabled&&!encOk&&<p className="p-error" data-testid={'text-policy-enable-blocked-'+id}>{t('enableBlocked')}</p>}
  {d.enabled&&!provOk&&<p className="p-error" data-testid={'text-policy-provider-blocked-'+id}>{t('providerBlocked')}</p>}
  <div className="bp-grid">
   <fieldset className="sa-radios"><legend>{t('frequency')}</legend>{FREQ.map(f=><label key={f}><input type="radio" name={'freq-'+id} checked={d.frequency===f} onChange={()=>set('frequency',f)} data-testid={'radio-policy-frequency-'+id+'-'+f}/> {t(f)}</label>)}</fieldset>
   <fieldset className="sa-radios"><legend>{t('provider')}</legend>{PROV.map(p=>{const off=d.enabled?p!==provider:p!==base.provider;return <label key={p}><input type="radio" name={'prov-'+id} checked={d.provider===p} disabled={off} onChange={()=>set('provider',p)} data-testid={'radio-policy-provider-'+id+'-'+p}/> <span className="sc-mono">{t(p)}</span>{p!==provider&&<small className="sc-null"> · {t('notConfigured')}</small>}</label>})}</fieldset>
   <label>{t('retention')}<input type="number" min={30} max={3650} step={1} value={d.retentionDays} aria-invalid={!rOk} onChange={e=>set('retentionDays',e.target.value)} data-testid={'input-policy-retention-'+id}/><small className={rOk?'sc-note':'p-field-error'}>{rOk?t('retentionHint'):t('badRetention')}</small></label>
   <label>{t('keepLast')}<input type="number" min={1} max={100} step={1} value={d.keepLast} aria-invalid={!kOk} onChange={e=>set('keepLast',e.target.value)} data-testid={'input-policy-keep-'+id}/><small className={kOk?'sc-note':'p-field-error'}>{kOk?t('keepHint'):t('badKeep')}</small></label>
  </div>
  <div className={'bp-auto'+(d.autoDelete?' armed':'')}>
   <label className="sa-check"><input type="checkbox" checked={d.autoDelete} onChange={e=>{set('autoDelete',e.target.checked);setAck(false)}} data-testid={'checkbox-policy-autodelete-'+id}/> <strong>{t('autoTitle')}</strong></label>
   <p className="p-error">{t('autoWarn')}</p>
   {needAck&&<label className="sa-check"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} data-testid={'checkbox-policy-ack-'+id}/> {t('autoAck')}</label>}
  </div>
  <label>{t('typeConfirm')} <code className="sc-mono">BACKUP POLICY</code><input value={typed} onChange={e=>setTyped(e.target.value)} autoComplete="off" spellCheck={false} maxLength={20} data-testid={'input-policy-confirm-'+id}/></label>
  <div className="cx-row"><button className="p-button orange" disabled={!can} data-testid={'button-save-policy-'+id}>{busy?t('loading'):t('save')}</button>{dirty&&<small className="sc-note">{t('dirty')}</small>}</div>
  {msg&&<p className={msg.bad?'p-error':'p-info'} role="status" data-testid={'status-policy-'+id+'-message'}>{msg.t}</p>}
 </form>;
}
