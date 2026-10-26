import {useState,type FormEvent} from 'react';
import {createResidentRecord,updateResidentRecord} from '@workspace/api-client-react';
import type {ResidentRecord} from '@workspace/api-client-react';
import type {Language} from '../../portal/i18n';
import {L,S,keepFields} from './text';
import {LT,minorToMajor,majorToMinor,optInt,optNum,CURRENCIES} from './listingText';
import {useAct} from './useAct';
import {coordsFromText,CoordInputs} from '../continuity/coords';
const strip=(o:Record<string,unknown>)=>{const {area:_a,rooms:_r,floor:_f,latitude:_la,longitude:_lo,...rest}=o;return rest};
export default function ListingForm({l,refresh,rec,onDone}:{l:Language;refresh:()=>void;rec?:ResidentRecord;onDone?:()=>void}){
 const d=(rec?.data??{}) as Record<string,unknown>,[open,setOpen]=useState(!!rec),a=useAct(l,refresh),[err,setErr]=useState(''),[ok,setOk]=useState('');
 const [lat,setLat]=useState(String(d.latitude??'')),[lon,setLon]=useState(String(d.longitude??''));
 const [v,setV]=useState({title:rec?.title??'',body:rec?.body??'',saleType:String(d.saleType??'sale'),currency:String(d.currency??'AMD'),price:minorToMajor(d.priceMinor),area:d.area!=null?String(d.area):'',rooms:d.rooms!=null?String(d.rooms):'',floor:d.floor!=null?String(d.floor):''});
 const set=(k:string)=>(e:{target:{value:string}})=>setV({...v,[k]:e.target.value});
 const close=()=>{setOpen(false);onDone?.()};
 const submit=(e:FormEvent)=>{e.preventDefault();setErr('');setOk('');
  const area=optNum(v.area,1,100000),rooms=optInt(v.rooms,0,100),floor=optInt(v.floor,-10,300),pm=majorToMinor(v.price);
  if(!v.price.trim())return setErr(L(l,LT.priceReq));
  if(area===null||rooms===null||floor===null||pm===null)return setErr(L(l,LT.badNum));
  const cc=coordsFromText(lat,lon);
  if(cc==='invalid')return setErr(L(l,['Լրացրեք երկու ճիշտ կոորդինատ կամ թողեք դատարկ։','Укажите обе корректные координаты или оставьте пустыми.','Enter both valid coordinates or leave them empty.']));
  const data:Record<string,unknown>={title:v.title.trim(),body:v.body,saleType:v.saleType,currency:v.currency};
  if(cc)Object.assign(data,cc);
  data.priceMinor=pm;if(area!==undefined)data.area=area;if(rooms!==undefined)data.rooms=rooms;if(floor!==undefined)data.floor=floor;
  void a.run(async()=>{if(rec)await updateResidentRecord('listings',rec.id,{...strip(keepFields('listings',d)),...data,version:rec.version} as any);else{await createResidentRecord('listings',data as any);setV({...v,title:'',body:'',price:'',area:'',rooms:'',floor:''});setLat('');setLon('')}setOk(L(l,LT.saved));if(rec)close();else setOpen(false)})};
 if(!open)return <>{ok&&<p role="status">{ok}</p>}<button className="im-button" onClick={()=>setOpen(true)}>{L(l,S.add)}</button></>;
 return <form className="im-card sx-form" onSubmit={submit}><label>{L(l,S.title)}<input required maxLength={200} value={v.title} onChange={set('title')}/></label><label>{L(l,S.body)}<textarea maxLength={5000} value={v.body} onChange={set('body')}/></label>
 <label>{L(l,LT.type)}<select value={v.saleType} onChange={set('saleType')}><option value="sale">{L(l,LT.sale)}</option><option value="rent">{L(l,LT.rent)}</option></select></label>
 <label>{L(l,LT.currency)}<select value={v.currency} onChange={set('currency')}>{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select></label>
 <label>{L(l,LT.price)}<input required inputMode="decimal" value={v.price} onChange={set('price')}/></label>
 <label>{L(l,LT.area)}<input inputMode="decimal" value={v.area} onChange={set('area')}/></label>
 <label>{L(l,LT.rooms)}<input type="number" min={0} max={100} step={1} value={v.rooms} onChange={set('rooms')}/></label>
 <label>{L(l,LT.floor)}<input type="number" min={-10} max={300} step={1} value={v.floor} onChange={set('floor')}/></label>
 <CoordInputs l={l} lat={lat} lon={lon} onLat={setLat} onLon={setLon}/>
 <div className="sx-row"><button className="im-button" disabled={a.busy}>{L(l,S.save)}</button><button type="button" aria-label="close" className="im-button im-secondary" onClick={close}>×</button></div>{(err||a.err)&&<p role="alert" className="sx-err">{err||a.err}</p>}</form>}
