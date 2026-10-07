import {useEffect,useState,type ReactNode} from 'react';
import {request} from './client';
import type {Language} from './i18n';
type Col={key:string;title:string;render?:(row:any)=>ReactNode};
type Res={rows:any[];total:number;page:number;pageSize:number;sort?:string;direction?:string};
const SORTS:Record<string,readonly string[]>={organizations:['name','currency','created_at','status'],properties:['name','address','units'],units:['number','building_name','area'],people:['name','email','role_key','active'],invitations:['email','role_key','expires_at','status'],audit:['created_at','actor','action','entity_type']};
const S={search:['Որոնում','Поиск','Search'],all:['Բոլորը','Все','All'],active:['Ակտիվ','Активные','Active'],inactive:['Ոչ ակտիվ','Неактивные','Inactive'],status:['Կարգավիճակ','Статус','Status'],
loading:['Բեռնվում է…','Загрузка…','Loading…'],empty:['Գրառումներ չկան։','Записей нет.','No records.'],err:['Չհաջողվեց բեռնել։','Не удалось загрузить.','Could not load.'],retry:['Կրկնել','Повторить','Retry'],
prev:['Նախորդ','Назад','Previous'],next:['Հաջորդ','Далее','Next'],of:['՝','из','of']} as const;
const SIZE=25;
export default function ServerDataTable({resource,scopeKey,revision,columns,actions,language,label}:{resource:string;scopeKey:string;revision:unknown;columns:Col[];actions?:(row:any)=>ReactNode;language:Language;label:(key:string)=>string}){
const t=(k:keyof typeof S)=>S[k][language==='hy'?0:language==='ru'?1:2];
const allowed=SORTS[resource]??[];
const [input,setInput]=useState(''),[q,setQ]=useState(''),[sort,setSort]=useState(''),[dir,setDir]=useState<'asc'|'desc'>('asc'),[filter,setFilter]=useState('all'),[page,setPage]=useState(1),[tick,setTick]=useState(0);
const [data,setData]=useState<Res>(),[state,setState]=useState<'loading'|'ok'|'error'>('loading');
useEffect(()=>{setInput('');setQ('');setSort('');setDir('asc');setFilter('all');setPage(1);setData(undefined)},[scopeKey,resource]);
useEffect(()=>{if(input.trim()===q)return;const h=setTimeout(()=>{setQ(input.trim());setPage(1)},350);return()=>clearTimeout(h)},[input,q]);
useEffect(()=>{let stale=false;setState('loading');
 const p=new URLSearchParams({page:String(page),pageSize:String(SIZE),q,direction:dir});
 if(sort&&allowed.includes(sort))p.set('sort',sort);
 if(resource==='people'&&filter!=='all')p.set('filter',filter);
 request<Res>(`/paged/${encodeURIComponent(resource)}?${p}`).then(r=>{if(stale)return;setData(r);setState('ok')}).catch(()=>{if(!stale)setState('error')});
 return()=>{stale=true}},[resource,scopeKey,page,q,sort,dir,filter,tick,revision]);
function toggle(k:string){if(sort===k)setDir(dir==='asc'?'desc':'asc');else{setSort(k);setDir('asc')}setPage(1)}
const pages=data?Math.max(1,Math.ceil(data.total/SIZE)):1;
const span=columns.length+(actions?1:0);
return <div className="p-card" aria-busy={state==='loading'}>
<div className="p-edit-form"><label>{t('search')}<input type="search" value={input} maxLength={120} onChange={e=>setInput(e.target.value)}/></label>
{resource==='people'&&<label>{t('status')}<select value={filter} onChange={e=>{setFilter(e.target.value);setPage(1)}}><option value="all">{t('all')}</option><option value="true">{t('active')}</option><option value="false">{t('inactive')}</option></select></label>}</div>
<div style={{overflowX:'auto',maxWidth:'100%'}}><table style={{width:'100%',minWidth:560}}><thead><tr>{columns.map(c=>{const can=allowed.includes(c.key);const on=sort===c.key;return <th key={c.key} scope="col" aria-sort={on?(dir==='asc'?'ascending':'descending'):can?'none':undefined}>{can?<button type="button" className="p-link" onClick={()=>toggle(c.key)} style={{font:'inherit',background:'none',border:0,cursor:'pointer',padding:0}}>{c.title}{on?(dir==='asc'?' ▲':' ▼'):''}</button>:c.title}</th>})}{actions&&<th scope="col"><span className="sr-only">{label('actions')}</span></th>}</tr></thead>
<tbody>{state==='error'?<tr><td colSpan={span}><span className="p-error" role="alert">{t('err')}</span> <button type="button" className="p-button" onClick={()=>setTick(n=>n+1)}>{t('retry')}</button></td></tr>
:!data?<tr><td colSpan={span} role="status">{t('loading')}</td></tr>
:data.rows.length===0?<tr><td colSpan={span}>{t('empty')}</td></tr>
:data.rows.map((r,i)=><tr key={r.id??i}>{columns.map(c=><td key={c.key}>{c.render?c.render(r):String(r[c.key]??'')}</td>)}{actions&&<td>{actions(r)}</td>}</tr>)}</tbody></table></div>
<div><button type="button" className="p-button" disabled={page<=1||state==='loading'} onClick={()=>setPage(page-1)}>{t('prev')}</button> {page} {t('of')} {pages}{data?` (${data.total})`:''} <button type="button" className="p-button" disabled={page>=pages||state==='loading'} onClick={()=>setPage(page+1)}>{t('next')}</button></div></div>}
