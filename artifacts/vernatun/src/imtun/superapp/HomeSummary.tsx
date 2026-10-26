import {useQuery} from '@tanstack/react-query';
import {getResidentWorkspace} from '@workspace/api-client-react';
import type {RoleContext} from '../../portal/types';
import {money,type Currency,type Language} from '../../portal/i18n';
import {viewRoute} from '../../../shared/products';
import {available} from '../config';
import {L,type T} from './text';
import './homeSummary.css';
const X={
 h:['Տան ամփոփում','Сводка по дому','Home summary'] as T,
 pay:['Վերջին վճարում','Последний платёж','Latest payment'] as T,
 chat:['Չկարդացված հաղորդագրություններ','Непрочитанные сообщения','Unread messages'] as T,
 pass:['Ակտիվ հյուրի անցագրեր','Активные гостевые пропуска','Active guest passes'] as T,
 inv:['Սպասող հրավերներ','Ожидающие приглашения семьи','Pending household invitations'] as T,
 agr:['Պահանջվող համաձայնագրեր','Соглашения к принятию','Agreements to accept'] as T,
 sos:['Արտակարգ կապ','Экстренная связь','Emergency contacts'] as T,
 news:['Հայտարարություններ','Объявления','Announcements'] as T,
 vote:['Ակտիվ քվեարկություն','Активные голосования','Active voting'] as T,
 svc:['Ծառայություններ','Услуги','Services'] as T,
 un:['Հասանելի չէ','Недоступно','Unavailable'] as T,
 st:['Կարգավիճակներ','Статусы','Statuses'] as T,
 util:['Կոմունալ ծառայություններ․ պահանջվում է մատակարարի պայմանագիր','Коммунальные: требуется договор с провайдером','Utilities: provider contract required'] as T,
 utilU:['Կոմունալ ծառայություններ․ տվյալներ չկան','Коммунальные: данные недоступны','Utilities: data unavailable'] as T,
 int:['Սպասարկման ընդհատումներ․ տվյալներ չկան','Отключения: данные недоступны','Service interruptions: data unavailable'] as T,
 el:['Վերելակ․ չի կարգավորված','Лифт: не настроен','Elevator: not configured'] as T,
 ac:['Մուտք․ չի կարգավորված, գործողություն չկա','Доступ: не настроен, действий нет','Access: not configured, no actions'] as T,
 fail:['Ամփոփումը չբեռնվեց','Сводка не загрузилась','Summary failed to load'] as T,
 retry:['Կրկնել','Повторить','Retry'] as T,
};
export default function HomeSummary({c,language:l}:{c:RoleContext;language:Language}){
 const q=useQuery({queryKey:['resident-ws',c.id],queryFn:()=>getResidentWorkspace()});
 const go=(view:string,search='')=>{const href=viewRoute('imtun',view,c.role_key)+search;return {href,onClick:(e:React.MouseEvent)=>{if(e.metaKey||e.ctrlKey)return;e.preventDefault();history.pushState(null,'',href);window.dispatchEvent(new PopStateEvent('popstate'))}}};
 if(q.isError)return <div className="im-notice" role="alert">{L(l,X.fail)} <button onClick={()=>q.refetch()}>{L(l,X.retry)}</button></div>;
 if(!q.data)return <div className="im-card hs-skel" aria-busy="true"/>;
 const s=q.data.home.summary,lp=s.latestPayment;
 const cnt=(label:T,n:number|null,view:string,perm=true)=>n===null||!perm||!available(c,view)?null:<a key={view+label[2]} className="hs-tile" {...go(view)}><strong>{n}</strong><span>{L(l,label)}</span></a>;
 const tiles=[cnt(X.chat,s.unreadMessages,'community'),cnt(X.pass,s.activeGuestPasses,'passes'),cnt(X.inv,s.pendingHouseholdInvitations,'delegations'),cnt(X.agr,s.pendingAgreements,'agreements')].filter(Boolean);
 const lists:[T,typeof s.announcements,string,string][]=[[X.news,s.announcements,'announcements',''],[X.vote,s.activeVoting,'meetings',''],[X.svc,s.services,'services','']];
 const fmt=(a:string,cur:string)=>money(a,cur as Currency,l);
 return <section className="hs" aria-label={L(l,X.h)}><h2>{L(l,X.h)}</h2>
  {lp&&available(c,'finance')&&<a className="hs-pay" {...go('finance')}><span>{L(l,X.pay)}</span><strong>{fmt(lp.amountMinor,lp.currency)}</strong><small>{new Date(lp.createdAt).toLocaleDateString(l,{timeZone:q.data?.building.timezone})}</small></a>}
  {tiles.length>0&&<div className="hs-tiles">{tiles}</div>}
  {s.emergencyContacts.length>0&&<div className="hs-sos"><strong>{L(l,X.sos)}</strong>{s.emergencyContacts.map(e=><a key={e.id} href={'tel:'+e.phone}>{e.title} · {e.phone}</a>)}</div>}
  <div className="hs-lists">{lists.map(([t,items,view])=>items&&items.length>0&&available(c,view)?<div key={view} className="hs-list"><strong>{L(l,t)}</strong>{items.map(i=><a key={i.id} {...go(view,view==='services'?'?recordKind=services&recordId='+encodeURIComponent(i.id):'')}><span>{i.title}</span>{i.description&&<small>{i.description}</small>}</a>)}</div>:null)}</div>
  <div className="hs-status"><strong>{L(l,X.st)}</strong><ul>
   <li>{L(l,s.utilityStatus==='CONTRACT_REQUIRED'?X.util:X.utilU)}</li><li>{L(l,X.int)}</li><li>{L(l,X.el)}</li><li>{L(l,X.ac)}</li></ul></div>
 </section>}
