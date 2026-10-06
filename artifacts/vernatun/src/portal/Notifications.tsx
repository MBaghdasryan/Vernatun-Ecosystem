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
export default function Notifications({c,language}:{c:RoleContext;language:Language}){
 const i=language==='hy'?0:language==='ru'?1:2;const t=(k:keyof typeof S)=>S[k][i];
 const [rows,setRows]=useState<Row[]>();const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [pending,setPending]=useState<{n:Row;target:Row;to:string}>();
 const key=useRef(c.id);key.current=c.id;const busyRef=useRef(false);const seq=useRef(0);
 async function load(){const k=c.id;const n=++seq.current;try{const r=await request<Row[]>('/notifications');if(k!==key.current||n!==seq.current)return;setRows(r);setError('')}catch(e){if(k===key.current&&n===seq.current)setError(t('error')+(e instanceof ApiClientError?' ('+e.code+')':''))}}
 useEffect(()=>{busyRef.current=false;setBusy(false);seq.current++;setRows(undefined);setPending(undefined);setError('');void load()},[c.id]);
 usePolling(()=>void load(),[c.id],false);
 async function guard(fn:(live:()=>boolean)=>Promise<void>){if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');const k=c.id;const live=()=>k===key.current;try{await fn(live)}catch(e){if(live())setError(t('error')+(e instanceof ApiClientError?' ('+e.code+')':''))}finally{if(live()){busyRef.current=false;setBusy(false)}}}
 const resolve=(n:Row,target:Row)=>request<Row>('/notifications/'+n.id+'/destination?contextId='+encodeURIComponent(target.id));
 const openTarget=(n:Row,target:Row)=>void guard(async live=>{const r=await resolve(n,target);if(!live())return;if(r.requiresSwitch){setPending({n,target:{...target,targetContextId:r.targetContextId},to:r.destination});return}location.assign(r.destination)});
 const confirmSwitch=()=>{if(!pending)return;const p=pending;void guard(async live=>{if(!live())return;await request('/auth/context','POST',{id:p.target.targetContextId??p.target.id});const r=await resolve(p.n,p.target);if(!live())return;location.assign(r.destination)})};
 const mark=(n:Row)=>void guard(async live=>{await request('/notifications/'+n.id+'/read','POST',{});if(live())await load()});
 const label=(x:Row)=>[x.role_key,x.organization_name,x.building_name,x.unit_number?t('unit')+' '+x.unit_number:null].filter(Boolean).join(' · ');
 return <section className="p-card" aria-busy={busy}><header><h2>{t('title')}</h2><button className="p-button" disabled={busy} onClick={()=>void load()}>{t('refresh')}</button></header>
  {error&&<p className="p-error" role="alert">{error} <button className="p-button" onClick={()=>void load()}>{t('retry')}</button></p>}
  {!rows&&!error&&<p role="status">{t('loading')}</p>}{rows&&!rows.length&&<p>{t('empty')}</p>}
  {pending&&<div className="p-card" role="alertdialog" aria-label={t('switch')}><p>{t('confirm')}</p><p><strong>{label(pending.target)}</strong></p><button className="p-button orange" disabled={busy} onClick={confirmSwitch}>{t('yes')}</button> <button className="p-button" disabled={busy} onClick={()=>setPending(undefined)}>{t('no')}</button></div>}
  {rows?.map(n=><div className="p-message" key={n.id}><strong>{n.kind==='request_update'||!n.kind?t('newUpdate'):n.kind}</strong><p>{date(n.created_at,language)}</p>
   {n.access_denied?<p className="p-error">{t('denied')}</p>:<div className="p-modal-actions">{(n.targets??[]).map((x:Row)=><button key={x.id} className="p-button" disabled={busy} onClick={()=>openTarget(n,x)}>{t('open')} {label(x)}</button>)}</div>}
   {!n.read_at&&<button className="p-button" disabled={busy} onClick={()=>mark(n)}>{t('read')}</button>}</div>)}</section>}
