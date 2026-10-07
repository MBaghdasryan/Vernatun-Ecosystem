import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {getSystemBackups,createSystemBackup,verifySystemBackup,downloadSystemBackup,deleteSystemBackup,type SystemBackups as Registry,type SystemBackupsItemsItem as Backup,type SystemBackupCreateInputKind} from '@workspace/api-client-react';
import {fmtDate} from './console-util';
import {getCsrfHeaders} from './client';
import {ReauthPrompt,needsReauth,reauthDone} from './Reauth';
import type {Language} from './i18n';

type T3=[string,string,string];
const L=(l:Language)=>l==='hy'?0:l==='ru'?1:2;
const S:Record<string,T3>={
 title:['Պահուստային պատճեններ','Резервные копии','Backups'],
 loading:['Բեռնվում է…','Загрузка…','Loading…'],retry:['Կրկնել','Повторить','Retry'],refresh:['Թարմացնել','Обновить','Refresh'],cancel:['Չեղարկել','Отмена','Cancel'],
 forbidden:['Այս բաժնի համար թույլտվություն չկա։','Нет разрешения на этот раздел.','You do not have permission for this section.'],error:['Չհաջողվեց բեռնել տվյալները։','Не удалось загрузить данные.','Could not load data.'],
 autoRefresh:['Ավտոթարմացում՝ 30 վ','Автообновление: 30 с','Auto-refresh: 30 s'],typeConfirm:['Հաստատելու համար մուտքագրեք','Для подтверждения введите','Type to confirm'],
 readiness:['Պատրաստվածություն','Готовность','Readiness'],encryption:['Գաղտնագրում','Шифрование','Encryption'],provider:['Պահոց','Хранилище','Storage'],source:['Հարթակի աղբյուր','Исходники платформы','Platform source'],restore:['Վերականգնում','Восстановление','Restore'],limit:['Սահմանաչափ','Лимит','Limit'],
 configured:['Կարգավորված է','Настроено','Configured'],not_configured:['Կարգավորված չէ','Не настроено','Not configured'],unavailable:['Անհասանելի','Нет данных','Unavailable'],available:['Հասանելի','Доступны','Available'],
 isolated_manual:['Միայն մեկուսացված, ձեռքով','Только изолированно, вручную','Isolated and manual only'],
 limitValue:['{m} ՄիԲ տրամաբանական snapshot · 5000 ֆայլ','{m} МиБ логического снимка · 5000 файлов','{m} MiB logical snapshot · 5000 files'],
 encMissing:['Գործառնությունների գաղտնագրման բանալին կարգավորված չէ։ Պատճեններ ստեղծել հնարավոր չէ, քանի դեռ ադմինիստրատորը այն չի ավելացրել Secrets-ում։ Այստեղ բանալի մուտքագրել կամ ցուցադրել հնարավոր չէ։','Ключ шифрования операций не настроен. Создавать копии нельзя, пока администратор не добавит его в Secrets. Ввести или показать ключ здесь невозможно.','The operations encryption key is not configured. Backups cannot be created until an administrator adds it in Secrets. The key cannot be entered or revealed here.'],
 providerMissing:['Պահուստային պահոցը կարգավորված չէ։ Ստեղծումն անջատված է։','Хранилище резервных копий не настроено. Создание отключено.','Backup storage is not configured. Creation is disabled.'],
 scopeNote:['AppStorage-ն օգտագործում է հավելվածի նույն bucket-ը․ սա անկախ աղետից վերականգնում չէ։ Միայն Local մատակարարն է սահմանափակված մշակմամբ։ S3-ը կարգավորելի է, բայց ինքնաբերաբար ակտիվ չէ։','AppStorage использует тот же bucket, что и приложение: это не независимое аварийное восстановление. Только Local ограничен средой разработки. S3 настраивается отдельно и не считается активным по умолчанию.','AppStorage uses the application’s bucket: this is not independent disaster recovery. Only Local is restricted to development. S3 is configured separately and is not assumed live.'],
 restoreNote:['Վերականգնումը կատարվում է միայն ձեռքով, մեկուսացված միջավայրում։ Այս վահանակից վերականգնում չկա։ Ժամանակացույցեր դեռ իրականացված չեն։','Восстановление выполняется только вручную в изолированной среде. Из этой консоли восстановить нельзя. Расписания пока не реализованы.','Restore is performed only manually in an isolated environment. There is no restore from this console. Schedules are not implemented yet.'],
 verifyNote:['Ստուգումը հաստատում է գաղտնագրված փաթեթի ամբողջականությունը և բաղադրիչների checksum-ները, ոչ թե վերականգնման հաջող փորձ։','Проверка подтверждает целостность зашифрованного пакета и контрольные суммы компонентов, а не успешную репетицию восстановления.','Verification confirms the authenticated encrypted payload and component checksums, not a successful restore rehearsal.'],
 createTitle:['Ստեղծել պատճեն','Создать копию','Create backup'],kind:['Տեսակ','Тип','Kind'],notes:['Նշում (մինչև 300 նիշ)','Заметка (до 300 символов)','Note (up to 300 characters)'],
 createWarn:['Պատճենը հերթագրվում է և կատարվում աշխատողի կողմից։ Կատարման ընթացքում գրառումները կարող են կարճ արգելափակվել․ զբաղված բազայի դեպքում պատճենը ձախողվում է՝ չսպասելով։ Նվազագույն պահպանում՝ 30 օր։','Копия ставится в очередь и выполняется воркером. Во время выполнения запись может ненадолго блокироваться; при занятой БД копия завершается ошибкой, а не ждёт. Минимальное хранение — 30 дней.','The backup is queued and run by a worker. Writes may be briefly blocked while it runs; if the database is busy the backup fails rather than waiting. Minimum retention is 30 days.'],
 sourceOff:['Հասանելի չէ․ գործարկման միջավայրում աղբյուրը չկա','Недоступно: в среде выполнения нет исходников','Unavailable: runtime does not include source'],
 queued:['Հերթագրված է։ Պատճենը պատրաստ չէ, քանի դեռ կարգավիճակը «Ավարտված» չէ։','Поставлено в очередь. Копия не готова, пока статус не станет «Завершено».','Queued. The backup is not ready until its status is Completed.'],
 queue:['Հերթ և պատմություն','Очередь и история','Queue and history'],empty:['Պատճեններ դեռ չկան։','Копий пока нет.','No backups yet.'],
 emptyReady:['Պատրաստ է առաջին պատճենին։','Готово к первой копии.','Ready for the first backup.'],emptyBlocked:['Պատճեններ չկան և ստեղծումը արգելափակված է կարգավորմամբ։','Копий нет, создание заблокировано настройкой.','No backups, and creation is blocked by configuration.'],
 created:['Ստեղծված','Создано','Created'],finished:['Ավարտ','Завершено','Finished'],size:['Չափ','Размер','Size'],build:['Build','Сборка','Build'],schema:['Սխեմա','Схема','Schema'],checksum:['Checksum (SHA-256)','Контрольная сумма (SHA-256)','Checksum (SHA-256)'],verification:['Ստուգում','Проверка','Verification'],retainUntil:['Պահպանվում է մինչև','Хранится до','Retained until'],errorCode:['Սխալի կոդ','Код ошибки','Error code'],unknown:['Անհայտ','Неизвестно','Unknown'],details:['Մանրամասներ','Подробнее','Details'],hide:['Թաքցնել','Скрыть','Hide'],
 pending:['Սպասում է','В очереди','Pending'],running:['Ընթացքում','Выполняется','Running'],completed:['Ավարտված','Завершено','Completed'],failed:['Ձախողված','Ошибка','Failed'],deleted:['Ջնջված','Удалено','Deleted'],
 verified:['Ստուգված','Проверено','Verified'],verification_failed:['Ստուգումը ձախողվեց','Проверка не пройдена','Verification failed'],not_verified:['Չստուգված','Не проверено','Not verified'],
 verify:['Ստուգել','Проверить','Verify'],download:['Ներբեռնել .vbackup','Скачать .vbackup','Download .vbackup'],delete:['Ջնջել','Удалить','Delete'],
 downloadNote:['Ներբեռնվում է միայն գաղտնագրված .vbackup փաթեթը․ ապագաղտնագրված բովանդակություն չի տրամադրվում։','Скачивается только зашифрованный пакет .vbackup; расшифрованное содержимое не выдаётся.','Only the encrypted .vbackup package is downloaded; decrypted contents are never provided.'],
 protectedUntil:['Պաշտպանված է մինչև {d}','Защищено до {d}','Protected until {d}'],
 deleteTitle:['Ջնջել պատճենը','Удалить копию','Delete backup'],deleteWarn:['Պատճենի բայթերը անդառնալիորեն կհեռացվեն պահոցից։ Աուդիտի գրառումը կպահպանվի։','Байты копии будут безвозвратно удалены из хранилища. Запись аудита сохранится.','The backup bytes are permanently removed from storage. The audit record is kept.'],
 verifiedOk:['Ստուգումը հաջողվեց։','Проверка пройдена.','Verification passed.'],deletedOk:['Պատճենը ջնջված է։','Копия удалена.','Backup deleted.'],downloadOk:['Ֆայլը պատրաստ է։','Файл подготовлен.','File prepared.'],
 prev:['Նախորդ','Назад','Previous'],next:['Հաջորդ','Далее','Next'],page:['Էջ','Страница','Page'],
};
const KIND:Record<string,T3>={database:['Տվյալների բազա','База данных','Database'],files:['Ֆայլեր','Файлы','Files'],full_data:['Ամբողջական տվյալներ','Все данные','Full data'],configuration:['Կարգավորում','Конфигурация','Configuration'],platform_snapshot:['Հարթակի snapshot','Снимок платформы','Platform snapshot']};
const ERR:Record<string,T3>={
 operations_encryption_not_configured:['Գաղտնագրման բանալին կարգավորված չէ։','Ключ шифрования не настроен.','Encryption key is not configured.'],
 backup_storage_not_configured:['Պահոցը կարգավորված չէ։','Хранилище не настроено.','Backup storage is not configured.'],
 source_package_unavailable:['Հարթակի աղբյուրը հասանելի չէ։','Исходники платформы недоступны.','Platform source is unavailable.'],
 backup_already_queued:['Մեկ այլ պատճեն արդեն հերթում է կամ ընթացքում։','Другая копия уже в очереди или выполняется.','Another backup is already queued or running.'],
 backup_not_found:['Ավարտված պատճենը չի գտնվել։','Завершённая копия не найдена.','Completed backup not found.'],
 backup_verification_failed:['Ստուգումը ձախողվեց․ փաթեթը վնասված է կամ բանալին չի համապատասխանում։','Проверка не пройдена: пакет повреждён или ключ не подходит.','Verification failed: the package is damaged or the key does not match.'],
 backup_storage_provider_changed:['Պահոցի մատակարարը փոխվել է պատճենից հետո։','Провайдер хранилища изменился после создания копии.','The storage provider changed since this backup was made.'],
 backup_checksum_mismatch:['Checksum-ը չի համընկնում․ ներբեռնումը մերժված է։','Контрольная сумма не совпадает; скачивание отклонено.','Checksum mismatch; download refused.'],
 backup_minimum_retention:['Նվազագույն պահպանման ժամկետը դեռ չի անցել։','Минимальный срок хранения ещё не истёк.','The minimum retention period has not passed.'],
 backup_not_deletable:['Միայն ավարտված կամ ձախողված պատճենը կարելի է ջնջել։','Удалить можно только завершённую или неудачную копию.','Only completed or failed backups can be deleted.'],
 failed:['Գործողությունը չհաջողվեց։','Действие не выполнено.','The action failed.'],
};
const POLL=30000;
const statusOf=(e:unknown)=>typeof e==='object'&&e&&'status' in e?Number((e as {status:unknown}).status):0;
const codeOf=(e:unknown)=>{if(typeof e==='object'&&e&&'code' in e&&typeof (e as {code:unknown}).code==='string')return (e as {code:string}).code;const d=typeof e==='object'&&e&&'data' in e?(e as {data:unknown}).data:null;if(d&&typeof d==='object'){const o=d as Record<string,unknown>;if(typeof o.error==='string')return o.error;if(typeof o.code==='string')return o.code}return ''};
const isReauth=(e:unknown)=>needsReauth(e)||codeOf(e)==='recent_authentication_required';
const fmtBytes=(b:string|null)=>{if(b===null)return null;const n=Number(b);if(!Number.isFinite(n))return b;const u=['B','KiB','MiB','GiB'];let i=0,v=n;while(v>=1024&&i<u.length-1){v/=1024;i++}return (i?v.toFixed(1):String(v))+' '+u[i]};

function usePolled<D>(fetcher:(signal:AbortSignal)=>Promise<D>,key:string){
 const [data,setData]=useState<D>();const [error,setError]=useState<unknown>();const [loading,setLoading]=useState(true);
 const ctrl=useRef<AbortController|undefined>(undefined);const fRef=useRef(fetcher);fRef.current=fetcher;
 const load=useCallback(()=>{ctrl.current?.abort();const c=new AbortController();ctrl.current=c;setLoading(true);
  fRef.current(c.signal).then(d=>{if(!c.signal.aborted){setData(d);setError(undefined)}}).catch(e=>{if(!c.signal.aborted){setError(e);setData(undefined)}}).finally(()=>{if(!c.signal.aborted)setLoading(false)})},[]);
 useEffect(()=>{setData(undefined);setError(undefined);load();const id=setInterval(load,POLL);const focus=()=>load();window.addEventListener('focus',focus);
  return()=>{clearInterval(id);window.removeEventListener('focus',focus);ctrl.current?.abort()}},[key,load]);
 return {data,error,loading,reload:load};
}

type Perms={create:boolean;download:boolean;delete:boolean};
export default function SystemBackups({ck,l,perms}:{ck:string;l:Language;perms:Perms}){
 const t=(k:string)=>S[k]?.[L(l)]??k;
 const errText=(e:unknown)=>{const c=codeOf(e),st=statusOf(e);return st===403&&!ERR[c]?t('forbidden'):(ERR[c]??ERR.failed)[L(l)]+(c&&!ERR[c]?' ('+c+')':'')};
 const [page,setPage]=useState(1);
 const q=usePolled<Registry>(signal=>getSystemBackups({page},{signal,credentials:'include'}),ck+':backups:'+page);
 const [msg,setMsg]=useState<{t:string;bad?:boolean}>();const [reauth,setReauth]=useState(false);const [busy,setBusy]=useState('');
 const [open,setOpen]=useState<string>();const [del,setDel]=useState<Backup>();
 const ctrl=useRef<AbortController|null>(null);useEffect(()=>()=>ctrl.current?.abort(),[]);
 // Single guarded runner for every mutation: abort on unmount, reauth on 401-fresh errors, readback on success.
 const run=async(tag:string,fn:(signal:AbortSignal)=>Promise<string>)=>{if(busy)return false;const c=new AbortController();ctrl.current=c;setBusy(tag);setMsg(undefined);
  try{const r=await fn(c.signal);if(c.signal.aborted)return false;setMsg({t:r});q.reload();return true}
  catch(e){if(c.signal.aborted)return false;if(isReauth(e)){setReauth(true);return false}setMsg({t:errText(e),bad:true});q.reload();return false}
  finally{if(!c.signal.aborted)setBusy('')}};
 const opts=(signal:AbortSignal,mut=true)=>({signal,credentials:'include' as const,...(mut?{headers:getCsrfHeaders()}:{})});
 const d=q.data;
 const encOk=d?.encryption==='configured';const canCreate=!!d&&encOk&&!!d.provider;
 const active=!!d?.items.some(i=>i.status==='pending'||i.status==='running');
 return <div className="sc-stack" data-testid="system-backups">
  {q.error?<Failure/>:!d?<div className="sc-skeleton" role="status" aria-busy="true" data-testid="status-loading"><span/><span/><span/></div>:<>
   <section className="p-card sc-card" aria-busy={q.loading}>
    <div className="sc-head"><h3 className="sb-h">{t('readiness')}</h3><button className="p-button small" onClick={q.reload} disabled={q.loading} data-testid="button-refresh-backups">{t('refresh')}</button></div>
    <ul className="sc-metrics">
     <li><span className="sc-mkey">{t('encryption')}</span><strong data-testid="text-backup-encryption">{t(d.encryption)}</strong><Dot ok={encOk}/></li>
     <li><span className="sc-mkey">{t('provider')}</span><strong className="sc-mono" data-testid="text-backup-provider">{d.provider??t('not_configured')}</strong><Dot ok={!!d.provider}/></li>
     <li><span className="sc-mkey">{t('source')}</span><strong data-testid="text-backup-source">{t(d.sourceAvailable?'available':'unavailable')}</strong><Dot ok={d.sourceAvailable} neutral/></li>
     <li><span className="sc-mkey">{t('restore')}</span><strong data-testid="text-backup-restore">{t(d.restoreMode)}</strong><Dot ok neutral/></li>
     <li><span className="sc-mkey">{t('limit')}</span><strong data-testid="text-backup-limit">{t('limitValue').replace('{m}',String(d.limitMiB))}</strong><Dot ok neutral/></li>
    </ul>
    {!encOk&&<p className="p-error" role="alert" data-testid="text-encryption-missing">{t('encMissing')}</p>}
    {encOk&&!d.provider&&<p className="p-error" role="alert" data-testid="text-provider-missing">{t('providerMissing')}</p>}
    <p className="sc-note">{t('scopeNote')}</p><p className="sc-note">{t('restoreNote')}</p><p className="sc-note">{t('verifyNote')}</p>
   </section>
   {reauth&&<ReauthPrompt language={l} onDone={()=>{setReauth(false);setMsg({t:reauthDone(l)})}} onCancel={()=>setReauth(false)}/>}
   {msg&&<p className={msg.bad?'p-error':'p-info'} role="status" data-testid="status-backup-action">{msg.t}</p>}
   {perms.create&&<CreateForm key={ck} d={d} t={t} l={l} disabled={!canCreate||active} busy={busy==='create'} onSubmit={(kind,notes)=>run('create',async s=>{await createSystemBackup({kind,notes,confirmation:'BACKUP'},opts(s));return t('queued')})}/>}
   {del&&perms.delete&&<DeleteForm key={del.id} b={del} t={t} l={l} busy={busy==='delete'} onCancel={()=>setDel(undefined)} onSubmit={async()=>{const id=del.id;if(await run('delete',async s=>{await deleteSystemBackup(id,{confirmation:'DELETE BACKUP'},opts(s));return t('deletedOk')}))setDel(undefined)}}/>}
   <section className="p-card sc-card" aria-busy={q.loading}>
    <h3 className="sb-h">{t('queue')}</h3>
    <div className="cx-scroll"><table className="cx-table sc-table"><thead><tr><th>{t('created')}</th><th>{t('kind')}</th><th>{t('completed')}</th><th>{t('size')}</th><th>{t('verification')}</th><th>{t('retainUntil')}</th><th><span className="sr-only">{t('details')}</span></th></tr></thead><tbody>
     {d.items.map(b=>{const done=b.status==='completed';const prot=Date.parse(b.retainUntil)>Date.now();const deletable=(done||b.status==='failed')&&!prot;return [
      <tr key={b.id} data-testid={'row-backup-'+b.id}>
       <td>{fmtDate(b.createdAt,l)}</td><td>{KIND[b.kind]?.[L(l)]??b.kind}</td>
       <td><span className={'p-badge sc-pill '+(done?'green':b.status==='failed'?'red':b.status==='deleted'?'grey':'amber')} data-testid={'status-backup-'+b.id}>{t(b.status)}</span></td>
       <td>{fmtBytes(b.bytes)??<span className="sc-null">{t('unknown')}</span>}</td>
       <td><span className={'p-badge sc-pill '+(b.verification==='verified'?'green':b.verification==='verification_failed'?'red':'grey')}>{t(b.verification)}</span></td>
       <td>{fmtDate(b.retainUntil,l)}</td>
       <td><div className="cx-row sb-actions">
        <button className="p-button small" aria-expanded={open===b.id} onClick={()=>setOpen(o=>o===b.id?undefined:b.id)} data-testid={'button-backup-details-'+b.id}>{open===b.id?t('hide'):t('details')}</button>
        {done&&perms.create&&<button className="p-button small" disabled={!!busy} onClick={()=>void run('verify',async s=>{await verifySystemBackup(b.id,opts(s));return t('verifiedOk')})} data-testid={'button-verify-backup-'+b.id}>{t('verify')}</button>}
        {done&&perms.download&&<button className="p-button small" disabled={!!busy} title={t('downloadNote')} onClick={()=>void run('download',async s=>{const blob=await downloadSystemBackup(b.id,{...opts(s,false),responseType:'blob'});if(s.aborted)return '';const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='vernatun-'+b.id+'.vbackup';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);return t('downloadOk')})} data-testid={'button-download-backup-'+b.id}>{t('download')}</button>}
        {perms.delete&&(done||b.status==='failed')&&(deletable?<button className="p-button small" disabled={!!busy} onClick={()=>{setMsg(undefined);setDel(b)}} data-testid={'button-delete-backup-'+b.id}>{t('delete')}</button>:<small className="sc-note" data-testid={'text-protected-'+b.id}>{t('protectedUntil').replace('{d}',fmtDate(b.retainUntil,l))}</small>)}
       </div></td></tr>,
      open===b.id&&<tr key={b.id+':d'} className="sc-detail"><td colSpan={7}><dl data-testid={'detail-backup-'+b.id}>{([['created',fmtDate(b.createdAt,l)],['finished',b.finishedAt&&fmtDate(b.finishedAt,l)],['provider',b.provider],['build',b.applicationVersion],['schema',b.migrationVersion],['checksum',b.checksum],['verification',b.verifiedAt?t(b.verification)+' · '+fmtDate(b.verifiedAt,l):t(b.verification)],['errorCode',b.errorCode],['notes',b.notes||null]] as [string,string|null][]).map(([k,v])=><div key={k}><dt>{t(k==='notes'?'notes':k)}</dt><dd className={k==='checksum'||k==='errorCode'?'sc-mono sb-wrap':''}>{v??<span className="sc-null">{t('unknown')}</span>}</dd></div>)}</dl></td></tr>]})}
     {!d.items.length&&<tr><td colSpan={7} className="sc-empty" data-testid="text-empty"><strong>{t('empty')}</strong> {t(canCreate?'emptyReady':'emptyBlocked')}</td></tr>}
    </tbody></table></div>
    <p className="sc-note">{t('downloadNote')}</p>
    <div className="cx-row" aria-live="polite"><button className="p-button" disabled={q.loading||page<=1} onClick={()=>setPage(p=>p-1)} data-testid="button-prev-backups">{t('prev')}</button><span data-testid="text-page-backups">{t('page')} {page}</span><button className="p-button" disabled={q.loading||!d.hasMore} onClick={()=>setPage(p=>p+1)} data-testid="button-next-backups">{t('next')}</button></div>
    <p className="sc-note">{t('autoRefresh')}</p>
   </section></>}
 </div>;
 function Failure(){const st=statusOf(q.error);return <div className="sc-failure" role="alert" data-testid="status-error"><p className="p-error">{st===403?t('forbidden'):t('error')+(st?' (HTTP '+st+')':'')}</p><button className="p-button" onClick={q.reload} data-testid="button-retry">{t('retry')}</button></div>}
}
function Dot({ok,neutral}:{ok:boolean;neutral?:boolean}){return <span className={'p-badge sc-pill '+(ok?(neutral?'grey':'green'):neutral?'grey':'red')} aria-hidden="true">{ok?'+':'!'}</span>}

function CreateForm({d,t,l,disabled,busy,onSubmit}:{d:Registry;t:(k:string)=>string;l:Language;disabled:boolean;busy:boolean;onSubmit:(k:SystemBackupCreateInputKind,n:string)=>Promise<boolean>}){
 const kinds=d.kinds.filter((k):k is SystemBackupCreateInputKind=>k in KIND);
 const [kind,setKind]=useState<SystemBackupCreateInputKind>(kinds[0]??'database');const [notes,setNotes]=useState('');const [typed,setTyped]=useState('');
 const kindOk=kind!=='platform_snapshot'||d.sourceAvailable;
 const submit=async(e:FormEvent)=>{e.preventDefault();if(disabled||busy||!kindOk||typed!=='BACKUP')return;if(await onSubmit(kind,notes.trim())){setTyped('');setNotes('')}};
 return <form className="p-card sc-card sa-danger" onSubmit={submit} aria-disabled={disabled} data-testid="form-create-backup"><h3>{t('createTitle')}</h3>
  <fieldset className="sa-radios" disabled={disabled}><legend>{t('kind')}</legend>
   {kinds.map(k=>{const off=k==='platform_snapshot'&&!d.sourceAvailable;return <label key={k}><input type="radio" name="backup-kind" checked={kind===k} disabled={off} onChange={()=>setKind(k)} data-testid={'radio-backup-kind-'+k}/> {KIND[k][L(l)]}{off&&<small className="sc-null"> · {t('sourceOff')}</small>}</label>})}
  </fieldset>
  <label>{t('notes')}<textarea value={notes} maxLength={300} rows={2} disabled={disabled} onChange={e=>setNotes(e.target.value)} data-testid="input-backup-notes"/><small className="sc-note">{notes.length}/300</small></label>
  <p className="sc-note">{t('createWarn')}</p>
  <label>{t('typeConfirm')} <code className="sc-mono">BACKUP</code><input value={typed} disabled={disabled} onChange={e=>setTyped(e.target.value)} autoComplete="off" spellCheck={false} maxLength={20} data-testid="input-confirm-backup"/></label>
  <div className="cx-row"><button className="p-button orange" disabled={disabled||busy||!kindOk||typed!=='BACKUP'} data-testid="button-create-backup">{busy?t('loading'):t('createTitle')}</button></div>
 </form>;
}
function DeleteForm({b,t,l,busy,onCancel,onSubmit}:{b:Backup;t:(k:string)=>string;l:Language;busy:boolean;onCancel:()=>void;onSubmit:()=>void}){
 const [typed,setTyped]=useState('');
 return <form className="p-card sc-card sa-danger" onSubmit={e=>{e.preventDefault();if(typed==='DELETE BACKUP'&&!busy)onSubmit()}} data-testid="form-delete-backup"><h3>{t('deleteTitle')}</h3>
  <p><strong>{KIND[b.kind]?.[L(l)]??b.kind}</strong> · {fmtDate(b.createdAt,l)} · <span className="sc-mono">{b.id.slice(0,8)}</span></p>
  <p className="p-error">{t('deleteWarn')}</p>
  <label>{t('typeConfirm')} <code className="sc-mono">DELETE BACKUP</code><input value={typed} onChange={e=>setTyped(e.target.value)} autoComplete="off" spellCheck={false} maxLength={20} data-testid="input-confirm-delete-backup"/></label>
  <div className="cx-row"><button className="p-button orange" disabled={busy||typed!=='DELETE BACKUP'} data-testid="button-confirm-delete-backup">{busy?t('loading'):t('delete')}</button><button type="button" className="p-button" onClick={onCancel} data-testid="button-cancel-delete-backup">{t('cancel')}</button></div>
 </form>;
}
export const backupsLabel=(l:Language)=>S.title[L(l)];
