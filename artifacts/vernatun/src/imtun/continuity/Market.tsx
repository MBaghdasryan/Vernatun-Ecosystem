import {useMemo,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {createResidentSavedSearch,deleteResidentSavedSearch,getResidentPropertyComparison,getResidentRecords} from '@workspace/api-client-react';
import type {ResidentContinuity,ResidentSearchInput} from '@workspace/api-client-react';
import type {RoleContext} from '../../portal/types';
import type {Language} from '../../portal/i18n';
import {useAct} from '../superapp/useAct';
import {contKey,tt} from './core';
import ListingMap from './ListingMap';
import './continuity.css';
type Offer=ResidentSearchInput['offerType'];
const offers:Offer[]=['all','sale','rent'];
const parseOffer=(v:string|null):Offer=>offers.find(o=>o===v)??'all';
const offerLabel=(l:Language,o:Offer)=>o==='sale'?tt(l,'Վաճառք','Продажа','Sale'):o==='rent'?tt(l,'Վարձակալություն','Аренда','Rent'):tt(l,'Բոլորը','Все','All');
export default function Market({c,l,d}:{c:RoleContext;l:Language;d:ResidentContinuity}){
 const qc=useQueryClient(),refresh=()=>{void qc.invalidateQueries({queryKey:contKey(c.id)})},a=useAct(l,refresh);
 const init=new URLSearchParams(location.search);
 const [query,setQuery]=useState(init.get('search')??''),[offer,setOffer]=useState<Offer>(parseOffer(init.get('offerType'))),[name,setName]=useState(''),[sel,setSel]=useState<string[]>([]),[go,setGo]=useState(false);
 const q=useQuery({queryKey:['resident-cx-listings',c.id,query,offer],enabled:d.canMarketplace,queryFn:()=>getResidentRecords('listings',{...(query?{search:query}:{}),offerType:offer})});
 const items=useMemo(()=>q.data?.items??[],[q.data]);
 const visible=new Set(items.map(r=>r.id)),ids=sel.filter(i=>visible.has(i)),idsKey=ids.join(',');
 const cmp=useQuery({queryKey:['resident-cx-compare',c.id,idsKey],enabled:go&&ids.length>=2,queryFn:()=>getResidentPropertyComparison({ids:idsKey})});
 const apply=(s:{query:string;offerType:Offer})=>{setQuery(s.query);setOffer(s.offerType);const p=new URLSearchParams();if(s.query)p.set('search',s.query);if(s.offerType!=='all')p.set('offerType',s.offerType);history.replaceState(null,'',location.pathname+(p.size?'?'+p.toString():''))};
 const toggle=(id:string)=>{setGo(false);setSel(s=>s.includes(id)?s.filter(x=>x!==id):s.length<4?[...s,id]:s)};
 if(!d.canMarketplace)return <div className="im-card im-empty"><p>{tt(l,'Հայտարարությունների տախտակը միացված չէ։','Доска объявлений не включена.','The marketplace is not enabled.')}</p></div>;
 return <section className="cx sx-section"><div className="im-section-title"><h2>{tt(l,'Որոնում և համեմատություն','Поиск и сравнение','Search and compare')}</h2></div>
 <form className="im-card sx-form" onSubmit={e=>{e.preventDefault();apply({query,offerType:offer})}}>
 <label>{tt(l,'Որոնում','Поиск','Search')}<input value={query} maxLength={120} onChange={e=>setQuery(e.target.value)}/></label>
 <label>{tt(l,'Տեսակ','Тип предложения','Offer type')}<select value={offer} onChange={e=>setOffer(parseOffer(e.target.value))}>{offers.map(o=><option key={o} value={o}>{offerLabel(l,o)}</option>)}</select></label>
 <button className="im-button">{tt(l,'Կիրառել','Применить','Apply')}</button></form>
 <form className="im-card sx-form" onSubmit={e=>{e.preventDefault();void a.run(async()=>{await createResidentSavedSearch({name:name.trim(),query,offerType:offer});setName('')})}}><h3>{tt(l,'Պահված որոնումներ (անձնական)','Сохранённые поиски (личные)','Saved searches (private)')}</h3>
 <label>{tt(l,'Անվանում','Название','Name')}<input required maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label><button className="im-button" disabled={a.busy||!name.trim()}>{tt(l,'Պահել ընթացիկ որոնումը','Сохранить текущий поиск','Save current search')}</button>
 <ul className="cx-list">{d.savedSearches.map(s=><li key={s.id} className="cx-row"><strong>{s.name}</strong><span>{s.query||'—'} · {offerLabel(l,s.offerType)}</span><button type="button" className="im-button" onClick={()=>apply(s)}>{tt(l,'Կիրառել','Применить','Apply')}</button><button type="button" className="im-button" disabled={a.busy} onClick={()=>void a.run(()=>deleteResidentSavedSearch(s.id))}>{tt(l,'Ջնջել','Удалить','Delete')}</button></li>)}</ul>
 {!d.savedSearches.length&&<small>{tt(l,'Պահված որոնումներ չկան','Сохранённых поисков нет','No saved searches')}</small>}{a.err&&<p role="alert" className="sx-err">{a.err}</p>}</form>
 <div className="im-card sx-form"><h3>{tt(l,'Համեմատել (մինչև 4)','Сравнить (до 4)','Compare (up to 4)')}</h3>
 {q.isPending&&<div className="sx-skel" aria-busy="true">…</div>}{q.isError&&<div className="im-notice" role="alert">{tt(l,'Չհաջողվեց բեռնել։','Не удалось загрузить.','Could not load.')} <button onClick={()=>q.refetch()}>{tt(l,'Կրկնել','Повторить','Retry')}</button></div>}
 {q.data&&!items.length&&<p>{tt(l,'Հայտարարություններ չկան','Объявлений нет','No listings')}</p>}
 <ul className="cx-list">{items.map(r=><li key={r.id}><label className="sx-check"><input type="checkbox" checked={ids.includes(r.id)} disabled={!ids.includes(r.id)&&ids.length>=4} onChange={()=>toggle(r.id)}/>{r.title}</label></li>)}</ul>
 <button className="im-button" disabled={ids.length<2} onClick={()=>setGo(true)}>{tt(l,'Համեմատել','Сравнить','Compare')} ({ids.length}/4)</button>
 {cmp.isFetching&&<div className="sx-skel" aria-busy="true">…</div>}{cmp.isError&&<p role="alert" className="sx-err">{tt(l,'Համեմատությունը հասանելի չէ։','Сравнение недоступно.','Comparison is unavailable.')}</p>}
 {go&&cmp.data&&<div className="cx-row" style={{alignItems:'stretch'}}>{cmp.data.map(p=><article key={p.id} className="im-card" style={{flex:'1 1 220px'}}><h4>{p.title}</h4><p>{p.priceMinor!==null&&p.currency?(Number(p.priceMinor)/100).toLocaleString(l)+' '+p.currency:tt(l,'Գինը նշված չէ','Цена не указана','Price not provided')}</p><p>{p.description}</p>
 <p>{p.address||tt(l,'Հասցե նշված չէ','Адрес не указан','No address')}</p>{p.address&&<a className="sx-link" target="_blank" rel="noopener noreferrer" href={'https://www.openstreetmap.org/search?query='+encodeURIComponent(p.address)}>{tt(l,'Արտաքին հասցեի որոնում OpenStreetMap-ում','Внешний поиск адреса в OpenStreetMap','External address lookup (OpenStreetMap)')}</a>}<ListingMap lat={p.latitude} lon={p.longitude} l={l} title={p.title}/></article>)}</div>}</div></section>}
