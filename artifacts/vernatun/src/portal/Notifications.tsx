import {useEffect,useRef,useState} from 'react';
import {request,ApiClientError} from './client';
import {usePolling} from './Phase2';
import {date,type Language} from './i18n';
import type {RoleContext} from './types';
type Row=Record<string,any>;
const S={
 title:['Ծանուցումներ','Уведомления','Notifications'],loading:['Բեռնվում է…','Загрузка…','Loading…'],empty:['Ծանուցումներ չկան','Уведомлений нет','No notifications'],
 refresh:['Թարմացնել','Обновить','Refresh'],retry:['Կրկնել','Повторить','Retry'],error:['Չհաջողվեց բեռնել կամ կատարել գործողությունը։','Не удалось загрузить или выполнить действие.','Could not load or complete the action.'],
 read:['Նշել որպես կարդացված','Отметить прочитанным','Mark as read'],open:['Բացել՝','Открыть:','Open as:'],denied:['Մուտքն արգելված է','Доступ запрещён','Access denied'],
 switch:['Անցնել այլ դերի','Переключить роль','Switch role'],confirm:['Այս ծանուցումը վերաբերում է մեկ այլ դերի։ Անցնե՞լ դրան։ Իրավունքները չեն միավորվում․ գործում է միայն ընտրված դերը։','Уведомление относится к другой роли. Переключиться? Права не объединяются: действует только выбранная роль.','This notification belongs to another role. Switch to it? Permissions are never merged; only the selected role applies.'],
 yes:['Անցնել և բացել','Переключить и открыть','Switch and open'],no:['Չեղարկել','Отмена','Cancel'],
 newUpdate:['Հայտի թարմացում','Обновление заявки','Request update'],unit:['բն.','пом.','unit']} as const;
const events:Record<string,[string,string,string]>={
 request_created:['Создана заявка','Request created','Հայտը ստեղծված է'],request_assigned:['Заявка назначена','Request assigned','Հայտը նշանակված է'],visit_proposed:['Предложен визит','Visit proposed','Այցն առաջարկված է'],visit_changed:['Визит изменён','Visit changed','Այցը փոփոխված է'],technician_started:['Работы начаты','Work started','Աշխատանքները սկսված են'],technician_completed:['Работы выполнены','Work completed','Աշխատանքները կատարված են'],manager_verified:['Работы приняты управляющим','Work verified by manager','Աշխատանքն ընդունված է կառավարչի կողմից'],resident_action_required:['Требуется действие жителя','Resident action required','Պահանջվում է բնակչի գործողությունը'],new_charge:['Новое начисление','New charge','Նոր հաշվեգրում'],payment_received:['Платёж получен','Payment received','Վճարումն ստացված է'],payment_unmatched:['Платёж не сопоставлен','Unmatched payment','Վճարումը չի համադրվել'],meeting_created:['Создано собрание','Meeting created','Ժողովը ստեղծված է'],voting_started:['Голосование началось','Voting started','Քվեարկությունը սկսվել է'],voting_ending:['Голосование заканчивается','Voting ending','Քվեարկությունն ավարտվում է'],announcement_published:['Новое объявление','New announcement','Նոր հայտարարություն'],pass_expiring:['Срок пропуска истекает','Pass expiring','Անցագրի ժամկետը լրանում է'],lease_expiring:['Срок аренды истекает','Lease expiring','Վարձակալության ժամկետը լրանում է'],support_case_updated:['Обращение обновлено','Support case updated','Դիմումը թարմացված է'],onboarding_task_due:['Подходит срок задачи внедрения','Onboarding task due','Մոտենում է ներդրման առաջադրանքի ժամկետը'],SLA_warning:['Срок SLA приближается','SLA deadline approaching','Մոտենում է SLA ժամկետը'],SLA_breached:['Срок SLA нарушен','SLA breached','SLA ժամկետը խախտված է'],account_security:['Безопасность аккаунта','Account security','Հաշվի անվտանգություն'],legacy_request_event:['Обновление заявки','Request update','Հայտի թարմացում']};
const viewingEvents:Record<string,[string,string,string]>={
 viewing_requested:['Դիտման նոր հարցում','Новый запрос на просмотр','New viewing request'],
 viewing_confirmed:['Դիտումը հաստատվեց','Просмотр подтверждён','Viewing confirmed'],
 viewing_declined:['Դիտումը մերժվեց','Просмотр отклонён','Viewing declined'],
 viewing_cancelled:['Դիտումը չեղարկվեց','Просмотр отменён','Viewing cancelled'],
 payer_responsibility_pending:['Ստացվել է վճարողի պատասխանատվության առաջարկ','Получено предложение об ответственности плательщика','Payer responsibility proposed'],
 payer_responsibility_accepted:['Ընդունվել է վճարողի պատասխանատվության առաջարկը','Предложение об ответственности плательщика принято','Payer responsibility accepted'],
 payer_responsibility_declined:['Մերժվել է վճարողի պատասխանատվության առաջարկը','Предложение об ответственности плательщика отклонено','Payer responsibility declined'],
 payer_responsibility_revoked:['Հետ է կանչվել վճարողի պատասխանատվությունը','Ответственность плательщика отозвана','Payer responsibility revoked'],
};
export function eventLabel(code:string,cat:Row|undefined,language:Language){
 const known=(cat?.events??[]).find((e:Row)=>e.code===code);
 const label=viewingEvents[code]?.[language==='hy'?0:language==='ru'?1:2]??events[code]?.[language==='ru'?0:language==='en'?1:2]??code;
 return known?.critical?label+(language==='hy'?' (կարևոր)':language==='ru'?' (важное)':' (critical)'):label;
}
export default function Notifications({c,language}:{c:RoleContext;language:Language}){
 const i=language==='hy'?0:language==='ru'?1:2;const t=(k:keyof typeof S)=>S[k][i];
 const [rows,setRows]=useState<Row[]>();const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [pending,setPending]=useState<{n:Row;target:Row;to:string}>();
 const [cat,setCat]=useState<Row>();const key=useRef(c.id);key.current=c.id;const busyRef=useRef(false);const seq=useRef(0);
 async function load(){const k=c.id;const n=++seq.current;try{const r=await request<Row[]>('/notifications');request<Row>('/notifications/catalog').then(x=>{if(k===key.current)setCat(x)}).catch(()=>{});if(k!==key.current||n!==seq.current)return;setRows(r);setError('')}catch(e){if(k===key.current&&n===seq.current)setError(t('error')+(e instanceof ApiClientError?' ('+e.code+')':''))}}
 useEffect(()=>{busyRef.current=false;setBusy(false);seq.current++;setRows(undefined);setPending(undefined);setError('');void load()},[c.id]);
 usePolling(()=>void load(),[c.id],false);
 async function guard(fn:(live:()=>boolean)=>Promise<void>){if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');const k=c.id;const live=()=>k===key.current;try{await fn(live)}catch(e){if(live())setError(t('error')+(e instanceof ApiClientError?' ('+e.code+')':''))}finally{if(live()){busyRef.current=false;setBusy(false)}}}
 const resolve=(n:Row,target:Row)=>request<Row>('/notifications/'+n.id+'/destination?contextId='+encodeURIComponent(target.id));
  async function markRead(n:Row,live:()=>boolean){const r=await request<Row>('/notifications/'+n.id+'/read','POST',{});if(!live())return;setRows(current=>current?.map(row=>row.id===n.id?{...row,read_at:r.read_at??row.read_at??new Date().toISOString()}:row));window.dispatchEvent(new CustomEvent('vernatun-notifications-changed',{detail:{broadcast:true}}))}
  async function markBeforeOpen(n:Row,target:Row,live:()=>boolean){try{await markRead(n,live)}catch(e){if(e instanceof ApiClientError&&(e.status===401||e.status===403))await resolve(n,target)}}
  const openTarget=(n:Row,target:Row)=>void guard(async live=>{const r=await resolve(n,target);if(!live())return;if(r.requiresSwitch){setPending({n,target:{...target,targetContextId:r.targetContextId},to:r.destination});return}if(!n.read_at)await markBeforeOpen(n,target,live);if(live())location.assign(r.destination)});
  const confirmSwitch=()=>{if(!pending)return;const p=pending;void guard(async live=>{if(!live())return;await request('/auth/context','POST',{id:p.target.targetContextId??p.target.id});const r=await resolve(p.n,p.target);if(!live())return;if(!p.n.read_at)await markBeforeOpen(p.n,p.target,live);if(live())location.assign(r.destination)})};
  const mark=(n:Row)=>void guard(async live=>{await markRead(n,live)});
 const label=(x:Row)=>[x.role_key,x.organization_name,x.building_name,x.unit_number?t('unit')+' '+x.unit_number:null].filter(Boolean).join(' · ');
 return <section className="p-card" aria-busy={busy}><header><h2>{t('title')}</h2><button className="p-button" disabled={busy} onClick={()=>void load()}>{t('refresh')}</button></header>
  {error&&<p className="p-error" role="alert">{error} <button className="p-button" onClick={()=>void load()}>{t('retry')}</button></p>}
  {!rows&&!error&&<p role="status">{t('loading')}</p>}{rows&&!rows.length&&<p>{t('empty')}</p>}
  {pending&&<div className="p-card" role="alertdialog" aria-label={t('switch')}><p>{t('confirm')}</p><p><strong>{label(pending.target)}</strong></p><button className="p-button orange" disabled={busy} onClick={confirmSwitch}>{t('yes')}</button> <button className="p-button" disabled={busy} onClick={()=>setPending(undefined)}>{t('no')}</button></div>}
  {rows?.map(n=><div className="p-message" key={n.id}><strong>{n.manual_batch_id?n.custom_title:(n.kind==='request_update'||(!n.kind&&!n.event_code)?t('newUpdate'):eventLabel(n.event_code??n.kind,cat,language))}</strong><p>{date(n.created_at,language)}</p>
   {n.manual_batch_id&&n.custom_body&&<p>{n.custom_body}</p>}
   {!n.manual_batch_id&&(n.access_denied?<p className="p-error">{t('denied')}</p>:<div className="p-modal-actions">{(n.targets??[]).map((x:Row)=><button key={x.id} className="p-button" disabled={busy} onClick={()=>openTarget(n,x)}>{t('open')} {label(x)}</button>)}</div>)}
   {!n.read_at&&<button className="p-button" disabled={busy} onClick={()=>mark(n)}>{t('read')}</button>}</div>)}</section>}
