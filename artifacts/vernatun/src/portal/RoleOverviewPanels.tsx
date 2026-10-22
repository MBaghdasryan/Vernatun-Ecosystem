import {useEffect,useState} from 'react';
import {ArrowRight,RefreshCw} from 'lucide-react';
import {request} from './client';
import {money,roleName,type Language} from './i18n';
import {viewModules,viewRoute,type Product} from '../../shared/products';
import type {RoleContext} from './types';

// Directory-style panels built from existing authorized endpoints. A panel renders only when
// the role holds the permission and module for its source; rows are real, selectable records.
type L3=readonly [string,string,string];
type Row=Record<string,any>;
type Col={h:L3;v:(r:Row)=>string};
type Spec={key:string;title:L3;path:string;ok:boolean;to:string;toLabel:L3;pick:(r:any)=>Row[];cols:Col[];open:(r:Row)=>string;summary?:(rows:Row[])=>string};
const list=(r:any):Row[]=>Array.isArray(r)?r:Array.isArray(r?.rows)?r.rows:Array.isArray(r?.items)?r.items:[];
const T={open:['Բացել','Открыть','Open'],all:['Բոլորը','Все','View all'],empty:['Գրառումներ չկան','Записей нет','No records'],err:['Չհաջողվեց բեռնել','Не удалось загрузить','Could not load'],retry:['Կրկնել','Повторить','Retry'],sel:['Ընտրված','Выбрано','Selected']} as const;
const dt=(l:Language,d?:string)=>d?new Intl.DateTimeFormat(l,{timeZone:'Asia/Yerevan',day:'numeric',month:'short',year:'numeric'}).format(new Date(d)):'—';
const day=86400000;

function Panel({s,language}:{s:Spec;language:Language}){
 const i=language==='hy'?0:language==='ru'?1:2;const [rows,setRows]=useState<Row[]>(),[err,setErr]=useState(false),[rev,setRev]=useState(0),[sel,setSel]=useState<string>();
 useEffect(()=>{let live=true;setRows(undefined);setErr(false);request<any>(s.path).then(r=>{if(live)setRows(s.pick(r))}).catch(()=>{if(live)setErr(true)});return()=>{live=false}},[s.path,rev]);
 const shown=rows?.slice(0,8)??[];const chosen=shown.find(r=>String(r.id)===sel);
 return <div className="rh-panel rh-dir"><h2>{s.title[i]}</h2>
  {err?<p className="rh-state">{T.err[i]} <button className="rh-link" onClick={()=>setRev(v=>v+1)}><RefreshCw size={14}/>{T.retry[i]}</button></p>
  :!rows?<div className="rh-row rh-skel"/>
  :!rows.length?<p className="rh-state">{T.empty[i]}</p>
  :<>{s.summary&&<p className="rh-dir-sum">{s.summary(rows)}</p>}
   <div className="rh-tablewrap"><table className="rh-table"><thead><tr>{s.cols.map(c=><th key={c.h[2]}>{c.h[i]}</th>)}</tr></thead>
   <tbody>{shown.map(r=><tr key={r.id} className={String(r.id)===sel?'on':''} aria-selected={String(r.id)===sel} tabIndex={0} onClick={()=>setSel(String(r.id))} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSel(String(r.id))}}}>{s.cols.map((c,n)=><td key={c.h[2]} data-label={c.h[i]}>{c.v(r)||'—'}{n===0&&<span className="sr-only"> </span>}</td>)}</tr>)}</tbody></table></div>
   {chosen&&<div className="rh-dir-sel"><span>{T.sel[i]}: <strong>{s.cols[0].v(chosen)}</strong></span><button className="rh-btn rh-btn-plain" onClick={()=>go(s.open(chosen))}>{T.open[i]}<ArrowRight size={15}/></button></div>}
  </>}
  <button className="rh-link rh-dir-all" onClick={()=>go(s.to)}>{s.toLabel[i]}<ArrowRight size={14}/></button></div>;
}
function go(path:string){history.pushState(null,'',path);window.dispatchEvent(new PopStateEvent('popstate'));window.scrollTo({top:0})}

export default function RoleOverviewPanels({c,language,currency,product}:{c:RoleContext;language:Language;currency:string;product:Product}){
 const role=c.role_key,p=(x:string)=>c.permissions.includes(x),mod=(v:string)=>!c.modules||!viewModules[v]||c.modules.includes(viewModules[v]);
 const can=(v:string,...ps:string[])=>mod(v)&&ps.some(p);
 const platform=!c.organization_id,orgWide=!c.building_id&&!c.unit_id;
 const r=(v:string)=>viewRoute(product as any,v,role);
 const now=Date.now();
 const status=(a:Row)=>{
  const states:Record<string,L3>={
   active:['Ակտիվ','Активен','Active'],account_blocked:['Հաշիվն արգելափակված է','Аккаунт заблокирован','Account blocked'],
   membership_suspended:['Անդամակցությունը կասեցված է','Участие приостановлено','Membership suspended'],revoked:['Հետ կանչված','Отозван','Revoked'],
   pending:['Սպասվող','Ожидает начала','Pending'],expired:['Ժամկետանց','Срок истёк','Expired']
  };
  return states[a.assignment_state]??['—','—','—'];
 };
 const specs:Spec[]=[];const add=(s:Spec)=>{if(s.ok)specs.push(s)};
 const lang=language==='hy'?0:language==='ru'?1:2;
 add({key:'orgs',title:['Վերջին կազմակերպությունները','Последние организации','Latest organizations'],path:'/organizations',ok:platform&&p('organizations.read'),to:'/console/organizations',toLabel:['Բոլոր կազմակերպությունները','Все организации','All organizations'],
  pick:x=>list(x).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))),open:()=>'/console/organizations',
  cols:[{h:['Անվանում','Название','Name'],v:x=>x.name},{h:['Կարգավիճակ','Статус','Status'],v:x=>x.status},{h:['Արժույթ','Валюта','Currency'],v:x=>x.currency},{h:['Ստեղծվել է','Создана','Created'],v:x=>dt(language,x.created_at)}]});
 add({key:'audit',title:['Վերջին աուդիտի գրառումները','Последние записи аудита','Recent audit records'],path:'/audit',ok:(platform&&(p('platform.audit')||p('audit.read')))||(!platform&&product==='os'&&can('audit','audit.read')),to:platform?'/console/audit':'/os/audit',toLabel:['Բացել աուդիտը','Открыть аудит','Open audit'],
  pick:x=>list(x),open:()=>platform?'/console/audit':'/os/audit',
  cols:[{h:['Գործողություն','Действие','Action'],v:x=>x.action},{h:['Օբյեկտ','Объект','Entity'],v:x=>x.entity_type},{h:['Կատարող','Исполнитель','Actor'],v:x=>x.actor},{h:['Ժամանակ','Время','When'],v:x=>dt(language,x.created_at)}]});
 add({key:'staff',title:['Աշխատակիցներ','Сотрудники организации','Organization employees'],path:'/people',ok:product==='os'&&!platform&&role==='org_admin'&&can('people','people.read'),to:'/os/people',toLabel:['Բոլոր աշխատակիցները','Все сотрудники','All employees'],
  pick:x=>list(x).filter(a=>!['unit_owner','renter','family'].includes(a.role_key)),open:()=>'/os/people',
  summary:rows=>{const n=rows.filter(a=>a.assignment_state==='active').length;const by:Record<string,number>={};rows.forEach(a=>{by[a.role_key]=(by[a.role_key]??0)+1});return [rows.length+' / '+n+' '+['ակտիվ նշանակումներ','активных назначений','active assignments'][lang],...Object.entries(by).slice(0,4).map(([k,v])=>roleName(language,k)+': '+v)].join(' · ')},
  cols:[{h:['Անուն','Имя','Name'],v:x=>x.name},{h:['Դեր','Роль','Role'],v:x=>roleName(language,x.role_key)},{h:['Սահման','Охват','Scope'],v:x=>x.building_id?['Շենք','Здание','Building'][lang]:['Կազմակերպություն','Организация','Organization'][lang]},{h:['Կարգավիճակ','Статус','Status'],v:x=>status(x)[lang]}]});
 add({key:'modules',title:['Մոդուլների ակտիվություն','Состояние модулей','Module overview'],path:'/modules',ok:product==='os'&&!platform&&role==='org_admin'&&p('modules.read'),to:'/os/modules',toLabel:['Կառավարել մոդուլները','Управлять модулями','Manage modules'],
  pick:x=>list(x).map(m=>({...m,id:m.module})),open:()=>'/os/modules',summary:rows=>rows.filter(m=>m.enabled).length+' / '+rows.length+' '+['միացված','включено','enabled'][lang],
  cols:[{h:['Մոդուլ','Модуль','Module'],v:x=>String(x.module)},{h:['Վիճակ','Состояние','State'],v:x=>x.enabled?['Միացված','Включён','Enabled'][lang]:['Անջատված','Отключён','Disabled'][lang]}]});
 add({key:'onbtable',title:['Ներդրման փուլեր','Этапы внедрения','Onboarding stages'],path:'/platform/onboarding',ok:platform&&p('onboarding.manage'),to:'/console/onboarding',toLabel:['Բացել ներդրումը','Открыть внедрение','Open onboarding'],
  pick:x=>list(x).filter(s=>s.status!=='completed').sort((a,b)=>String(a.due_on).localeCompare(String(b.due_on))),open:()=>'/console/onboarding',
  cols:[{h:['Փուլ','Этап','Stage'],v:x=>x.title},{h:['Կազմակերպություն','Организация','Organization'],v:x=>x.organization_name},{h:['Պատասխանատու','Ответственный','Assignee'],v:x=>x.assignee_name},{h:['Ժամկետ','Срок','Due'],v:x=>dt(language,x.due_on)}]});
 add({key:'bank',title:['Չհամընկնող բանկային տողեր','Несопоставленные банковские строки','Unmatched bank rows'],path:'/finance/bank/transactions?status=unmatched&limit=8',ok:product==='os'&&orgWide&&can('finance','payments.reconcile'),to:'/os/finance?tab=bank',toLabel:['Բացել համադրումը','Открыть сверку','Open reconciliation'],
  pick:x=>list(x),open:()=>'/os/finance?tab=bank',
  cols:[{h:['Վճարող','Плательщик','Payer'],v:x=>x.payer_text},{h:['Նպատակ','Назначение','Purpose'],v:x=>x.purpose},{h:['Գումար','Сумма','Amount'],v:x=>money(x.amount_minor,x.currency,language)},{h:['Ամսաթիվ','Дата','Date'],v:x=>dt(language,x.transaction_date)}]});
 add({key:'defects',title:['Ընթացիկ թերություններ','Текущие дефекты','Current defects'],path:'/defects',ok:(product==='os'&&['developer','manager'].includes(role)||product==='hayat'&&['manager','dispatcher'].includes(role))&&can('defects','defects.read'),to:r('defects'),toLabel:['Բոլոր թերությունները','Все дефекты','All defects'],
  pick:x=>list(x).filter(d=>!['closed','accepted','resolved'].includes(d.status)).sort((a,b)=>String(a.due_on).localeCompare(String(b.due_on))),open:()=>r('defects'),
  cols:[{h:['Թերություն','Дефект','Defect'],v:x=>x.subject??x.title},{h:['Շենք / տարածք','Здание / помещение','Building / unit'],v:x=>[x.building_name,x.number].filter(Boolean).join(' · ')},{h:['Կարգավիճակ','Статус','Status'],v:x=>x.status},{h:['Ժամկետ','Срок','Due'],v:x=>dt(language,x.due_on)}]});
 add({key:'handovers',title:['Զննումներ և հանձնում','Осмотры и передача','Inspections and handover'],path:'/handovers',ok:product==='os'&&['developer','org_admin','manager'].includes(role)&&can('handovers','handover.read'),to:'/os/handovers',toLabel:['Բացել հանձնումը','Открыть передачу','Open handovers'],
  pick:x=>list(x).flatMap(h=>{const ins=(h.inspections??[]).filter((q:Row)=>!q.completed_at).sort((a:Row,b:Row)=>String(a.scheduled_at).localeCompare(String(b.scheduled_at)))[0];return [{id:h.id,number:h.number,status:h.status,next:ins?.scheduled_at,open:(h.inspections??[]).filter((q:Row)=>!q.completed_at).length}]}),open:()=>'/os/handovers',
  cols:[{h:['Հանձնում','Передача','Handover'],v:x=>'#'+x.number},{h:['Կարգավիճակ','Статус','Status'],v:x=>x.status},{h:['Բաց զննումներ','Открытых осмотров','Open inspections'],v:x=>String(x.open)},{h:['Հաջորդ զննում','Ближайший осмотр','Next inspection'],v:x=>x.next?dt(language,x.next):''}]});
 add({key:'queue',title:['Աշխատանքների հերթ','Очередь заявок','Operational queue'],path:'/hayat/queue?status=new&limit=8',ok:product==='hayat'&&['manager','dispatcher'].includes(role)&&can('requests','requests.read'),to:'/hayat/works?status=new',toLabel:['Բոլոր հայտերը','Все заявки','All requests'],
  pick:x=>list(x),open:x=>'/hayat/works?requestId='+x.id,
  cols:[{h:['Հայտ','Заявка','Request'],v:x=>x.subject},{h:['Շենք','Здание','Building'],v:x=>x.building_name},{h:['Առաջնահերթություն','Приоритет','Priority'],v:x=>x.priority},{h:['Ստեղծվել է','Создана','Created'],v:x=>dt(language,x.created_at)}]});
 add({key:'leasetab',title:['Վարձակալություններ','Договоры аренды','Leases by end date'],path:'/leases',ok:product==='os'&&['portfolio_owner','org_admin'].includes(role)&&can('leases','leases.read'),to:'/os/leases',toLabel:['Բոլոր վարձակալությունները','Все договоры','All leases'],
  pick:x=>list(x).filter(l=>!l.cancelled_at&&new Date(l.ends_on).getTime()>=now-day).sort((a,b)=>String(a.ends_on).localeCompare(String(b.ends_on))),open:()=>'/os/leases',
  cols:[{h:['Տարածք','Помещение','Unit'],v:x=>[x.building_name,x.number].filter(Boolean).join(' · ')},{h:['Սկիզբ','Начало','Starts'],v:x=>dt(language,x.starts_on)},{h:['Ավարտ','Окончание','Ends'],v:x=>dt(language,x.ends_on)}]});
 if(!specs.length)return null;
 void currency;
 return <div className="rh-dirgrid">{specs.map(s=><Panel key={s.key+c.id} s={s} language={language}/>)}</div>;
}
