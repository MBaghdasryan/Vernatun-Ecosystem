import {useEffect,useId,useRef,useState} from 'react';
import {Bell,Search,X} from 'lucide-react';
import {request} from './client';
import Notifications from './Notifications';
import type {RoleContext} from './types';
import type {Language} from './i18n';
import {viewRoute,type Product} from '../../shared/products';
import './workspace-header.css';

type SearchItem={id:string;title:string;description:string};
type SearchGroup={kind:string;items:SearchItem[];hasMore:boolean};
type SearchResult={contextId:string;groups:SearchGroup[]};
const words={
 search:['Որոնում','Поиск','Search'],hint:['Մուտքագրեք առնվազն 2 նիշ','Введите не менее 2 символов','Enter at least 2 characters'],
 empty:['Արդյունքներ չկան ընտրված դերում','В выбранном контексте ничего не найдено','No results in this context'],
 failed:['Չհաջողվեց բեռնել։ Փորձեք կրկին։','Не удалось загрузить. Повторите поиск.','Could not load. Try the search again.'],
 loading:['Որոնվում է…','Поиск…','Searching…'],notifications:['Ծանուցումներ','Уведомления','Notifications'],
 close:['Փակել','Закрыть','Close'],open:['Բացել բաժինը','Открыть раздел','Open section'],
 more:['Կան այլ արդյունքներ. ճշտեք որոնումը կամ բացեք բաժինը։','Есть другие результаты: уточните поиск или откройте раздел.','More results: refine the search or open the section.'],
 organizations:['Կազմակերպություններ','Организации','Organizations'],properties:['Շենքեր','Здания','Buildings'],
 units:['Տարածքներ','Помещения','Units'],people:['Աշխատակիցներ','Сотрудники','Employees'],requests:['Հայտեր','Заявки','Requests'],
 workorders:['Իմ աշխատանքները','Мои работы','My work'],defects:['Թերություններ','Дефекты','Defects'],invoices:['Հաշվարկներ','Начисления','Invoices'],
 documents:['Փաստաթղթեր','Документы','Documents'],support:['Աջակցություն','Поддержка','Support']
} as const;
export default function WorkspaceHeaderTools({c,language,product}:{c:RoleContext;language:Language;product:Product}){
 const i=language==='hy'?0:language==='ru'?1:2;
 const text=(k:keyof typeof words)=>words[k][i];
 const searchDialog=useRef<HTMLDialogElement>(null),notificationDialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null);
 const focusBefore=useRef<HTMLElement|null>(null);
 const titleId=useId(),notificationTitle=useId();
 const [mode,setMode]=useState<'search'|'notifications'>(),[query,setQuery]=useState(''),[result,setResult]=useState<SearchResult>();
 const [state,setState]=useState<'idle'|'loading'|'loaded'|'failed'>('idle'),[unread,setUnread]=useState<number>();
 const liveContext=useRef(c.id);liveContext.current=c.id;
 useEffect(()=>{
  let active=true;
  const refresh=()=>{const contextId=c.id;void request<{unread:number}>('/notifications/unread-count').then(r=>{
   if(active&&liveContext.current===contextId)setUnread(r.unread);
  }).catch(()=>{if(active)setUnread(undefined)})};
  refresh();const timer=setInterval(refresh,30000);
  window.addEventListener('vernatun-notifications-changed',refresh);
  return()=>{active=false;clearInterval(timer);window.removeEventListener('vernatun-notifications-changed',refresh)};
 },[c.id]);
 useEffect(()=>{
  function shortcut(e:KeyboardEvent){if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){
   if(notificationDialog.current?.open)return;
   e.preventDefault();focusBefore.current=document.activeElement as HTMLElement;setMode('search');searchDialog.current?.showModal();input.current?.focus();
  }}
  window.addEventListener('keydown',shortcut);
  return()=>window.removeEventListener('keydown',shortcut);
 },[]);
 useEffect(()=>{
  let active=true;setResult(undefined);
  if(mode!=='search'||query.trim().length<2){setState('idle');return}
  setState('loading');
  const timer=setTimeout(()=>{
   void request<SearchResult>('/workspace-search?q='+encodeURIComponent(query.trim())).then(r=>{
    if(active&&r.contextId===liveContext.current){setResult(r);setState('loaded')}
   }).catch(()=>{if(active)setState('failed')});
  },250);
  return()=>{active=false;clearTimeout(timer)};
 },[query,mode,c.id]);
 useEffect(()=>{setQuery('');setResult(undefined);setMode(undefined);setUnread(undefined);
  searchDialog.current?.close();notificationDialog.current?.close();
 },[c.id]);
 function close(){
  searchDialog.current?.close();notificationDialog.current?.close();setMode(undefined);
  focusBefore.current?.focus();
  window.dispatchEvent(new Event('vernatun-notifications-changed'));
 }
 function destination(kind:string,id:string){
  if(kind==='organizations')return '/console/organizations';
  if(kind==='requests'||kind==='workorders')return product==='hayat'?'/hayat/works?requestId='+id:'/imtun/requests?requestId='+id;
  const view=({invoices:'finance',support:'support-cases',units:'units',properties:'properties',people:'people',defects:'defects',documents:'documents'} as Record<string,string>)[kind];
  if(product==='imtun'&&(kind==='properties'||kind==='units'))return viewRoute(product,'overview',c.role_key);
  return viewRoute(product,view,c.role_key);
 }
 return <div className="p-workspace-tools">
  <button className="p-icon p-workspace-search-trigger" type="button" aria-label={text('search')+' (Ctrl+K)'} onClick={()=>{
   focusBefore.current=document.activeElement as HTMLElement;setMode('search');searchDialog.current?.showModal();input.current?.focus();
  }}><Search size={18}/><span>{text('search')}</span></button>
  <button type="button" className="p-icon p-notification-trigger" aria-label={text('notifications')+(unread===undefined?'':' · '+unread)} onClick={()=>{
   focusBefore.current=document.activeElement as HTMLElement;setMode('notifications');notificationDialog.current?.showModal();
  }}><Bell size={19}/>{unread!==undefined&&unread>0&&<span className="p-unread-count" aria-hidden="true">{unread>99?'99+':unread}</span>}</button>
  <dialog ref={searchDialog} className="p-global-dialog" aria-labelledby={titleId} onCancel={e=>{e.preventDefault();close()}} onKeyDownCapture={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}}}>
   <div className="p-global-dialog-heading"><h2 id={titleId}>{text('search')}</h2><button type="button" className="p-icon" aria-label={text('close')} onClick={close}><X/></button></div>
   <p className="p-context-caption">{c.organization_name??'Vernatun'} · {c.building_name??''} {c.unit_number??''}</p>
   <input ref={input} type="search" maxLength={100} value={query} aria-label={text('search')} placeholder={text('hint')} onChange={e=>setQuery(e.target.value)}/>
   {query.trim().length<2&&<p className="p-context-caption">{text('hint')}</p>}
   <div aria-live="polite" role="status">{state==='loading'?text('loading'):state==='failed'?text('failed'):state==='loaded'&&!result?.groups.some(g=>g.items.length)?text('empty'):''}</div>
   {result?.groups.filter(g=>g.items.length>0).map(g=><section className="p-global-search-group" key={g.kind}>
    <h3>{text(g.kind as keyof typeof words)}</h3><ul>{g.items.map(item=><li key={item.id}>
     <strong>{item.title}</strong><small>{item.description}</small><a href={destination(g.kind,item.id)}>{text('open')}</a>
    </li>)}</ul>{g.hasMore&&<p>{text('more')}</p>}
   </section>)}
  </dialog>
  <dialog ref={notificationDialog} className="p-global-dialog" aria-labelledby={notificationTitle} onCancel={e=>{e.preventDefault();close()}} onKeyDownCapture={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}}}>
   <div className="p-global-dialog-heading"><h2 id={notificationTitle}>{text('notifications')}</h2><button className="p-icon" type="button" aria-label={text('close')} onClick={close}><X/></button></div>
   {mode==='notifications'&&<Notifications key={c.id} c={c} language={language}/>}
  </dialog>
 </div>;
}
