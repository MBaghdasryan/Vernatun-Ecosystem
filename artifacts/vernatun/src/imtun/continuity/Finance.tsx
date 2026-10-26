import {useQuery} from '@tanstack/react-query';
import {getResidentBuildingFinance} from '@workspace/api-client-react';
import type {RoleContext} from '../../portal/types';
import type {Language} from '../../portal/i18n';
import {tt,status} from './core';
import './continuity.css';
const money=(l:Language,v:string|null,cur:string)=>v===null?'—':(Number(v)/100).toLocaleString(l,{minimumFractionDigits:2,maximumFractionDigits:2})+' '+cur;
export default function BuildingFinance({c,l}:{c:RoleContext;l:Language}){
 const q=useQuery({queryKey:['resident-cx-finance',c.id],retry:false,queryFn:()=>getResidentBuildingFinance()});
 const off=q.isError&&status(q.error)===403;
 return <section className="cx im-card sx-form" aria-labelledby="cx-fin"><h3 id="cx-fin">{tt(l,'Շենքի ֆինանսական թափանցիկություն','Финансовая прозрачность дома','Building finance transparency')}</h3>
 {q.isPending&&<div className="sx-skel" aria-busy="true">…</div>}
 {off&&<p>{tt(l,'Այս բաժինը հասանելի չէ այս շենքի համար։','Раздел недоступен для этого здания.','This section is not available for this building.')}</p>}
 {q.isError&&!off&&<div className="im-notice" role="alert">{tt(l,'Չհաջողվեց բեռնել։','Не удалось загрузить.','Could not load.')} <button onClick={()=>q.refetch()}>{tt(l,'Կրկնել','Повторить','Retry')}</button></div>}
 {q.data&&!q.data.length&&<p>{tt(l,'Հրապարակված տվյալներ չկան','Опубликованных данных нет','No published data')}</p>}
 {!!q.data?.length&&<table className="cx-fin"><thead><tr><th>{tt(l,'Ժամանակաշրջան','Период','Period')}</th><th>{tt(l,'Հրապարակված գանձումներ','Начислено','Published charges')}</th><th>{tt(l,'Բաշխված վճարումներ','Распределено платежей','Allocated payments')}</th></tr></thead><tbody>
 {q.data.map(r=><tr key={r.period+r.currency}><td>{r.period} · {r.currency}</td>{r.status==='INSUFFICIENT_COHORT'?<td colSpan={2}>{tt(l,'Անբավարար տվյալներ գաղտնիության համար','Недостаточно данных для защиты приватности','Not enough data to protect privacy')}</td>:<><td>{money(l,r.publishedMinor,r.currency)}</td><td>{money(l,r.allocatedMinor,r.currency)}</td></>}</tr>)}</tbody></table>}</section>}
