import {useEffect,useMemo,useState} from 'react';
import {AlertTriangle,ArrowRight,CalendarDays,CircleSlash,ClipboardCheck,RefreshCw} from 'lucide-react';
import {request} from './client';
import {getRoleInsights,type RoleInsightCard} from '@workspace/api-client-react';
import {money,type Currency,type Language} from './i18n';
import {insightStrings} from './Insights';
import {viewModules,viewRoute,type Product} from '../../shared/products';
import type {RoleContext} from './types';
import RoleOverviewPanels from './RoleOverviewPanels';
import './rolehome.css';

// Role-specific home composition. Every number and row comes from an existing
// API; shortcuts are hidden when the permission or module gate is missing.
type L3=readonly [string,string,string];
type Row=Record<string,any>;
type Item={id:string;title:string;meta?:string;when?:string;path:string;tone?:'urgent'|'warn'|'info'};
type Feed={key:string;title:L3;path:string;ok:boolean;complete:boolean;map:(r:any)=>Item[];total?:(r:any)=>number|undefined;calendar?:boolean;banner?:boolean};
type Result={items:Item[];total?:number}|'error';
type Shortcut={label:L3;path:string;ok:boolean};

const S={
 attention:['Ուշադրություն','Требует внимания','Needs attention'],calendar:['Մոտակա ժամկետներ','Ближайшие сроки','Upcoming dates'],
 quick:['Արագ գործողություններ','Быстрые действия','Quick actions'],unavailable:['Միացված չէ','Не подключено','Not configured'],
 empty:['Բաց կետեր չկան','Открытых пунктов нет','Nothing open'],error:['Չհաջողվեց բեռնել','Не удалось загрузить','Could not load'],
 retry:['Կրկնել','Повторить','Retry'],loading:['Բեռնվում է','Загрузка','Loading'],open:['Բացել','Открыть','Open'],
 emergency:['Ակտիվ միջադեպ','Активный инцидент','Active incident'],emergencyHint:['Փակել բանները միջադեպը չի փակում','Скрытие баннера не закрывает инцидент','Hiding the banner does not close the incident'],hide:['Թաքցնել','Скрыть','Hide'],
 kpiNote:['Ցուցանիշները հաշվվում են ընթացիկ համատեքստում','Показатели считаются в текущем контексте','Figures are calculated for the current context'],
 supportOpen:['Բաց դիմումներ','Открытые обращения','Open support cases'],supportMine:['Իմ դիմումները','Мои обращения','My support cases'],
 onboarding:['Ներդրման բաց քայլեր','Незавершённые этапы внедрения','Open onboarding steps'],invites:['Սպասող հրավերներ','Ожидающие приглашения','Pending invitations'],
 unmatched:['Չհամընկնող բանկային տողեր','Несопоставленные банковские строки','Unmatched bank rows'],expenses:['Ծախսեր հաստատման','Расходы на согласовании','Expenses awaiting approval'],
 leases:['Ավարտվող վարձակալություններ (90 օր)','Истекающие договоры аренды (90 дней)','Leases ending (90 days)'],inspections:['Պլանավորված զննումներ','Запланированные осмотры','Scheduled inspections'],
 warranties:['Ավարտվող երաշխիքներ (90 օր)','Истекающие гарантии (90 дней)','Warranties ending (90 days)'],incidents:['Ակտիվ միջադեպեր','Активные инциденты','Active incidents'],
 review:['Ակտեր ընդունման','Акты на приёмке','Acts awaiting acceptance'],unassigned:['Նոր հայտեր','Новые заявки','New requests'],
 meetings:['Մոտակա ժողովներ','Ближайшие собрания','Upcoming meetings'],news:['Վերջին հայտարարություններ','Последние объявления','Latest announcements'],
 residentReview:['Ստուգեք արդյունքը','Проверьте результат работ','Check work result'],lease:['Վարձակալության ավարտ','Окончание аренды','Lease ends'],
 draft:['Սևագիր','Черновик','Draft'],preview:['նախադիտում','превью','preview'],periodAll:['Բոլոր ժամանակաշրջանները','Все периоды','All periods'],period:['Ֆինանսական ամիս','Финансовый месяц','Finance month'],financeNote:['Ֆինանսական քարտեր','Финансовые карточки','Finance cards'],currentState:['ընթացիկ վիճակ','текущее состояние','current state'],noData:['Տվյալներ չկան','Нет данных','No data'],calError:['Ժամկետների մի մասը չբեռնվեց','Часть сроков не загрузилась','Some dates failed to load'],
 myWork:['Իմ ակտիվ աշխատանքները','Мои активные работы','My active work'],defectsReview:['Վերադարձված / ստուգման','На проверке','Under review'],
} as const;

const Q={
 orgs:['Կազմակերպություններ','Организации','Organizations'],subs:['Բաժանորդագրություններ','Подписки','Subscriptions'],onb:['Ներդրում','Внедрение','Onboarding'],
 cases:['Դիմումներ','Обращения','Support cases'],audit:['Աուդիտ','Аудит','Audit'],email:['Էլ. փոստ','Почта','Email'],users:['Օգտատերեր','Пользователи','Users'],
 access:['Ժամանակավոր հասանելիություն','Временный доступ','Temporary access'],imports:['Ներմուծում','Импорт','Imports'],
 props:['Շենքեր','Здания','Buildings'],people:['Աշխատակիցներ','Сотрудники','Employees'],invite:['Հրավերներ','Приглашения','Invitations'],modules:['Մոդուլներ','Модули','Modules'],roles:['Դերեր','Роли','Roles'],settings:['Կարգավորումներ','Настройки','Settings'],
 finance:['Հաշվարկներ','Начисления (пакеты)','Billing batches'],bank:['Բանկային համադրում','Банковская сверка','Bank reconciliation'],credits:['Կրեդիտներ','Кредиты','Credits'],invoices:['Հաշիվներ','Счета','Invoices'],budgets:['Բյուջեներ','Бюджеты','Budgets'],expensesQ:['Ծախսեր','Расходы','Expenses'],
 analytics:['Վերլուծություն','Аналитика','Analytics'],leasesQ:['Վարձակալություն','Аренда','Leases'],handovers:['Հանձնում և զննումներ','Передача и осмотры','Handover & inspections'],defects:['Թերություններ','Дефекты','Defects'],units:['Տարածքներ','Помещения','Units'],
 works:['Հայտեր','Заявки','Requests'],newReq:['Նոր հայտեր','Новые заявки','New requests'],reviewQ:['Ընդունում','Приёмка','Acceptance'],assets:['Սարքավորումներ','Оборудование','Equipment'],meters:['Հաշվիչներ','Счётчики','Meters'],
 ann:['Հայտարարություններ','Объявления','Announcements'],meet:['Ժողովներ','Собрания','Meetings'],inc:['Միջադեպեր','Инциденты','Incidents'],docs:['Փաստաթղթեր','Документы','Documents'],
 inProgress:['Ընթացքում','В работе','In progress'],assigned:['Նշանակված','Назначенные','Assigned'],events:['Իրադարձություններ','События','Events'],
 pay:['Հաշիվներ և վճարումներ','Счета и платежи','Charges & payments'],request:['Հայտ','Заявка','Request'],passes:['Անցագրեր','Пропуска','Passes'],family:['Ընտանիք','Семья','Family'],own:['Սեփականություն','Собственность','Ownership'],
} as const;

const U:Record<string,L3[]>={
 platform_admin:[['SaaS բիլինգը միացված չէ. եկամտի գրաֆիկ չի ցուցադրվում','Платформенный биллинг не подключён — график выручки SaaS не показывается','Platform billing is not configured — no SaaS revenue chart is shown']],
 support:[['Հանդիպումների պլանավորումը դեռ հասանելի չէ','Планирование встреч пока недоступно','Meeting scheduling is not yet available']],
 org_admin:[['Բանկ, SMS և հեռախոսակապ միացված չեն','Банк, SMS и телефония не подключены','Bank, SMS and telephony providers are not connected']],
 accountant:[['Բանկային ինտեգրացիա չկա. քաղվածքները ներմուծվում են ձեռքով','Банковская интеграция не подключена — выписки импортируются вручную','No bank integration — statements are imported manually']],
 dispatcher:[['Քարտեզը հասանելի չէ. աշխատանքների գեոտվյալներ չկան','Карта недоступна — нет геоданных работ','Map is unavailable — no work geodata']],
 portfolio_owner:[['Սպասարկման և ընդհանուր փաստաթղթերի մուտքը այս դերում տրված չէ','Общее обслуживание и документы этой роли не выданы','General service and documents are not granted to this role']],
 unit_owner:[['Առցանց վճարման դարպաս միացված չէ','Онлайн-оплата не подключена','Online payment gateway is not connected']],
 renter:[['Առցանց վճարման դարպաս միացված չէ','Онлайн-оплата не подключена','Online payment gateway is not connected']],
 family:[['Դռան ֆիզիկական բացումը միացված չէ','Физическое открытие двери не подключено','Physical door opening is not connected']],
};

// Insight key → destination per product. Only listed keys become links.
// Insight key -> destination per product, each with the permission the destination view requires.
// assignedWork/openDefects span several statuses, so they open the unfiltered list.
const kpiLink:Record<string,Partial<Record<Product,[string,string]>>>={organizations:{console:['/console/organizations','organizations.read']},buildings:{console:['/console/organizations','organizations.read'],os:['/os/properties','properties.read']},activeSubscriptions:{console:['/console/subscriptions','subscriptions.manage']},openSupport:{console:['/console/support-cases','support.cases']},onboardingRemaining:{console:['/console/onboarding','onboarding.manage']},activeGrants:{console:['/console/support','support.access.request']},team:{os:['/os/people','people.read']},units:{os:['/os/units','properties.read']},pendingInvites:{os:['/os/invitations','people.invite']},openRequests:{hayat:['/hayat/works','requests.read']},assignedWork:{hayat:['/hayat/works','workorders.assigned']},openDefects:{os:['/os/defects','defects.read'],hayat:['/hayat/works','defects.assigned']},reviewDefects:{os:['/os/defects','defects.read'],hayat:['/hayat/works?status=review','defects.assigned']},handoverReady:{os:['/os/handovers','handover.read']},validPasses:{hayat:['/hayat/security','access.validate']},charged:{os:['/os/finance','billing.read']},paid:{os:['/os/finance','billing.read']},balance:{os:['/os/finance','billing.read']}};
const financial=new Set(['charged','paid','balance']);

export function goTo(path:string){history.pushState(null,'',path);window.dispatchEvent(new PopStateEvent('popstate'));window.scrollTo({top:0})}
const list=(r:any):Row[]=>Array.isArray(r)?r:Array.isArray(r?.rows)?r.rows:Array.isArray(r?.items)?r.items:[];
const day=86400000;

export default function RoleHome({c,language,currency,product,kpis=true}:{c:RoleContext;language:Language;currency:Currency;product:Product;kpis?:boolean}){
 const i=language==='hy'?0:language==='ru'?1:2,tr=(x:L3)=>x[i];
 const role=c.role_key,p=(x:string)=>c.permissions.includes(x),mod=(view:string)=>!c.modules||!viewModules[view]||c.modules.includes(viewModules[view]);
 const can=(view:string,...perms:string[])=>mod(view)&&perms.some(p);
 const hayat=(v:string,q='')=>'/hayat/'+v+q,os=(v:string)=>'/os/'+v,con=(v:string)=>'/console/'+v,im=(v:string,q='')=>viewRoute('imtun',v,role)+q;
 const fmt=(d?:string)=>d?new Intl.DateTimeFormat(language,{timeZone:'Asia/Yerevan',day:'numeric',month:'short',...(/^\d{4}-\d{2}-\d{2}$/.test(d)?{}:{hour:'2-digit',minute:'2-digit'})}).format(new Date(d)):undefined;
 const now=Date.now(),soon=(d?:string,days=90)=>!!d&&new Date(d).getTime()>=now-day&&new Date(d).getTime()<=now+days*day;
 const platform=!c.organization_id,orgWide=!c.building_id&&!c.unit_id;
 // Contracts verified against archive/vernatun/server routers (all mounted under /api).
 // complete=false: endpoint returns a page/limit, so the count is a preview, not a total.
 const feeds:Feed[]=useMemo(()=>{const f:Feed[]=[];const add=(x:Feed)=>{if(x.ok)f.push(x)};
  // support-conversation.ts: array, LIMIT 50; fields subject, organization_name, priority, status(open|in_progress|resolved), sla_due_at
  add({key:'supportOpen',title:role==='support'?S.supportMine:S.supportOpen,path:'/platform/support-cases'+(role==='support'?'?queue=mine':''),complete:false,ok:platform&&p('support.cases'),map:r=>list(r).filter(x=>x.status!=='resolved').map(x=>({id:x.id,title:x.subject,meta:[x.organization_name,x.priority].filter(Boolean).join(' · '),when:x.sla_due_at,tone:x.sla_due_at&&new Date(x.sla_due_at).getTime()<now?'urgent':'warn',path:con('support-cases')}))});
  // onboarding-workflow.ts: array (all / assigned); status pending|in_progress|completed; due_on date
  add({key:'onboarding',title:S.onboarding,path:'/platform/onboarding',complete:true,ok:platform&&p('onboarding.manage'),calendar:true,map:r=>list(r).filter(x=>x.status!=='completed').map(x=>({id:x.id,title:x.title,meta:[x.organization_name,x.assignee_name].filter(Boolean).join(' · '),when:x.due_on,tone:new Date(x.due_on).getTime()<now-day?'urgent':'info',path:con('onboarding')}))});
  // platform-foundation.ts (mounted before api.ts): array with computed status revoked|accepted|expired|pending
  add({key:'invites',title:S.invites,path:'/invitations',complete:true,ok:!platform&&p('people.invite'),map:r=>list(r).filter(x=>x.status==='pending').map(x=>({id:x.id,title:x.email,when:x.expires_at,tone:'info',path:os('invitations')}))});
  // bank-reconciliation.ts: array, org-wide only (orgFinance), status filter, limit; fields payer_text, purpose, transaction_date, amount_minor, currency
  add({key:'unmatched',title:S.unmatched,path:'/finance/bank/transactions?status=unmatched&limit=5',complete:false,ok:product==='os'&&orgWide&&can('finance','payments.reconcile'),map:r=>list(r).map(x=>({id:x.id,title:x.payer_text,meta:[money(x.amount_minor,x.currency,language),x.purpose].join(' · '),when:x.transaction_date,tone:'warn',path:os('finance?tab=bank')}))});
  // services.ts: GET needs expenses.read, filtered by currency; pending = approved_at null
  add({key:'expenses',title:S.expenses,path:'/expenses?currency='+currency,complete:true,ok:product==='os'&&can('expenses','expenses.read')&&p('expenses.approve'),map:r=>list(r).filter(x=>!x.approved_at).map(x=>({id:x.id,title:x.description,meta:[x.building_name,money(x.amount_minor,x.currency,language)].join(' · '),tone:'warn',path:os('expenses')}))});
  // lifecycle.ts: array ordered by ends_on; cancelled_at marks cancelled leases
  add({key:'leases',title:S.leases,path:'/leases',complete:true,ok:product==='os'&&can('leases','leases.read'),calendar:true,map:r=>list(r).filter(x=>!x.cancelled_at&&soon(x.ends_on)).map(x=>({id:x.id,title:[x.building_name,x.number].filter(Boolean).join(' · '),when:x.ends_on,tone:'info',path:os('leases')}))});
  // lifecycle.ts: handovers with inspections[scheduled_at,completed_at] and warranties[description,ends_on]
  if(product==='os'&&can('handovers','handover.read')){add({key:'inspections',title:S.inspections,path:'/handovers',complete:true,ok:true,calendar:true,map:r=>list(r).flatMap(h=>(h.inspections??[]).filter((x:Row)=>!x.completed_at&&new Date(x.scheduled_at).getTime()>=now-day).map((x:Row)=>({id:x.id,title:'#'+h.number,when:x.scheduled_at,tone:'info' as const,path:os('handovers')})))});add({key:'warranties',title:S.warranties,path:'/handovers',complete:true,ok:true,calendar:true,map:r=>list(r).flatMap(h=>(h.warranties??[]).filter((x:Row)=>soon(x.ends_on)).map((x:Row)=>({id:x.id,title:x.description,meta:'#'+h.number,when:x.ends_on,tone:'warn' as const,path:os('handovers')})))})}
  // operation-incidents.ts: needs incidents.read; status open|investigating|resolved|closed; severity low|normal|high|critical
  add({key:'incidents',title:S.incidents,path:'/incidents',complete:true,ok:product==='hayat'&&['manager','dispatcher','security'].includes(role)&&can('incidents','incidents.read'),banner:['manager','dispatcher'].includes(role),map:r=>list(r).filter(x=>['open','investigating'].includes(x.status)).map(x=>({id:x.id,title:x.description,meta:[x.building_name,x.severity].filter(Boolean).join(' · '),when:x.created_at,tone:['high','critical'].includes(x.severity)?'urgent':'warn',path:hayat('incidents')}))});
  // hayat.ts: {rows,total} with exact status filter; total is a real server count
  add({key:'review',title:S.review,path:'/hayat/queue?status=review',complete:true,ok:product==='hayat'&&role==='manager'&&can('requests','workorders.accept'),total:r=>r?.total,map:r=>list(r).map(x=>({id:x.id,title:x.subject,meta:[x.building_name,x.technician_name].filter(Boolean).join(' · '),when:x.created_at,tone:'warn',path:hayat('works','?requestId='+x.id)}))});
  add({key:'unassigned',title:S.unassigned,path:'/hayat/queue?status=new',complete:true,ok:product==='hayat'&&role==='dispatcher'&&can('requests','requests.read'),total:r=>r?.total,map:r=>list(r).map(x=>({id:x.id,title:x.subject,meta:[x.building_name,x.priority].filter(Boolean).join(' · '),when:x.created_at,tone:x.overdue?'urgent':'info',path:hayat('works','?requestId='+x.id)}))});
  // governance.ts: array, starts_at, status draft|published|cancelled|finalized
  add({key:'meetings',title:S.meetings,path:'/governance/meetings',complete:true,ok:product==='hayat'&&can('meetings','meetings.read'),calendar:true,map:r=>list(r).filter(x=>x.status!=='cancelled'&&new Date(x.starts_at).getTime()>=now).map(x=>({id:x.id,title:x.title,meta:x.building_name,when:x.starts_at,tone:'info',path:hayat('meetings')}))});
  // services.ts: array newest first; managers also receive unpublished drafts (published=false)
  add({key:'news',title:S.news,path:'/announcements',complete:true,ok:product==='hayat'&&role==='manager'&&can('announcements','announcements.read'),map:r=>list(r).map(x=>({id:x.id,title:x.title,meta:x.published?undefined:tr(S.draft),when:x.created_at,tone:x.published?'info':'warn',path:hayat('announcements')}))});
  // workflow.ts: own requests with work_status from work_orders
  add({key:'residentReview',title:S.residentReview,path:'/requests',complete:true,ok:product==='imtun'&&can('requests','requests.own'),map:r=>list(r).filter(x=>x.work_status==='resident_review').map(x=>({id:x.id,title:x.subject,meta:x.number?'#'+x.number:undefined,when:x.created_at,tone:'warn',path:im('requests','?requestId='+encodeURIComponent(x.id))}))});
  add({key:'lease',title:S.lease,path:'/leases',complete:true,ok:product==='imtun'&&role==='renter'&&!!c.unit_id&&can('leases','leases.own'),calendar:true,map:r=>list(r).filter(x=>!x.cancelled_at&&new Date(x.ends_on).getTime()>=now-day).slice(0,1).map(x=>({id:x.id,title:[x.building_name,x.number].filter(Boolean).join(' · '),when:x.ends_on,tone:soon(x.ends_on,30)?'warn':'info',path:im('leases')}))});
  return f},[c.id,currency,language]);
 const shortcuts:Shortcut[]=({
  platform_admin:[{label:Q.orgs,path:con('organizations'),ok:p('organizations.read')},{label:Q.subs,path:con('subscriptions'),ok:p('subscriptions.manage')},{label:Q.onb,path:con('onboarding'),ok:p('onboarding.manage')},{label:Q.cases,path:con('support-cases'),ok:p('support.cases')},{label:Q.users,path:con('users'),ok:p('organizations.manage')},{label:Q.audit,path:con('audit'),ok:p('platform.audit')||p('audit.read')},{label:Q.email,path:con('email'),ok:true}],
  support:[{label:Q.onb,path:con('onboarding'),ok:p('onboarding.manage')},{label:Q.cases,path:con('support-cases'),ok:p('support.cases')},{label:Q.access,path:con('support'),ok:p('support.access.request')},{label:Q.imports,path:con('imports'),ok:!platform&&(p('imports.manage')||p('imports.finance'))}],
  org_admin:[{label:Q.props,path:os('properties'),ok:p('properties.read')},{label:Q.people,path:os('people'),ok:p('people.read')},{label:Q.invite,path:os('invitations'),ok:p('people.invite')},{label:Q.roles,path:os('roles'),ok:p('roles.assign')},{label:Q.modules,path:os('modules'),ok:p('modules.read')},{label:Q.audit,path:os('audit'),ok:p('audit.read')},{label:Q.imports,path:os('imports'),ok:p('imports.manage')},{label:Q.settings,path:os('settings'),ok:true}],
  accountant:[{label:Q.finance,path:os('finance?tab=batches'),ok:can('finance','billing.read')},{label:Q.bank,path:os('finance?tab=bank'),ok:orgWide&&can('finance','payments.reconcile')},{label:Q.credits,path:os('finance?tab=credits'),ok:orgWide&&can('finance','payments.reconcile')},{label:Q.invoices,path:os('invoices'),ok:can('invoices','billing.read')},{label:Q.budgets,path:os('budgets'),ok:can('budgets','expenses.read')},{label:Q.expensesQ,path:os('expenses'),ok:can('expenses','expenses.read')},{label:Q.imports,path:os('imports'),ok:p('imports.finance')}],
  portfolio_owner:[{label:Q.analytics,path:os('analytics'),ok:can('analytics','reports.read','expenses.read')},{label:Q.expensesQ,path:os('expenses'),ok:can('expenses','expenses.read')},{label:Q.budgets,path:os('budgets'),ok:can('budgets','expenses.read')},{label:Q.leasesQ,path:os('leases'),ok:can('leases','leases.read')},{label:Q.invoices,path:os('invoices'),ok:can('invoices','billing.read')}],
  developer:[{label:Q.handovers,path:os('handovers'),ok:can('handovers','handover.read')},{label:Q.defects,path:os('defects'),ok:can('defects','defects.read')},{label:Q.units,path:os('units'),ok:p('properties.read')}],
  manager:[{label:Q.reviewQ,path:hayat('works','?status=review'),ok:can('requests','workorders.accept')},{label:Q.works,path:hayat('works'),ok:can('requests','requests.read')},{label:Q.assets,path:hayat('assets'),ok:can('assets','assets.read')},{label:Q.meters,path:hayat('meters'),ok:can('meters','meters.manage')},{label:Q.ann,path:hayat('announcements'),ok:can('announcements','announcements.read')},{label:Q.meet,path:hayat('meetings'),ok:can('meetings','meetings.read')},{label:Q.docs,path:hayat('documents'),ok:can('documents','documents.read')},{label:Q.inc,path:hayat('incidents'),ok:can('incidents','incidents.read')}],
  dispatcher:[{label:Q.newReq,path:hayat('works','?status=new'),ok:can('requests','requests.read')},{label:Q.inProgress,path:hayat('works','?status=in_progress'),ok:can('requests','requests.read')},{label:Q.works,path:hayat('works'),ok:can('requests','requests.read')},{label:Q.inc,path:hayat('incidents'),ok:can('incidents','incidents.read')}],
  technician:[{label:Q.assigned,path:hayat('works','?status=assigned'),ok:can('requests','workorders.assigned')},{label:Q.inProgress,path:hayat('works','?status=in_progress'),ok:can('requests','workorders.assigned')},{label:Q.assets,path:hayat('assets'),ok:can('assets','assets.read')}],
  contractor:[{label:Q.assigned,path:hayat('works','?status=assigned'),ok:can('defects','defects.assigned')},{label:Q.inProgress,path:hayat('works','?status=in_progress'),ok:can('defects','defects.assigned')},{label:Q.reviewQ,path:hayat('works','?status=review'),ok:can('defects','defects.assigned')}],
  security:[{label:Q.events,path:hayat('events'),ok:true},{label:Q.inc,path:hayat('incidents'),ok:can('incidents','incidents.read','incidents.create')}],
 } as Record<string,Shortcut[]>)[role]?.filter(s=>s.ok)??[];
 const [cards,setCards]=useState<RoleInsightCard[]>(),[kpiError,setKpiError]=useState(false),[period,setPeriod]=useState('');
 const [res,setRes]=useState<Record<string,Result>>({}),[rev,setRev]=useState(0),[hidden,setHidden]=useState(false);
 const months=useMemo(()=>{const d=new Date(),out:string[]=[];for(let k=0;k<24;k++){const x=new Date(d.getFullYear(),d.getMonth()-k,1);out.push(x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0'))}return out},[]);
 // Generated client (same-origin cookie session; GET needs no CSRF). period filters finance cards only.
 useEffect(()=>{if(!kpis)return;let live=true;setCards(undefined);setKpiError(false);getRoleInsights({currency,...(period?{period}:{})}).then(r=>{if(live)setCards(r.cards)}).catch(()=>{if(live)setKpiError(true)});return()=>{live=false}},[c.id,currency,period,rev,kpis]);
 useEffect(()=>{let live=true;setRes({});const cache=new Map<string,Promise<any>>();feeds.forEach(f=>{if(!cache.has(f.path))cache.set(f.path,request<any>(f.path));cache.get(f.path)!.then(r=>{if(live)setRes(x=>({...x,[f.key]:{items:f.map(r),total:f.total?.(r)}}))}).catch(()=>{if(live)setRes(x=>({...x,[f.key]:'error'}))})});return()=>{live=false}},[feeds,rev]);
 const ok=(r?:Result):r is {items:Item[];total?:number}=>!!r&&r!=='error';
 const calFeeds=feeds.filter(f=>f.calendar),calFailed=calFeeds.some(f=>res[f.key]==='error'),calLoading=calFeeds.some(f=>!res[f.key]);
 const dated=calFeeds.flatMap(f=>{const r=res[f.key];return ok(r)?r.items.filter(x=>x.when).map(x=>({...x,group:tr(f.title)})):[]}).sort((a,b)=>new Date(a.when!).getTime()-new Date(b.when!).getTime()).slice(0,8);
 const banner=feeds.filter(f=>f.banner).flatMap(f=>{const r=res[f.key];return ok(r)?r.items.filter(x=>x.tone==='urgent'):[]});
 const attention=feeds.filter(f=>!f.calendar||f.key==='onboarding');
 const countLabel=(f:Feed,r:Result|undefined)=>!ok(r)?'—':r.total!=null?String(r.total):f.complete?String(r.items.length):r.items.length+' · '+tr(S.preview);
 const notes=U[role]??[];
 const hasFinance=!!cards?.some(m=>financial.has(m.key));
 if(!kpis&&!feeds.length&&!shortcuts.length&&!notes.length)return null;
 return <section className={'rh rh-'+product} aria-label={tr(S.attention)}>
  {banner.length>0&&!hidden&&<div className="rh-banner" role="alert"><AlertTriangle size={22}/><div><strong>{tr(S.emergency)}: {banner.length}</strong><p>{banner[0].title}</p><small>{tr(S.emergencyHint)}</small></div><button className="rh-btn" onClick={()=>goTo(banner[0].path)}>{tr(S.open)}<ArrowRight size={16}/></button><button className="rh-link" onClick={()=>setHidden(true)}>{tr(S.hide)}</button></div>}
  {kpis&&hasFinance&&<label className="rh-period">{tr(S.period)}<select value={period} onChange={e=>setPeriod(e.target.value)}><option value="">{tr(S.periodAll)}</option>{months.map(m=><option key={m} value={m}>{new Intl.DateTimeFormat(language,{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(m+'-01T00:00:00Z'))}</option>)}</select></label>}
  {kpis&&<div className="rh-kpis">{kpiError?<p className="rh-state">{tr(S.error)} <button className="rh-link" onClick={()=>setRev(v=>v+1)}><RefreshCw size={14}/>{tr(S.retry)}</button></p>:!cards?Array.from({length:4},(_,n)=><div className="rh-kpi rh-skel" key={n}/>):cards.map(m=>{const link=kpiLink[m.key]?.[product];const to=link&&p(link[1])?link[0]:undefined;const label=(insightStrings as Record<string,L3>)[m.key]?.[i]??m.key;const fin=financial.has(m.key);const value=m.dataState==='no_data'?tr(S.noData):m.currency?money(m.value,m.currency as Currency,language):m.value;const body=<><span title={m.definition} aria-label={`${label}: ${m.definition}`}>{label}</span><strong>{value}</strong><small>{fin?(m.dataState==='no_data'?'':(period?period:tr(S.periodAll))):tr(S.currentState)}</small>{to&&<ArrowRight size={15}/>}</>;return to?<button key={m.key} className="rh-kpi" onClick={()=>goTo(to)}>{body}</button>:<div key={m.key} className="rh-kpi">{body}</div>})}</div>}
  {kpis&&cards&&<p className="rh-foot">{tr(S.kpiNote)}</p>}
  <div className="rh-grid">
   {attention.length>0&&<div className="rh-panel rh-attention"><h2><ClipboardCheck size={19}/>{tr(S.attention)}</h2>{attention.map(f=>{const r=res[f.key];return <div className="rh-group" key={f.key}><h3>{tr(f.title)}<b>{countLabel(f,r)}</b></h3>{r==='error'?<p className="rh-state">{tr(S.error)} <button className="rh-link" onClick={()=>setRev(v=>v+1)}>{tr(S.retry)}</button></p>:!r?<div className="rh-row rh-skel"/>:!r.items.length?<p className="rh-state">{tr(S.empty)}</p>:r.items.slice(0,4).map(x=><button key={x.id} className={'rh-row tone-'+(x.tone??'info')} onClick={()=>goTo(x.path)}><i aria-hidden="true"/><span><strong>{x.title}</strong>{x.meta&&<small>{x.meta}</small>}</span>{x.when&&<time>{fmt(x.when)}</time>}<ArrowRight size={15}/></button>)}</div>})}</div>}
   {feeds.some(f=>f.calendar)&&<div className="rh-panel"><h2><CalendarDays size={19}/>{tr(S.calendar)}</h2>{calFailed&&<p className="rh-state">{tr(S.calError)} <button className="rh-link" onClick={()=>setRev(v=>v+1)}><RefreshCw size={14}/>{tr(S.retry)}</button></p>}{!dated.length?(calLoading?<div className="rh-row rh-skel"/>:!calFailed&&<p className="rh-state">{tr(S.empty)}</p>):<ol className="rh-cal">{dated.map(x=><li key={x.group+x.id}><button onClick={()=>goTo(x.path)}><time>{fmt(x.when)}</time><span><strong>{x.title}</strong><small>{x.group}{x.meta?' · '+x.meta:''}</small></span></button></li>)}</ol>}</div>}
   {(shortcuts.length>0||notes.length>0)&&<div className="rh-panel">{shortcuts.length>0&&<><h2><ArrowRight size={19}/>{tr(S.quick)}</h2><div className="rh-quick">{shortcuts.map(s=><button key={s.path} onClick={()=>goTo(s.path)}>{tr(s.label)}<ArrowRight size={15}/></button>)}</div></>}{notes.length>0&&<div className="rh-unavailable"><h3><CircleSlash size={16}/>{tr(S.unavailable)}</h3>{notes.map(n=><p key={n[2]}>{tr(n)}</p>)}</div>}</div>}
  </div>
  <RoleOverviewPanels c={c} language={language} currency={currency} product={product}/>
 </section>;
}
