import {useCallback,useEffect,useMemo,useState} from 'react';
import {getSystemUpdates,getSystemBackups,uploadSystemUpdate,validateSystemUpdate,stageSystemUpdate} from '@workspace/api-client-react';
import {fmtDate} from './console-util';
import {getCsrfHeaders} from './client';
import {ReauthPrompt,needsReauth,reauthDone} from './Reauth';
import type {Language} from './i18n';
import './system-console.css';

const L=(l:Language)=>l==='hy'?0:l==='ru'?1:2;
const TEXT:Record<string,[string,string,string]>={
 title:['Update Center','Центр обновлений','Update Center'],description:['Ապահով ZIP փաթեթի վերբեռնում, ստուգում և բեմադրում։ Փաթեթը չի կատարվում սերվերի runtime-ում։','Безопасная загрузка, проверка и подготовка ZIP-пакета. Пакет не выполняется в runtime сервера.','Upload, validate, and stage a safe ZIP package. Packages are never executed in the server runtime.'],
 forbidden:['Այս բաժնի համար թույլտվություն չկա։','Нет разрешения на этот раздел.','You do not have permission for this section.'],confirmation:['Մուտքագրեք ճիշտ հաստատման արտահայտությունը։','Введите точную фразу подтверждения.','Enter the exact confirmation phrase.'],
 upload:['Վերբեռնել փաթեթը','Загрузить пакет','Upload package'],choose:['Ընտրել ZIP փաթեթ','Выбрать ZIP','Choose ZIP package'],
 typeConfirm:['Մուտքագրեք հաստատումը','Введите подтверждение','Type confirmation'],uploadConfirm:['Վերբեռնել','Загрузить','Upload'],
 loading:['Բեռնվում է…','Загрузка…','Loading…'],refresh:['Թարմացնել','Обновить','Refresh'],error:['Չհաջողվեց բեռնել թարմացումների պատմությունը։','Не удалось загрузить историю обновлений.','Could not load update history.'],
 noFile:['Ընտրեք ZIP ֆայլը։','Выберите ZIP-файл.','Choose a ZIP file.'],fileType:['Միայն .zip փաթեթներ, առավելագույնը 32 ՄԲ։','Только ZIP-файлы, до 32 МБ.','ZIP files only, up to 32 MB.'],
 uploaded:['Փաթեթը ստուգվել է և պահվել է մասնավոր պահոցում։','Пакет проверен и сохранён в приватном хранилище.','Package validated and stored in private storage.'],
 failed:['Գործողությունը չհաջողվեց։','Операция не выполнена.','The operation failed.'],noItems:['Փաթեթների պատմություն դեռ չկա։','Истории пакетов пока нет.','No package history yet.'],
 history:['Փաթեթների պատմություն','История пакетов','Package history'],version:['Տարբերակ','Версия','Version'],checksum:['SHA-256','SHA-256','SHA-256'],
 size:['Չափ','Размер','Size'],uploadedBy:['Վերբեռնող օգտատեր','Загрузил пользователь','Uploaded by user'],status:['Կարգավիճակ','Статус','Status'],
 validate:['Կրկին ստուգել','Проверить повторно','Revalidate'],valid:['Վավերացված','Проверен','Validated'],invalid:['Ստուգումը ձախողվեց','Проверка не пройдена','Validation failed'],
 unknown:['Համատեղելիությունը դեռ հաստատված չէ։ Սահմանեք VERNATUN_APP_VERSION և կրկին ստուգեք։','Совместимость не подтверждена. Задайте VERNATUN_APP_VERSION и проверьте повторно.','Compatibility is unknown. Set VERNATUN_APP_VERSION and validate again.'],
 staged:['Բեմադրված','Подготовлен','Staged'],backup:['Ստուգված DB պահուստային պատճեն','Проверенная резервная копия БД','Verified database backup'],
 stage:['Բեմադրել','Подготовить','Stage'],stageConfirm:['Բեմադրելու հաստատում','Подтверждение подготовки','Stage confirmation'],
 noBackup:['Բեմադրման համար պահանջվում է ստուգված database կամ full_data պահուստային պատճեն։','Для подготовки нужна проверенная резервная копия database или full_data.','Staging requires a verified database or full_data backup.'],
 installUnsupported:['Այս հոսթինգի runtime-ը չի աջակցում գործարկվող ֆայլերի փոխարինում։ Բեմադրումը պահպանում է փաթեթը և ստուգված պատճենը, իսկ տեղադրումը պետք է անել deployment pipeline-ով։','Runtime этого хостинга не поддерживает замену файлов приложения. Подготовка сохраняет пакет и проверенную копию; установку выполняйте через deployment pipeline.','This hosting runtime cannot replace running application files. Staging preserves the package and verified backup; install through the deployment pipeline.'],
 issue:['Խնդիր','Проблема','Issue'],current:['Ընթացիկ տարբերակ','Текущая версия','Current version'],build:['Build ID','Build ID','Build ID'],node:['Node.js','Node.js','Node.js'],
 permitted:['Վավերացված փաթեթների վերբեռնումը պահանջում է վերջին հաստատումը։','Загрузка проверенных пакетов требует недавнего подтверждения личности.','Uploading validated packages requires recent reauthentication.'],
};
const t=(l:Language,k:string)=>TEXT[k]?.[L(l)]??k;
type Item={id:string;fileName:string;version:string|null;packageChecksum:string;sizeBytes:string;status:string;uploadedAt:string;
 uploadedBy:string;backupId:string|null;errorCode:string|null;validation:{valid:boolean;compatible:boolean|null;compatibility:string;issues:string[];files:number;expandedBytes:number}|null};
type Updates={currentVersion:string|null;buildId:string;nodeVersion:string;schemaVersion:string|null;installation:{status:string;message:string};items:Item[]};
type Backup={id:string;kind:string;status:string;verification:string;createdAt:string};
const statusLabel=(l:Language,s:string)=>s==='validated'?t(l,'valid'):s==='validation_failed'?t(l,'invalid'):s==='staged'?t(l,'staged'):s==='needs_compatibility'?t(l,'unknown'):s;
const statusClass=(s:string)=>s==='validated'?'green':s==='staged'?'blue':s==='validation_failed'||s==='storage_failed'?'red':'amber';
const statusOf=(e:unknown)=>typeof e==='object'&&e&&'status' in e?Number((e as {status:unknown}).status):0;

export default function SystemUpdates({language,canRead,canUpload,canStage,canBackups}:{language:Language;canRead:boolean;canUpload:boolean;canStage:boolean;canBackups:boolean}){
 const [data,setData]=useState<Updates>();const [backups,setBackups]=useState<Backup[]>([]);const [file,setFile]=useState<File>();const [typed,setTyped]=useState('');const [stageTyped,setStageTyped]=useState('');
 const [backupId,setBackupId]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('');const [reauth,setReauth]=useState(false);
 const load=useCallback(async()=>{setError('');try{setData(await getSystemUpdates({credentials:'include'}) as Updates)}catch(e){setData(undefined);setError(statusOf(e)===403?'forbidden':'error')}},[]);
 const loadBackups=useCallback(async()=>{if(!canBackups)return;try{const r=await getSystemBackups({page:1},{credentials:'include'}) as unknown as {items:Backup[]};setBackups(r.items??[])}catch{setBackups([])}},[canBackups]);
 useEffect(()=>{if(canRead)void load()},[canRead,load]);useEffect(()=>{if(canBackups)void loadBackups()},[canBackups,loadBackups]);
 const verifiedBackups=useMemo(()=>backups.filter(b=>b.status==='completed'&&b.verification==='verified'&&['database','full_data'].includes(b.kind)),[backups]);
 const run=async(fn:()=>Promise<unknown>,successKey='uploaded',conflictKey='failed')=>{setBusy(true);setError('');setMessage('');try{await fn();await load();await loadBackups();setMessage(t(language,successKey))}catch(e){if(needsReauth(e)){setReauth(true)}else setError(statusOf(e)===403?'forbidden':statusOf(e)===409?conflictKey:'failed')}finally{setBusy(false)}};
 if(!canRead)return <p className="p-error" role="alert">{t(language,'forbidden')}</p>;
 if(reauth)return <ReauthPrompt language={language} onDone={()=>{setReauth(false);setMessage(reauthDone(language))}} onCancel={()=>setReauth(false)}/>;
 const upload=()=>{
  if(!file){setError('noFile');return}
  if(!file.name.toLowerCase().endsWith('.zip')||file.size>32*1024*1024){setError('fileType');return}
  void run(async()=>{
  await uploadSystemUpdate(file,{credentials:'include',headers:{...getCsrfHeaders(),'X-Update-Filename':file.name,'X-Confirmation':'UPDATE PACKAGE'}});
  setFile(undefined);setTyped('');
  });
 };
 const validate=(id:string)=>void run(()=>validateSystemUpdate(id,{credentials:'include',headers:getCsrfHeaders()}),'valid');
 const stage=(id:string)=>void run(()=>stageSystemUpdate(id,{backupId,confirmation:'STAGE UPDATE'},{credentials:'include',headers:getCsrfHeaders()}),'staged','noBackup');
 return <div className="sc-stack" data-testid="system-updates">
  <section className="p-card sc-card">
   <div className="sc-head"><div><h2>{t(language,'title')}</h2><p className="sc-note">{t(language,'description')}</p></div><button className="p-button small" disabled={busy} onClick={()=>{void load();void loadBackups()}}>{t(language,'refresh')}</button></div>
   {data&&<dl className="sc-facts"><div><dt>{t(language,'current')}</dt><dd>{data.currentVersion??'—'}</dd></div><div><dt>{t(language,'build')}</dt><dd>{data.buildId}</dd></div><div><dt>{t(language,'node')}</dt><dd>{data.nodeVersion}</dd></div></dl>}
   <p className="p-info sc-readonly">{t(language,'installUnsupported')}</p>
   {canUpload&&<form className="cx-form" onSubmit={e=>{e.preventDefault();if(typed!=='UPDATE PACKAGE'){setError('confirmation');return}upload()}} data-testid="form-update-upload">
    <label>{t(language,'choose')}<input type="file" accept=".zip,application/zip" onChange={e=>{setFile(e.target.files?.[0]);setError('')}} data-testid="input-update-file"/></label>
    <label>{t(language,'typeConfirm')} <code>UPDATE PACKAGE</code><input value={typed} maxLength={20} onChange={e=>setTyped(e.target.value)} autoComplete="off" data-testid="input-update-confirm"/></label>
    <button className="p-button orange" disabled={busy||typed!=='UPDATE PACKAGE'||!file} data-testid="button-update-upload">{busy?t(language,'loading'):t(language,'uploadConfirm')}</button>
    <p className="sc-note">{t(language,'fileType')} {t(language,'permitted')}</p>
   </form>}
   {error&&<p className="p-error" role="alert" data-testid="status-update-error">{t(language,error)}</p>}
   {message&&<p className="p-info" role="status" data-testid="status-update-message">{message}</p>}
  </section>
  {!data?<div className="sc-skeleton" role="status" aria-busy="true"><span/><span/><span/></div>:<section className="p-card sc-card">
   <h3>{t(language,'history')}</h3>
   {!data.items.length?<p className="sc-empty">{t(language,'noItems')}</p>:<div className="sc-stack">{data.items.map(item=><article className="p-card sc-update" key={item.id} data-testid={'row-update-'+item.id}>
    <div className="sc-head"><div><strong>{item.fileName}</strong><p className="sc-note">{t(language,'version')}: {item.version??'—'} · {fmtDate(item.uploadedAt,language)}</p></div><span className={'p-badge sc-pill '+statusClass(item.status)}>{statusLabel(language,item.status)}</span></div>
    <dl className="sc-facts"><div><dt>{t(language,'checksum')}</dt><dd className="sc-mono">{item.packageChecksum}</dd></div><div><dt>{t(language,'size')}</dt><dd>{(Number(item.sizeBytes)/1024/1024).toFixed(2)} MB</dd></div><div><dt>{t(language,'uploadedBy')}</dt><dd className="sc-mono">{item.uploadedBy}</dd></div></dl>
    {item.validation&&<div><p>{item.validation.files} files · {item.validation.expandedBytes} expanded bytes · {item.validation.compatibility}</p>{item.validation.issues.map(issue=><p className="p-error" key={issue}>{t(language,'issue')}: <code>{issue}</code></p>)}</div>}
    <div className="cx-row">
 {canUpload&&['validated','needs_compatibility'].includes(item.status)&&<button className="p-button small" disabled={busy} onClick={()=>validate(item.id)} data-testid={'button-update-validate-'+item.id}>{t(language,'validate')}</button>}
     {canStage&&item.status==='validated'&&<label>{t(language,'backup')}<select value={backupId} onChange={e=>setBackupId(e.target.value)}><option value="">{t(language,'noBackup')}</option>{verifiedBackups.map(b=><option key={b.id} value={b.id}>{b.kind} · {fmtDate(b.createdAt,language)} · {b.id.slice(0,8)}</option>)}</select></label>}
     {canStage&&item.status==='validated'&&verifiedBackups.length>0&&<label>{t(language,'stageConfirm')} <code>STAGE UPDATE</code><input value={stageTyped} maxLength={20} onChange={e=>setStageTyped(e.target.value)}/></label>}
     {canStage&&item.status==='validated'&&verifiedBackups.length>0&&<button className="p-button orange small" disabled={busy||!backupId||stageTyped!=='STAGE UPDATE'} onClick={()=>{if(stageTyped==='STAGE UPDATE')stage(item.id)}} data-testid={'button-update-stage-'+item.id}>{t(language,'stage')}</button>}
    </div>
    {item.status==='validated'&&canStage&&verifiedBackups.length===0&&<p className="sc-note">{t(language,'noBackup')}</p>}
    {item.backupId&&<p className="sc-note">{t(language,'backup')}: <span className="sc-mono">{item.backupId}</span></p>}
   </article>)}</div>}
  </section>}
 </div>;
}
