import {useState,type FormEvent} from 'react';
import {createResidentRecord} from '@workspace/api-client-react';
import type {ResidentRecord,ResidentRecordKind,ResidentRecordInput} from '@workspace/api-client-react';
import type {Language} from '../../portal/i18n';
import {L,S,feedbackCats,type T} from './text';
import {useAct} from './useAct';
import {coordsFromText,CoordInputs} from '../continuity/coords';
const fields:Record<string,[string,T][]>={vehicles:[['plate',['Համարանիշ','Госномер','Plate']],['make',['Մակնիշ','Марка','Make']],['model',['Մոդել','Модель','Model']],['color',['Գույն','Цвет','Color']]],directory:[['category',['Կատեգորիա','Категория','Category']]],listings:[['priceMinor',S.price]],'mobile-devices':[['appVersion',['Հավելվածի տարբերակ','Версия приложения','App version']]]};
// parent: service being ordered (subscriptions) or listing being inquired about (conversations).
export default function CreateForm({kind,l,refresh,parent,label}:{kind:ResidentRecordKind;l:Language;refresh:()=>void;parent?:ResidentRecord;label?:T}){
 const [v,setV]=useState<Record<string,string>>({}),[open,setOpen]=useState(false),a=useAct(l,refresh);
 const submit=(e:FormEvent)=>{e.preventDefault();void a.run(async()=>{const data:ResidentRecordInput={title:(v.title??parent?.title??'').trim(),body:v.body||''};
  for(const [k] of fields[kind]??[])if(v[k])(data as any)[k]=v[k];
  if(kind==='feedback')data.category=v.category||'idea';
  if(kind==='discussions')data.category=(v.category||'general').trim()||'general';
  if(kind==='vehicles'){data.country='AM';data.vehicleType='car'}
  if(kind==='mobile-devices'){data.installationId=crypto.randomUUID();data.platform='web';data.osVersion=navigator.platform.slice(0,80)}
  if(kind==='listings'){data.saleType=(v.saleType as any)||'sale';data.currency='AMD'}
  if(kind==='subscriptions')data.quantity=Math.max(1,Number(v.qty)||1);
  if(parent&&(kind==='subscriptions'||kind==='conversations'))data.parentId=parent.id;
  if(kind==='listings'){const c=coordsFromText(v.lat??'',v.lon??'');if(c==='invalid')throw new Error('coords');if(c)Object.assign(data,c)}
  await createResidentRecord(kind,data);setV({});setOpen(false)})};
 if(!open)return <button className="im-button" onClick={()=>setOpen(true)}>{L(l,label??S.add)}</button>;
 return <form className="im-card sx-form" onSubmit={submit}><label>{L(l,S.title)}<input required maxLength={200} value={v.title??parent?.title??''} onChange={e=>setV({...v,title:e.target.value})}/></label><label>{L(l,S.body)}<textarea maxLength={5000} value={v.body??''} onChange={e=>setV({...v,body:e.target.value})}/></label>
 {(fields[kind]??[]).map(([k,lab])=><label key={k}>{L(l,lab)}<input value={v[k]??''} pattern={k==='priceMinor'?'\\d{1,14}':undefined} onChange={e=>setV({...v,[k]:e.target.value})}/></label>)}
 {kind==='feedback'&&<label>{L(l,['Կատեգորիա','Категория','Category'])}<select value={v.category??'idea'} onChange={e=>setV({...v,category:e.target.value})}>{feedbackCats.map(([k,t])=><option key={k} value={k}>{L(l,t)}</option>)}</select></label>}
 {kind==='discussions'&&<label>{L(l,['Կատեգորիա','Категория','Category'])}<input value={v.category??'general'} maxLength={80} onChange={e=>setV({...v,category:e.target.value})}/></label>}
 {kind==='listings'&&<label>{L(l,['Տեսակ','Тип','Type'])}<select value={v.saleType??'sale'} onChange={e=>setV({...v,saleType:e.target.value})}><option value="sale">{L(l,['Վաճառք','Продажа','Sale'])}</option><option value="rent">{L(l,['Վարձակալություն','Аренда','Rent'])}</option></select></label>}
 {kind==='listings'&&<CoordInputs l={l} lat={v.lat??''} lon={v.lon??''} onLat={x=>setV({...v,lat:x})} onLon={x=>setV({...v,lon:x})}/>}
 {kind==='subscriptions'&&<label>{L(l,S.qty)}<input type="number" min={1} max={1000} value={v.qty??'1'} onChange={e=>setV({...v,qty:e.target.value})}/></label>}
 <div className="sx-row"><button className="im-button" disabled={a.busy}>{L(l,S.save)}</button><button type="button" aria-label="close" className="im-button im-secondary" onClick={()=>setOpen(false)}>×</button></div>{a.err&&<p role="alert" className="sx-err">{a.err}</p>}</form>}
