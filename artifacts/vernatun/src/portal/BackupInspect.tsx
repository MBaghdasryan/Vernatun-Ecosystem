import {useEffect,useRef,useState} from 'react';
import {inspectSystemBackup,type BackupInspection} from '@workspace/api-client-react';
import {fmtDate} from './console-util';
import {getCsrfHeaders} from './client';
import {ReauthPrompt,needsReauth,reauthDone} from './Reauth';
import type {Language} from './i18n';

type T3=[string,string,string];
const L=(l:Language)=>l==='hy'?0:l==='ru'?1:2;
const S:Record<string,T3>={
 title:['Վերականգնման նախաստուգում','Предварительная проверка восстановления','Restore preflight'],
 intro:['Նախաստուգումը ապագաղտնագրում և ստուգում է փաթեթը սերվերում և ցույց է տալիս միայն անվտանգ ամփոփում։ SQL, ֆայլերի անուններ կամ գաղտնի բովանդակություն չի վերադարձվում։ Սա հաջող վերականգնում ՉԷ։','Проверка расшифровывает и проверяет пакет на сервере и показывает только безопасную сводку. SQL, имена файлов и приватное содержимое не возвращаются. Это НЕ успешное восстановление.','Preflight decrypts and checks the package on the server and shows only a safe summary. No SQL, file names or private contents are returned. This is NOT a successful recovery.'],
 run:['Գործարկել նախաստուգումը','Запустить проверку','Run preflight'],again:['Կրկնել նախաստուգումը','Повторить проверку','Run again'],close:['Փակել','Закрыть','Close'],loading:['Ստուգվում է…','Проверка…','Inspecting…'],
 rate:['Առավելագույնը 3 նախաստուգում րոպեում։','Не более 3 проверок в минуту.','At most 3 preflights per minute.'],
 kind:['Տեսակ','Тип','Kind'],created:['Ստեղծված','Создано','Created'],build:['Build','Сборка','Build'],unknown:['Անհայտ','Неизвестно','Unknown'],
 migration:['Պատճենի միգրացիա','Миграция копии','Backup migration'],current:['Ընթացիկ միգրացիա','Текущая миграция','Current migration'],
 match:['Ճշգրիտ համընկնում','Точное совпадение','Exact match'],mismatch:['Չի համընկնում','Не совпадает','Does not match'],
 database:['Տվյալների բազա','База данных','Database'],files:['Ֆայլեր','Файлы','Files'],configuration:['Կարգավորում','Конфигурация','Configuration'],source:['Հարթակի աղբյուր','Исходники платформы','Platform source'],fingerprints:['Աղյուսակների fingerprint-ներ','Отпечатки таблиц','Table fingerprints'],
 included:['Ներառված','Есть','Included'],absent:['Չկա','Нет','Not included'],present:['Առկա','Есть','Present'],missing:['Բացակայում','Отсутствуют','Missing'],
 filesValue:['{n} ֆայլ · {b}','{n} файлов · {b}','{n} files · {b}'],
 drill:['Մեկուսացված drill','Изолированный drill','Isolated drill'],supported:['Աջակցվում է','Поддерживается','Supported'],unsupported:['Չի աջակցվում','Не поддерживается','Not supported'],
 mode:['Վերականգնման ռեժիմ','Режим восстановления','Restore mode'],isolated_cli_only:['Միայն մեկուսացված CLI','Только изолированный CLI','Isolated CLI only'],
 mismatchNote:['Drill-ը պահանջում է միգրացիայի ճշգրիտ համընկնում ընթացիկ սխեմայի հետ։ Ավելի հին կամ նոր սխեմայով պատճենը այստեղ չի կարող ստուգվել։','Drill требует точного совпадения миграции с текущей схемой. Копию со старой или новой схемой здесь проверить нельзя.','A drill requires an exact migration match with the current schema. A copy from an older or newer schema cannot be drilled here.'],
 noFp:['Այս ավելի հին պատճենը fingerprint-ներ չունի։ Drill-ի համար ստեղծեք նոր պատճեն։','В этой старой копии нет отпечатков. Для drill создайте новую копию.','This older copy has no fingerprints. Create a new backup to drill.'],
 dbOnly:['Միայն բազայի պատճենը չի պարունակում համապատասխան ֆայլեր․ ֆայլերի վերականգնում չի ապահովում։','Копия только БД не содержит связанных файлов и не восстанавливает их.','A database-only copy does not include paired files and cannot recover them.'],
 noDb:['Ֆայլերի կամ կարգավորման պատճենը SQL drill անել չի կարող։','Копия файлов или конфигурации не может выполнить SQL drill.','A files or configuration copy cannot perform an SQL drill.'],
 cliTitle:['Ձեռքով օպերատորի CLI (միայն մշակման/թեստային միջավայր)','Ручной CLI оператора (только разработка/тест)','Manual operator CLI (development/test only)'],
 cliNote:['Հրամանը կատարվում է միայն օպերատորի կողմից տերմինալում․ դիտարկիչը այն երբեք չի գործարկում։ Drill-ը ստեղծում է պատահական ժամանակավոր բազա և տեղային գաղտնի ֆայլեր, ստուգում է գրանցված աղյուսակների hash-երը և հղումների ծածկույթը, ապա ջնջում ժամանակավոր ռեսուրսները։ Այն չի ստուգում հավելվածի մուտքը, ներբեռնման թույլտվությունները, աղբյուրի տեղակայումը կամ արտադրական վերականգնումը։','Команду выполняет только оператор в терминале; браузер её никогда не запускает. Drill создаёт случайную временную БД и локальные приватные файлы, проверяет сохранённые хеши таблиц и покрытие ссылок, затем удаляет временные ресурсы. Он не проверяет вход в приложение, авторизацию скачивания, развёртывание исходников или восстановление в production.','Only an operator runs this in a terminal; the browser never executes it. The drill creates a random temporary database and local private files, checks captured table hashes and reference coverage, then deletes the temporary resources. It does not exercise app login, download authorization, source deployment or production restore.'],
 copy:['Պատճենել','Копировать','Copy'],copied:['Պատճենված է','Скопировано','Copied'],
 noCli:['Այս պատճենի համար մեկուսացված drill հասանելի չէ։','Для этой копии изолированный drill недоступен.','No isolated drill is available for this backup.'],
 noRestore:['Արտադրական վերականգնում այս վահանակից չկա։','Восстановления в production из этой консоли нет.','There is no production restore from this console.'],
 inspectedAt:['Ստուգված','Проверено','Inspected'],
};
const ERR:Record<string,T3>={
 backup_busy:['Պատճենը զբաղված է այլ գործողությամբ։ Փորձեք մի փոքր ուշ։','Копия занята другой операцией. Повторите позже.','The backup is busy with another operation. Try again shortly.'],
 backup_verification_failed:['Ստուգումը ձախողվեց․ փաթեթը վնասված է կամ բանալին չի համապատասխանում։','Проверка не пройдена: пакет повреждён или ключ не подходит.','Verification failed: the package is damaged or the key does not match.'],
 backup_not_found:['Ավարտված պատճենը չի գտնվել։','Завершённая копия не найдена.','Completed backup not found.'],
 rate:['Չափազանց շատ նախաստուգումներ։ Սպասեք մեկ րոպե։','Слишком много проверок. Подождите минуту.','Too many preflights. Wait a minute.'],
 forbidden:['Թույլտվություն չկա (պահանջվում է backups.restore)։','Нет разрешения (нужно backups.restore).','Not permitted (backups.restore required).'],
 failed:['Նախաստուգումը չհաջողվեց։','Проверка не удалась.','Preflight failed.'],
};
const statusOf=(e:unknown)=>typeof e==='object'&&e&&'status' in e?Number((e as {status:unknown}).status):0;
const codeOf=(e:unknown)=>{if(typeof e==='object'&&e&&'code' in e&&typeof (e as {code:unknown}).code==='string')return (e as {code:string}).code;const d=typeof e==='object'&&e&&'data' in e?(e as {data:unknown}).data:null;if(d&&typeof d==='object'){const o=d as Record<string,unknown>;if(typeof o.error==='string')return o.error;if(typeof o.code==='string')return o.code}return ''};
const fmtBytes=(n:number)=>{const u=['B','KiB','MiB','GiB'];let i=0,v=n;while(v>=1024&&i<u.length-1){v/=1024;i++}return (i?v.toFixed(1):String(v))+' '+u[i]};

// Mounted with key=ck+backupId so any context or id change discards prior results.
export default function BackupInspect({id,l,kindLabel,onClose}:{id:string;l:Language;kindLabel:(k:string)=>string;onClose:()=>void}){
 const t=(k:string)=>S[k]?.[L(l)]??k;
 const [res,setRes]=useState<{r:BackupInspection;at:string}>();const [busy,setBusy]=useState(false);const [err,setErr]=useState('');const [info,setInfo]=useState('');const [reauth,setReauth]=useState(false);const [copied,setCopied]=useState(false);
 const c=useRef<AbortController|null>(null);useEffect(()=>()=>c.current?.abort(),[]);
 const run=async()=>{if(busy)return;c.current?.abort();const ac=new AbortController();c.current=ac;setBusy(true);setErr('');setInfo('');setRes(undefined);setCopied(false);
  try{const r=await inspectSystemBackup(id,{signal:ac.signal,credentials:'include',headers:getCsrfHeaders()});if(ac.signal.aborted)return;
   if(r.id!==id){setErr(ERR.failed[L(l)]);return}setRes({r,at:new Date().toISOString()})}
  catch(e){if(ac.signal.aborted)return;if(needsReauth(e)||codeOf(e)==='recent_authentication_required'){setReauth(true);return}
   const code=codeOf(e),st=statusOf(e);setErr((ERR[code]??(st===429?ERR.rate:st===404?ERR.backup_not_found:st===403?ERR.forbidden:ERR.failed))[L(l)]+(code&&!ERR[code]?' ('+code+')':''))}
  finally{if(!ac.signal.aborted)setBusy(false)}};
 const cmd='pnpm --filter @workspace/api-server run backup:encrypted-drill drill '+id+' --confirm=ISOLATED';
 const copy=async()=>{try{await navigator.clipboard.writeText(cmd);setCopied(true)}catch{setCopied(false)}};
 const r=res?.r;
 const Fact=({k,v,ok,tid}:{k:string;v:string;ok?:boolean;tid:string})=><div><dt>{t(k)}</dt><dd data-testid={'text-inspect-'+tid}>{ok===undefined?v:<span className={'p-badge sc-pill '+(ok?'green':'grey')}>{v}</span>}</dd></div>;
 return <section className="p-card sc-card sa-danger bi-wrap" aria-busy={busy} data-testid={'section-inspect-'+id}>
  <div className="sc-head"><h3 className="sb-h">{t('title')} · <span className="sc-mono">{id.slice(0,8)}</span></h3><button type="button" className="p-button small" onClick={onClose} data-testid="button-close-inspect">{t('close')}</button></div>
  <p className="p-info">{t('intro')}</p>
  {reauth?<ReauthPrompt language={l} onDone={()=>{setReauth(false);setInfo(reauthDone(l))}} onCancel={()=>setReauth(false)}/>:
   <div className="cx-row"><button type="button" className="p-button orange" disabled={busy} onClick={()=>void run()} data-testid="button-run-inspect">{busy?t('loading'):r?t('again'):t('run')}</button><small className="sc-note">{t('rate')}</small></div>}
  {info&&<p className="p-info" role="status">{info}</p>}
  {err&&<p className="p-error" role="alert" data-testid="status-inspect-error">{err}</p>}
  {r&&<>
   <dl className="bp-facts bi-facts">
    <Fact k="kind" v={kindLabel(r.kind)} tid="kind"/>
    <Fact k="created" v={fmtDate(r.createdAt,l)} tid="created"/>
    <Fact k="build" v={r.build??t('unknown')} tid="build"/>
    <Fact k="migration" v={r.migration} tid="migration"/>
    <Fact k="current" v={r.currentMigration} tid="current-migration"/>
    <Fact k="match" v={t(r.migrationMatches?'match':'mismatch')} ok={r.migrationMatches} tid="migration-match"/>
    <Fact k="database" v={t(r.database?'included':'absent')} ok={r.database} tid="database"/>
    <Fact k="files" v={t('filesValue').replace('{n}',String(r.files)).replace('{b}',fmtBytes(r.fileBytes))} tid="files"/>
    <Fact k="configuration" v={t(r.configuration?'included':'absent')} ok={r.configuration} tid="configuration"/>
    <Fact k="source" v={t(r.source?'included':'absent')} ok={r.source} tid="source"/>
    <Fact k="fingerprints" v={t(r.fingerprints?'present':'missing')} ok={r.fingerprints} tid="fingerprints"/>
    <Fact k="drill" v={t(r.isolatedDrillSupported?'supported':'unsupported')} ok={r.isolatedDrillSupported} tid="drill"/>
    <Fact k="mode" v={t(r.restoreMode)} tid="mode"/>
    <Fact k="inspectedAt" v={fmtDate(res!.at,l)} tid="at"/>
   </dl>
   <ul className="bi-limits" data-testid="list-inspect-limitations">
    {!r.migrationMatches&&<li className="p-error">{t('mismatchNote')}</li>}
    {r.database&&!r.fingerprints&&<li className="p-error">{t('noFp')}</li>}
    {r.kind==='database'&&<li>{t('dbOnly')}</li>}
    {!r.database&&<li>{t('noDb')}</li>}
    <li>{t('noRestore')}</li>
   </ul>
   {r.isolatedDrillSupported?<div className="bi-cli" data-testid="section-drill-cli"><strong>{t('cliTitle')}</strong>
    <div className="bi-cmd"><code className="sc-mono sb-wrap" data-testid="text-drill-command">{cmd}</code><button type="button" className="p-button small" onClick={()=>void copy()} data-testid="button-copy-drill">{copied?t('copied'):t('copy')}</button></div>
    <p className="sc-note">{t('cliNote')}</p></div>:<p className="sc-note" data-testid="text-no-drill">{t('noCli')}</p>}
  </>}
 </section>;
}
