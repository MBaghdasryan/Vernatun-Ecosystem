import {useEffect,useRef,useState,type FormEvent} from 'react';
import {getDefectCollaboration,postDefectMessage,type DefectCollaboration as CollaborationData} from '@workspace/api-client-react';
import {getCsrfHeaders} from './client';
import type {Language} from './i18n';
import './defect-collaboration.css';

const S={
 title:['Պարզաբանումներ և նյութեր','Уточнения и материалы','Clarifications & evidence'],
 messages:['Նամակագրություն','Переписка','Conversation'],
 text:['Հաղորդագրություն','Сообщение','Message'],
 send:['Ուղարկել','Отправить','Send'],
 sending:['Ուղարկվում է…','Отправляется…','Sending…'],
 refresh:['Թարմացնել','Обновить','Refresh'],
 older:['Նախորդ հաղորդագրությունները','Предыдущие сообщения','Older messages'],
 latest:['Վերջին հաղորդագրությունները','Последние сообщения','Latest messages'],
 empty:['Հաղորդագրություններ դեռ չկան','Сообщений пока нет','No messages yet'],
 loading:['Բեռնվում է…','Загрузка…','Loading…'],
 error:['Չհաջողվեց բեռնել։ Կրկին փորձեք։','Не удалось загрузить. Повторите попытку.','Could not load. Please retry.'],
 sendError:['Չհաջողվեց հաստատել ուղարկումը։ Տեքստը պահպանված է, կարող եք կրկնել։','Не удалось подтвердить отправку. Текст сохранён в форме — можно повторить.','Could not confirm delivery. Your text is still in the form; you can retry.'],
 readOnly:['Հասանելի է միայն ընթերցումը','Доступно только чтение','Read-only access'],
 note:['Հաղորդագրությունը չի փոխում աշխատանքի կարգավիճակը։ Ուղարկված տեքստը չի խմբագրվում։','Сообщение не меняет статус работы. Отправленный текст нельзя изменить.','A message does not change work status. Sent text cannot be edited.'],
 photos:['Լուսանկարներ','Фотографии','Photos'],
 reports:['Հաշվետվություններ և ընդունում','Отчёты и приёмка','Reports & acceptance'],
 noPhotos:['Լուսանկարներ չկան','Фотографий нет','No photos'],
 noReports:['Հաշվետվություններ դեռ չկան','Отчётов пока нет','No reports yet'],
 report:['Հաշվետվություն','Отчёт','Report'],
 return:['Վերադարձվել է','Возвращено','Returned'],
 accept:['Ընդունվել է','Принято','Accepted'],
 reopen:['Վերաբացվել է','Открыто повторно','Reopened'],
 evidenceHint:['Միայն այս թերության նյութերը։ Ընդհանուր փաստաթղթերը հասանելի չեն։','Только материалы этого дефекта. Общий архив документов не открывается.','Only this defect’s evidence; not the general document archive.'],
 openPhoto:['Բացել լուսանկարը','Открыть фотографию','Open photo'],
 photoError:['Լուսանկարը հասանելի չէ','Фотография недоступна','Photo unavailable'],
} as const;
export default function DefectCollaboration({id,language,revision:externalRevision=0}:{id:string;language:Language;revision?:number}){
 const t=(key:keyof typeof S)=>S[key][language==='hy'?0:language==='ru'?1:2];
 const [data,setData]=useState<CollaborationData>(),[error,setError]=useState(false),[text,setText]=useState(''),[sendError,setSendError]=useState(false),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0),[before,setBefore]=useState<string>(),[broken,setBroken]=useState<string[]>([]);
 const operation=useRef<{key:string;body:string}|undefined>(undefined);
 // This component is keyed by defect ID in both workspaces; changing assignment
 // context also remounts its parent. No conversation is stored offline.
 useEffect(()=>{
  let active=true,serial=0;const abort=new AbortController();
  const load=async()=>{const turn=++serial;try{
   const result=await getDefectCollaboration(id,before?{before}:undefined,{signal:abort.signal});
   if(active&&turn===serial){setData(result);setError(false)}
  }catch{if(active&&turn===serial){setData(undefined);setError(true)}}};
  void load();
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load()},15000);
  const focus=()=>void load();window.addEventListener('focus',focus);
  return()=>{active=false;abort.abort();clearInterval(timer);window.removeEventListener('focus',focus)};
 },[id,before,revision,externalRevision]);
 async function submit(e:FormEvent){
  e.preventDefault();const body=text.trim();if(busy||!body||!data?.canWrite)return;
  if(operation.current?.body!==body)operation.current={key:crypto.randomUUID(),body};
  setBusy(true);setSendError(false);
  try{
   await postDefectMessage(id,operation.current,{headers:getCsrfHeaders()});
   setText('');operation.current=undefined;setBefore(undefined);setRevision(n=>n+1);
  }catch{setSendError(true)}finally{setBusy(false)}
 }
 const stamp=(d:string)=>new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Yerevan'}).format(new Date(d));
 return <section className="dc-panel" aria-label={t('title')}>
  <header><h3>{t('title')}</h3><button type="button" onClick={()=>setRevision(n=>n+1)}>{t('refresh')}</button></header>
  {error?<p role="alert">{t('error')}</p>:!data?<p role="status">{t('loading')}</p>:<>
   <h4>{t('messages')} <span>({data.total})</span></h4>
   <div className="dc-pagination">
    {data.nextCursor&&<button type="button" onClick={()=>{setData(undefined);setBefore(data.nextCursor!)}}>{t('older')}</button>}
    {before&&<button type="button" onClick={()=>{setData(undefined);setBefore(undefined)}}>{t('latest')}</button>}
   </div>
   <ol className="dc-messages">{data.messages.length?data.messages.map(m=><li key={m.id}>
    <div><strong>{m.actor}</strong><time dateTime={m.created_at}>{stamp(m.created_at)}</time></div><p>{m.body}</p>
   </li>):<li>{t('empty')}</li>}</ol>
   {data.canWrite?<form onSubmit={submit}>
    <label>{t('text')}<textarea value={text} onChange={e=>setText(e.target.value)} required maxLength={4000} rows={3} disabled={busy}/></label>
    <small>{t('note')}</small>
    {sendError&&<p role="alert">{t('sendError')}</p>}
    <button type="submit" disabled={busy||!text.trim()}>{t(busy?'sending':'send')}</button>
   </form>:<p>{t('readOnly')}</p>}
   <details><summary>{t('photos')} ({data.photos.length}) · {t('reports')} ({data.reports.length})</summary>
    <p>{t('evidenceHint')}</p>
    <h4>{t('photos')}</h4>
    {!data.photos.length?<p>{t('noPhotos')}</p>:<div className="dc-photos">{data.photos.map((p,n)=><a key={p.id} href={`${import.meta.env.BASE_URL}api/defect-photos/${p.id}`} target="_blank" rel="noreferrer">
     {broken.includes(p.id)?<span>{t('photoError')}</span>:<img loading="lazy" src={`${import.meta.env.BASE_URL}api/defect-photos/${p.id}`} onError={()=>setBroken(ids=>[...ids,p.id])} alt={`${t('openPhoto')} ${n+1}`}/>}
     <span>{t('openPhoto')} {n+1}</span><time>{stamp(p.created_at)}</time>
    </a>)}</div>}
    <h4>{t('reports')}</h4>
    <ol className="dc-messages">{data.reports.length?data.reports.map(r=><li key={r.id}><div><strong>{t(r.action)} · {r.actor}</strong><time dateTime={r.created_at}>{stamp(r.created_at)}</time></div><p>{r.note}</p></li>):<li>{t('noReports')}</li>}</ol>
   </details>
  </>}
 </section>;
}
