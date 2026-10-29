import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {Download,RefreshCw,Send} from 'lucide-react';
import {request} from './client';
import {fmtDate} from './console-util';
import type {Language} from './i18n';
import type {RoleContext} from './types';
import AudiencePicker,{type AudienceTarget} from './AudiencePicker';
import './console.css';
type Row=Record<string,any>;
const S={
 en:{title:'Email campaigns',compose:'Create an email campaign',subject:'Subject',body:'Message',preview:'Preview recipients',recipients:'Recipients',queue:'Create campaign',start:'Start sending',search:'Search campaigns',from:'From',to:'To',apply:'Apply',export:'Export CSV',refresh:'Refresh',target:'Audience',date:'Created',status:'Status',accepted:'Accepted by provider',failed:'Failed',unknown:'Unconfirmed',empty:'No campaigns found.',queued:'Queued',sending:'Sending',acceptedStatus:'Accepted',local:'Local outbox',partial:'Partially sent',failedStatus:'Failed',unknownStatus:'Unconfirmed',confirm:'Start sending individually to the selected recipients?',created:'Campaign queued. Sending starts only after you confirm.',sendingNow:'Sending…',limit:'Maximum 5,000 recipients per campaign. Messages are sent individually; recipients do not see each other.'},
 ru:{title:'Email-рассылки',compose:'Создать рассылку',subject:'Тема',body:'Текст письма',preview:'Проверить получателей',recipients:'Получателей',queue:'Создать рассылку',start:'Начать отправку',search:'Поиск рассылок',from:'С',to:'По',apply:'Применить',export:'Экспорт CSV',refresh:'Обновить',target:'Аудитория',date:'Создано',status:'Статус',accepted:'Принято почтовым сервисом',failed:'Ошибки',unknown:'Не подтверждено',empty:'Рассылок нет.',queued:'В очереди',sending:'Отправляется',acceptedStatus:'Принято',local:'Локальная очередь',partial:'Отправлено частично',failedStatus:'Ошибка',unknownStatus:'Нет подтверждения',confirm:'Начать отправку отдельных писем выбранным получателям?',created:'Рассылка поставлена в очередь. Отправка начнётся только после подтверждения.',sendingNow:'Отправка…',limit:'До 5 000 получателей на рассылку. Письма отправляются отдельно; адресаты не видят друг друга.'},
 hy:{title:'Էլ․ փոստի արշավներ',compose:'Ստեղծել նամակների արշավ',subject:'Թեմա',body:'Նամակի տեքստ',preview:'Ստուգել ստացողներին',recipients:'Ստացողներ',queue:'Ստեղծել արշավ',start:'Սկսել ուղարկումը',search:'Որոնել արշավներ',from:'Սկսած',to:'Մինչև',apply:'Կիրառել',export:'CSV արտահանում',refresh:'Թարմացնել',target:'Լսարան',date:'Ստեղծվել է',status:'Կարգավիճակ',accepted:'Ընդունված է մատակարարի կողմից',failed:'Սխալներ',unknown:'Չհաստատված',empty:'Արշավներ չկան։',queued:'Հերթում է',sending:'Ուղարկվում է',acceptedStatus:'Ընդունված է',local:'Տեղական հերթ',partial:'Մասնակի ուղարկված',failedStatus:'Սխալ',unknownStatus:'Չհաստատված',confirm:'Սկսե՞լ առանձին նամակներով ուղարկումը ընտրված հասցեատերերին։',created:'Արշավը հերթագրվել է։ Ուղարկումը կսկսվի միայն ձեր հաստատումից հետո։',sendingNow:'Ուղարկվում է…',limit:'Մինչև 5 000 ստացող մեկ արշավում։ Նամակներն ուղարկվում են առանձին, հասցեատերերը միմյանց չեն տեսնում։'},
} as const;
export default function EmailCampaignConsole({c,language}:{c:RoleContext;language:Language}){
 const t=S[language];const [target,setTarget]=useState<AudienceTarget>({type:'all'}),[subject,setSubject]=useState(''),[body,setBody]=useState('');
 const [preview,setPreview]=useState<number>(),[campaign,setCampaign]=useState<Row>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [q,setQ]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[applied,setApplied]=useState({q:'',from:'',to:''});
 const [page,setPage]=useState(1),[data,setData]=useState<Row>(),[tick,setTick]=useState(0);
 const load=useCallback(async()=>{const params=new URLSearchParams({page:String(page),pageSize:'25'});for(const[k,v]of Object.entries(applied))if(v)params.set(k,v);
  setError('');try{setData(await request<Row>('/platform/email/campaigns?'+params))}catch(e){setError(String((e as Error).message??e))}},[applied,page]);
 useEffect(()=>{void load()},[load,tick,c.id]);
 const setAudience=(v:AudienceTarget)=>{setTarget(v);setPreview(undefined);setNotice('');setError('')};
 async function previewAudience(){setBusy(true);setError('');try{const r=await request<{count:number}>('/platform/communications/preview','POST',{target});setPreview(r.count)}catch(e){setError(String((e as Error).message??e))}finally{setBusy(false)}}
 async function create(e:FormEvent){e.preventDefault();if(busy||preview===undefined||preview<1||!subject.trim()||!body.trim())return;
  setBusy(true);setError('');setNotice('');try{const r=await request<Row>('/platform/email/campaigns','POST',{
   target,subject:subject.trim(),body:body.trim(),expectedRecipients:preview,idempotencyKey:crypto.randomUUID()});
   setCampaign(r);setNotice(t.created);setSubject('');setBody('');setPreview(undefined);setTick(n=>n+1);
  }catch(e){setError(String((e as Error).message??e))}finally{setBusy(false)}}
 async function start(){if(!campaign?.id||busy)return;if(!window.confirm(`${t.confirm} (${campaign.recipient_count})`))return;
  setBusy(true);setError('');setNotice('');
  try{let current:Row;
   do{current=await request<Row>(`/platform/email/campaigns/${encodeURIComponent(campaign.id)}/dispatch`,'POST',{});setCampaign((p:Row)=>({...p,...current}));}
   while(!current.done&&current.status==='sending');
   setNotice(`${current.accepted??0} · ${t.accepted}; ${current.failed??0} · ${t.failed}; ${current.unknown??0} · ${t.unknown}`);
   setTick(n=>n+1);
  }catch(e){setError(String((e as Error).message??e));setTick(n=>n+1)}finally{setBusy(false)}}
 function exportRows(){const params=new URLSearchParams();for(const[k,v]of Object.entries(applied))if(v)params.set(k,v);
  void fetch('/api/platform/email/campaigns/export.csv?'+params,{credentials:'include'}).then(async r=>{if(!r.ok)throw new Error('Export failed');const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='platform-email-campaigns.csv';a.click();URL.revokeObjectURL(url)}).catch(e=>setError(String(e.message??e)))}
 const items:Row[]=data?.items??[],pages=Math.max(1,Math.ceil(Number(data?.total??0)/25));
 const status=(s:string)=>({queued:t.queued,sending:t.sending,accepted:t.acceptedStatus,local:t.local,partial:t.partial,failed:t.failedStatus,unknown:t.unknownStatus}[s]??s);
 return <div className="p-business cx-wrap">
  <section className="p-card" aria-busy={busy}><h2>{t.title}</h2><form onSubmit={create}>
   <h3>{t.compose}</h3><AudiencePicker language={language} value={target} onChange={setAudience}/>
   <p className="p-muted">{t.limit}</p>
   <label>{t.subject}<input value={subject} onChange={e=>setSubject(e.target.value)} maxLength={200} required/></label>
   <label>{t.body}<textarea value={body} onChange={e=>setBody(e.target.value)} rows={5} maxLength={10000} required/></label>
   <div className="cx-row"><button type="button" className="p-button" disabled={busy} onClick={()=>void previewAudience()}>{t.preview}</button>
    {preview!==undefined&&<span aria-live="polite">{t.recipients}: <strong>{preview}</strong></span>}
    <button className="p-button orange" disabled={busy||preview===undefined||preview<1||!subject.trim()||!body.trim()}>{t.queue}</button>
   </div>
  </form>
  {campaign?.id&&campaign.status==='queued'&&<p><button className="p-button orange" disabled={busy} onClick={()=>void start()}><Send size={16}/>{busy?t.sendingNow:t.start} · {campaign.recipient_count}</button></p>}
  {campaign?.id&&campaign.status==='sending'&&<p role="status">{t.sending}: {campaign.recipient_count}</p>}
  {notice&&<p role="status" className="p-success">{notice}</p>}{error&&<p role="alert" className="p-error">{error}</p>}
  </section>
  <form className="p-card cx-form" role="search" onSubmit={e=>{e.preventDefault();setPage(1);setApplied({q,from,to})}}>
   <h3>{t.search}</h3><div className="cx-filters"><label>{t.search}<input value={q} onChange={e=>setQ(e.target.value)} maxLength={160}/></label>
    <label>{t.from}<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
    <label>{t.to}<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
   <div className="cx-row"><button className="p-button orange">{t.apply}</button>
    <button type="button" className="p-button" onClick={exportRows}><Download size={16}/>{t.export}</button>
    <button type="button" className="p-button" onClick={()=>setTick(n=>n+1)}><RefreshCw size={16}/>{t.refresh}</button></div>
  </form>
  <section className="p-card"><div className="cx-scroll"><table className="cx-table"><thead><tr>
   <th>{t.date}</th><th>{t.target}</th><th>{t.subject}</th><th>{t.recipients}</th><th>{t.status}</th><th>{t.accepted}</th><th>{t.failed}</th><th>{t.unknown}</th>
  </tr></thead><tbody>{items.map(r=><tr key={r.id}><td>{fmtDate(r.created_at,language)}</td><td>{r.target_label}</td>
   <td>{r.subject}</td><td>{r.recipient_count}</td><td>{status(r.status)}</td><td>{r.accepted_count}</td><td>{r.failed_count}</td><td>{r.unknown_count}</td></tr>)}
   {data&&!items.length&&<tr><td colSpan={8}>{t.empty}</td></tr>}</tbody></table></div>
   <div className="cx-row"><button className="p-button" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>‹</button>
    <span>{page} / {pages} · {data?.total??'—'}</span><button className="p-button" disabled={page>=pages} onClick={()=>setPage(p=>p+1)}>›</button></div></section>
 </div>
}
