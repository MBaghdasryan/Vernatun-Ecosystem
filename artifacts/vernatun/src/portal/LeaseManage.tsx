import {useRef,useState} from 'react';
import {request,ApiClientError} from './client';
import type {LeaseLifecycleInput} from '@workspace/api-client-react';
import {leaseStatus} from './Lifecycle';
import type {Language} from './i18n';
type Row=Record<string,any>;
const S={extend:['Երկարացնել','Продлить','Extend lease'],cancel:['Չեղարկել պայմանագիրը','Расторгнуть договор','Cancel lease'],ends:['Նոր ավարտի ամսաթիվ','Новая дата окончания','New end date'],reason:['Պատճառ (առնվազն 3 նիշ)','Причина (не менее 3 символов)','Reason (min 3 characters)'],
 latest:['Օգտագործել վերջին տարբերակը և պահպանել իմ արժեքները','Взять последнюю версию и сохранить мои значения','Use latest version and keep my values'],cancelled:['Չեղարկված','Расторгнут','Cancelled'],active:['Գործող','Действует','Active'],error:['Գործողությունը չհաջողվեց։','Действие не выполнено.','Action failed.'],conflict:['Պայմանագիրը փոխվել է։ Թարմացրեք էջը։','Договор изменён. Обновите страницу.','Lease changed. Refresh the page.'],done:['Պահպանված է','Сохранено','Saved'],close:['Փակել','Закрыть','Close']} as const;
export default function LeaseManage({lease,language,onChanged,onClose,onReload}:{lease:Row;language:Language;onChanged:()=>Promise<void>;onReload:()=>Promise<void>;onClose:()=>void}){
 const i=language==='hy'?0:language==='ru'?1:2;const t=(k:keyof typeof S)=>S[k][i];
 const [ends,setEnds]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[err,setErr]=useState(''),[ok,setOk]=useState('');const lock=useRef(false);const version=useRef<number>(lease.version);const [stale,setStale]=useState(false);
 async function run(path:string,body:Row){if(lock.current)return;lock.current=true;setBusy(true);setErr('');setOk('');
  try{const input:LeaseLifecycleInput={version:version.current,...body};await request(path,'POST',input);setOk(t('done'));setEnds('');setReason('');await onChanged()}
  catch(e){if(e instanceof ApiClientError&&e.code==='stale_version'){setStale(true);void onReload().catch(()=>{})}setErr(e instanceof ApiClientError&&e.code==='stale_version'?t('conflict'):t('error')+(e instanceof ApiClientError?' ('+e.code+')':''))}finally{lock.current=false;setBusy(false)}}
 const dead=!!lease.cancelled_at;
 return <section className="p-card p-edit-form"><h3>{lease.number} · {leaseStatus(lease,language)}</h3>{(stale||lease.version!==version.current)&&!dead&&<p className="p-info"><button className="p-button" onClick={()=>{version.current=lease.version;setStale(false);setErr('')}}>{t('latest')}</button></p>}{err&&<p className="p-error" role="alert">{err}</p>}{ok&&<p role="status">{ok}</p>}
  {!dead&&<><label>{t('ends')}<input type="date" value={ends} min={String(lease.starts_on).slice(0,10)} onChange={e=>setEnds(e.target.value)}/></label><button className="p-button" disabled={busy||!ends||stale||lease.version!==version.current} onClick={()=>void run('/leases/'+lease.id+'/extend',{endsOn:ends})}>{t('extend')}</button>
  <label>{t('reason')}<textarea minLength={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="p-button orange" disabled={busy||reason.trim().length<3||stale||lease.version!==version.current} onClick={()=>void run('/leases/'+lease.id+'/cancel',{reason:reason.trim()})}>{t('cancel')}</button></>}
  <button className="p-button" onClick={onClose}>{t('close')}</button></section>}
