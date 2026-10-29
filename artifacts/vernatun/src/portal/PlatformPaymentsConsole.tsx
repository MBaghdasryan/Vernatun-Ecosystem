import {useCallback,useEffect,useState} from 'react';
import {Download,RefreshCw} from 'lucide-react';
import {request} from './client';
import {fmtDate,fromMinor} from './console-util';
import type {Language} from './i18n';
import type {RoleContext} from './types';
import './console.css';
type Row=Record<string,any>;
const S={
 en:{title:'Company payments',search:'Search by company, plan or type',from:'From',to:'To',apply:'Apply',export:'Export CSV',refresh:'Refresh',type:'Company type',company:'Company',date:'Date',billingPeriod:'Billing period',plan:'Plan',amount:'Amount',paid:'Paid',status:'Status',empty:'No company payments found.',developer:'Developer',management_company:'Management company'},
 ru:{title:'Платежи компаний',search:'Поиск по компании, пакету или типу',from:'С',to:'По',apply:'Применить',export:'Экспорт CSV',refresh:'Обновить',type:'Тип компании',company:'Компания',date:'Дата',billingPeriod:'Период',plan:'Пакет',amount:'Размер платежа',paid:'Оплачено',status:'Статус',empty:'Платежей компаний нет.',developer:'Застройщик',management_company:'Управляющая компания'},
 hy:{title:'Կազմակերպությունների վճարումներ',search:'Որոնել կազմակերպությամբ, փաթեթով կամ տեսակով',from:'Սկսած',to:'Մինչև',apply:'Կիրառել',export:'CSV արտահանում',refresh:'Թարմացնել',type:'Կազմակերպության տեսակ',company:'Կազմակերպություն',date:'Ամսաթիվ',billingPeriod:'Ժամանակահատված',plan:'Փաթեթ',amount:'Վճարի չափ',paid:'Վճարված է',status:'Կարգավիճակ',empty:'Կազմակերպությունների վճարումներ չկան։',developer:'Կառուցապատող',management_company:'Կառավարման ընկերություն'},
} as const;
export default function PlatformPaymentsConsole({language}:{c:RoleContext;language:Language}){
 const t=S[language];const [q,setQ]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[applied,setApplied]=useState({q:'',from:'',to:''});
 const [page,setPage]=useState(1),[data,setData]=useState<Row>(),[error,setError]=useState(''),[tick,setTick]=useState(0);
 const load=useCallback(async()=>{const params=new URLSearchParams({page:String(page),pageSize:'25'});for(const[k,v]of Object.entries(applied))if(v)params.set(k,v);
  setError('');try{setData(await request<Row>('/payments/platform-ledger?'+params))}catch(e){setError(String((e as Error).message??e))}},[applied,page]);
 useEffect(()=>{void load()},[load,tick]);
 function exportRows(){const params=new URLSearchParams();for(const[k,v]of Object.entries(applied))if(v)params.set(k,v);
  void fetch('/api/payments/platform-ledger/export.csv?'+params,{credentials:'include'}).then(async r=>{if(!r.ok)throw new Error('Export failed');const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='company-payments.csv';a.click();URL.revokeObjectURL(url)}).catch(e=>setError(String(e.message??e)))}
 const items:Row[]=data?.items??[],pages=Math.max(1,Math.ceil(Number(data?.total??0)/25));
 const type=(value:string)=>t[value as keyof typeof t]??value;
 return <div className="p-business cx-wrap">
  <form className="p-card cx-form" role="search" onSubmit={e=>{e.preventDefault();setPage(1);setApplied({q,from,to})}}>
   <h2>{t.title}</h2><div className="cx-filters"><label>{t.search}<input value={q} onChange={e=>setQ(e.target.value)} maxLength={160}/></label>
    <label>{t.from}<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
    <label>{t.to}<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
   <div className="cx-row"><button className="p-button orange">{t.apply}</button>
    <button type="button" className="p-button" onClick={exportRows}><Download size={16}/>{t.export}</button>
    <button type="button" className="p-button" onClick={()=>setTick(n=>n+1)}><RefreshCw size={16}/>{t.refresh}</button></div>
  </form>{error&&<p role="alert" className="p-error">{error}</p>}
  <section className="p-card" aria-busy={!data&&!error}><div className="cx-scroll"><table className="cx-table"><thead><tr>
   <th>{t.type}</th><th>{t.company}</th><th>{t.date}</th><th>{t.billingPeriod}</th><th>{t.plan}</th><th>{t.amount}</th><th>{t.paid}</th><th>{t.status}</th>
  </tr></thead><tbody>
   {items.map(r=><tr key={r.id}><td>{type(r.company_type)}</td><td>{r.organization_name}</td><td>{fmtDate(r.issued_at,language)}</td>
    <td>{String(r.billing_period).slice(0,10)}</td><td>{r.plan_name}</td><td>{fromMinor(String(r.amount_minor))} {r.currency}</td>
    <td>{fromMinor(String(r.paid_minor))} {r.currency}</td><td>{r.status}</td></tr>)}
   {data&&!items.length&&<tr><td colSpan={8}>{t.empty}</td></tr>}
  </tbody></table></div><div className="cx-row"><button className="p-button" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>‹</button>
   <span>{page} / {pages} · {data?.total??'—'}</span><button className="p-button" disabled={page>=pages} onClick={()=>setPage(p=>p+1)}>›</button></div></section>
 </div>
}
