import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {Download,RefreshCw,Send} from 'lucide-react';
import {request} from './client';
import {fmtDate} from './console-util';
import type {Language} from './i18n';
import type {RoleContext} from './types';
import AudiencePicker,{type AudienceTarget} from './AudiencePicker';
import Notifications from './Notifications';
import './console.css';
type Row=Record<string,any>;
const S={
 en:{title:'Platform notifications',compose:'Write a notification',headline:'Title',body:'Message',preview:'Preview audience',send:'Send in app',search:'Search notifications',from:'From',to:'To',apply:'Apply',export:'Export CSV',refresh:'Refresh',target:'Target',recipients:'Recipients',date:'Created',empty:'No notifications found.',confirm:'Send this in-app notification to the selected audience?',previewCount:'Recipients in preview',busy:'Sending…',sent:'Notification created and added to the in-app inbox.'},
 ru:{title:'Уведомления платформы',compose:'Новое уведомление',headline:'Заголовок',body:'Текст уведомления',preview:'Проверить аудиторию',send:'Отправить в приложении',search:'Поиск уведомлений',from:'С',to:'По',apply:'Применить',export:'Экспорт CSV',refresh:'Обновить',target:'Получатели',recipients:'Количество',date:'Создано',empty:'Уведомлений нет.',confirm:'Отправить уведомление выбранным пользователям в приложении?',previewCount:'Получателей по предварительной проверке',busy:'Отправка…',sent:'Уведомление создано и добавлено во входящие приложения.'},
 hy:{title:'Հարթակի ծանուցումներ',compose:'Նոր ծանուցում',headline:'Վերնագիր',body:'Ծանուցման տեքստ',preview:'Ստուգել լսարանը',send:'Ուղարկել հավելվածում',search:'Որոնել ծանուցումներ',from:'Սկսած',to:'Մինչև',apply:'Կիրառել',export:'CSV արտահանում',refresh:'Թարմացնել',target:'Ստացողներ',recipients:'Քանակը',date:'Ստեղծվել է',empty:'Ծանուցումներ չկան։',confirm:'Ուղարկե՞լ ծանուցումը ընտրված օգտատերերին հավելվածում։',previewCount:'Նախնական ստուգման ստացողների թիվը',busy:'Ուղարկվում է…',sent:'Ծանուցումը ստեղծվել և ավելացվել է հավելվածի մուտքային բաժնում։'},
} as const;
export default function PlatformNotificationsConsole({c,language}:{c:RoleContext;language:Language}){
 if(location.pathname.endsWith('/notifications'))return <Notifications c={c} language={language}/>;
 const t=S[language];const [target,setTarget]=useState<AudienceTarget>({type:'all'}),[title,setTitle]=useState(''),[body,setBody]=useState('');
 const [preview,setPreview]=useState<number>(),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const [q,setQ]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[applied,setApplied]=useState({q:'',from:'',to:''});
 const [page,setPage]=useState(1),[data,setData]=useState<Row>(),[tick,setTick]=useState(0);
 const load=useCallback(async()=>{const params=new URLSearchParams({page:String(page),pageSize:'25'});for(const[k,v]of Object.entries(applied))if(v)params.set(k,v);
  setError('');try{setData(await request<Row>('/platform/notifications?'+params))}catch(e){setError(String((e as Error).message??e))}},[applied,page]);
 useEffect(()=>{void load()},[load,tick,c.id]);
 const setAudience=(value:AudienceTarget)=>{setTarget(value);setPreview(undefined);setNotice('');setError('')};
 async function previewAudience(){setBusy(true);setError('');setNotice('');try{const r=await request<{count:number}>('/platform/communications/preview','POST',{target});setPreview(r.count)}catch(e){setError(String((e as Error).message??e))}finally{setBusy(false)}}
 async function send(e:FormEvent){e.preventDefault();if(busy||preview===undefined||preview<1||!title.trim()||!body.trim())return;
  if(!window.confirm(t.confirm))return;
  setBusy(true);setError('');setNotice('');
  try{await request('/platform/notifications','POST',{target,title:title.trim(),body:body.trim(),expectedRecipients:preview,idempotencyKey:crypto.randomUUID()});
   setNotice(t.sent);setTitle('');setBody('');setPreview(undefined);setPage(1);setTick(n=>n+1);
  }catch(e){setError(String((e as Error).message??e))}finally{setBusy(false)}}
 function exportRows(){const params=new URLSearchParams();for(const[k,v]of Object.entries(applied))if(v)params.set(k,v);
  void fetch('/api/platform/notifications/export.csv?'+params,{credentials:'include'}).then(async r=>{if(!r.ok)throw new Error('Export failed');const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='platform-notifications.csv';a.click();URL.revokeObjectURL(url)}).catch(e=>setError(String(e.message??e)))}
 const items:Row[]=data?.items??[],pages=Math.max(1,Math.ceil(Number(data?.total??0)/25));
 return <div className="p-business cx-wrap">
  <section className="p-card" aria-busy={busy}><h2>{t.title}</h2><form onSubmit={send}>
   <h3>{t.compose}</h3><AudiencePicker language={language} value={target} onChange={setAudience}/>
   <div className="cx-filters"><label>{t.headline}<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={140} required/></label></div>
   <label>{t.body}<textarea value={body} onChange={e=>setBody(e.target.value)} rows={5} maxLength={5000} required/></label>
   <div className="cx-row"><button type="button" className="p-button" disabled={busy} onClick={()=>void previewAudience()}>{t.preview}</button>
    {preview!==undefined&&<span aria-live="polite">{t.previewCount}: <strong>{preview}</strong></span>}
    <button className="p-button orange" disabled={busy||preview===undefined||preview<1||!title.trim()||!body.trim()}><Send size={16}/>{busy?t.busy:t.send}</button>
   </div>
  </form>{notice&&<p role="status" className="p-success">{notice}</p>}{error&&<p role="alert" className="p-error">{error}</p>}</section>
  <form className="p-card cx-form" role="search" onSubmit={e=>{e.preventDefault();setPage(1);setApplied({q,from,to})}}>
   <h3>{t.search}</h3><div className="cx-filters"><label>{t.search}<input value={q} onChange={e=>setQ(e.target.value)} maxLength={160}/></label>
    <label>{t.from}<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
    <label>{t.to}<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
   <div className="cx-row"><button className="p-button orange">{t.apply}</button>
    <button type="button" className="p-button" onClick={exportRows}><Download size={16}/>{t.export}</button>
    <button type="button" className="p-button" onClick={()=>setTick(n=>n+1)}><RefreshCw size={16}/>{t.refresh}</button></div>
  </form>
  <section className="p-card" aria-busy={!data&&!error}><div className="cx-scroll"><table className="cx-table"><thead><tr><th>{t.date}</th><th>{t.target}</th><th>{t.recipients}</th><th>{t.headline}</th><th>{t.body}</th></tr></thead><tbody>
   {items.map(r=><tr key={r.id}><td>{fmtDate(r.created_at,language)}</td><td>{r.target_label}</td><td>{r.recipient_count}</td><td>{r.title}</td><td>{r.body}</td></tr>)}
   {data&&!items.length&&<tr><td colSpan={5}>{t.empty}</td></tr>}
  </tbody></table></div><div className="cx-row"><button className="p-button" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>‹</button>
   <span>{page} / {pages} · {data?.total??'—'}</span><button className="p-button" disabled={page>=pages} onClick={()=>setPage(p=>p+1)}>›</button></div></section>
 </div>
}
