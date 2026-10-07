import {useEffect,useState} from 'react';
import {request} from './client';
import type {Language} from './i18n';
type Row={id:string;name:string;contact:string;organization:string|null;product_interest:string|null;audience:string|null;message:string|null;language:string;created_at:string};
type Res={rows:Row[];total:number;page:number;pageSize:number};
const S={
title:['Հայտեր','Заявки','Leads'],search:['Որոնում','Поиск','Search'],sort:['Դասավորել','Сортировка','Sort'],
created:['Ամսաթիվ','Дата','Date'],name:['Անուն','Имя','Name'],asc:['Աճող','По возрастанию','Ascending'],desc:['Նվազող','По убыванию','Descending'],
lang:['Լեզու','Язык','Language'],all:['Բոլորը','Все','All'],
loading:['Բեռնվում է…','Загрузка…','Loading…'],empty:['Հայտեր չկան։','Заявок нет.','No leads.'],
err:['Չհաջողվեց բեռնել։','Не удалось загрузить.','Could not load.'],retry:['Կրկնել','Повторить','Retry'],
prev:['Նախորդ','Назад','Previous'],next:['Հաջորդ','Далее','Next'],of:['՝','из','of'],
contact:['Կոնտակտ','Контакт','Contact'],org:['Կազմակերպություն','Организация','Organization'],prod:['Արտադրանք','Продукт','Product'],aud:['Լսարան','Аудитория','Audience'],msg:['Հաղորդագրություն','Сообщение','Message']} as const;
const SIZE=25;
export default function LeadsConsole({language}:{language:Language}){
const t=(k:keyof typeof S)=>S[k][language==='hy'?0:language==='ru'?1:2];
const [input,setInput]=useState(''),[q,setQ]=useState(''),[sort,setSort]=useState<'created_at'|'name'>('created_at'),[dir,setDir]=useState<'asc'|'desc'>('desc'),[lang,setLang]=useState(''),[page,setPage]=useState(1),[tick,setTick]=useState(0);
const [data,setData]=useState<Res>(),[state,setState]=useState<'loading'|'ok'|'error'>('loading');
useEffect(()=>{const h=setTimeout(()=>{setQ(input.trim());setPage(1)},350);return()=>clearTimeout(h)},[input]);
useEffect(()=>{let stale=false;setState('loading');
 const p=new URLSearchParams({page:String(page),pageSize:String(SIZE),q,sort,direction:dir});if(lang)p.set('language',lang);
 request<Res>('/leads?'+p).then(r=>{if(stale)return;setData(r);setState('ok')}).catch(()=>{if(!stale)setState('error')});
 return()=>{stale=true}},[page,q,sort,dir,lang,tick]);
const pages=data?Math.max(1,Math.ceil(data.total/SIZE)):1;
return <section className="p-card"><h2>{t('title')}</h2>
<div className="p-edit-form">
<label>{t('search')}<input type="search" value={input} maxLength={120} onChange={e=>setInput(e.target.value)}/></label>
<label>{t('sort')}<select value={sort} onChange={e=>{setSort(e.target.value as 'name');setPage(1)}}><option value="created_at">{t('created')}</option><option value="name">{t('name')}</option></select></label>
<label><select aria-label={t('sort')} value={dir} onChange={e=>{setDir(e.target.value as 'asc');setPage(1)}}><option value="desc">{t('desc')}</option><option value="asc">{t('asc')}</option></select></label>
<label>{t('lang')}<select value={lang} onChange={e=>{setLang(e.target.value);setPage(1)}}><option value="">{t('all')}</option><option value="hy">hy</option><option value="ru">ru</option><option value="en">en</option></select></label></div>
{state==='loading'&&<p role="status" aria-busy="true">{t('loading')}</p>}
{state==='error'&&<><p className="p-error" role="alert">{t('err')}</p><button className="p-button" onClick={()=>setTick(n=>n+1)}>{t('retry')}</button></>}
{state==='ok'&&data&&(data.rows.length===0?<p>{t('empty')}</p>:<ul style={{listStyle:'none',padding:0,display:'grid',gap:12}}>{data.rows.map(r=><li key={r.id} className="p-info"><strong>{r.name}</strong> · {new Date(r.created_at).toLocaleString(language==='hy'?'hy-AM':language==='ru'?'ru-RU':'en-GB')} · {r.language}
<div>{t('contact')}: {r.contact}</div>{r.organization&&<div>{t('org')}: {r.organization}</div>}{r.product_interest&&<div>{t('prod')}: {r.product_interest}</div>}{r.audience&&<div>{t('aud')}: {r.audience}</div>}{r.message&&<div style={{whiteSpace:'pre-wrap'}}>{t('msg')}: {r.message}</div>}</li>)}</ul>)}
<div><button className="p-button" disabled={page<=1||state==='loading'} onClick={()=>setPage(page-1)}>{t('prev')}</button> {page} {t('of')} {pages} <button className="p-button" disabled={page>=pages||state==='loading'} onClick={()=>setPage(page+1)}>{t('next')}</button></div>
</section>}
