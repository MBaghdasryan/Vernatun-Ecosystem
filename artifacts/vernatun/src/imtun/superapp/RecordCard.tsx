import ListingMap from '../continuity/ListingMap';
import {useState,type FormEvent} from 'react';
import {updateResidentRecord,removeResidentRecord,actOnResidentRecord} from '@workspace/api-client-react';
import type {ResidentRecord,ResidentRecordKind} from '@workspace/api-client-react';
import type {RoleContext} from '../../portal/types';
import type {Language} from '../../portal/i18n';
import {L,S,A2,actLabel,statusLabel,inquire,keepFields,reasonNeeded} from './text';
import {useAct} from './useAct';
import Thread from './Thread';
import CreateForm from './CreateForm';
import DiscussionLinks from './DiscussionLinks';
import {metaValue} from './meta';
import ListingForm from './ListingForm';
import ListingPhotos from './ListingPhotos';
import ViewingForm from './ViewingForm';
import {LT,fmtView,listingSummary} from './listingText';
const metaKeys=['plate','make','model','color','platform','appVersion','phone','email','hours','category','saleType','priceMinor','currency','area','rooms','floor','quantity'];
export default function RecordCard({kind,rec,l,c,refresh}:{kind:ResidentRecordKind;rec:ResidentRecord;l:Language;c:RoleContext;refresh:()=>void}){
 const a=useAct(l,refresh),[edit,setEdit]=useState(false),[t,setT]=useState(rec.title),[b,setB]=useState(rec.body),[open,setOpen]=useState(false),[note,setNote]=useState(''),[rep,setRep]=useState(false),[reason,setReason]=useState('');
 const d=rec.data as Record<string,unknown>,meta=kind==='listings'?listingSummary(d,l):metaKeys.filter(k=>d[k]!=null&&d[k]!=='').map(k=>metaValue(k,d[k],l)).join(' · ');
 const hasMsg=rec.actions.includes('message')&&kind!=='listings',acts=rec.actions.filter(x=>x!=='message'&&x!=='inquire');
 const doAct=(x:string)=>{if(LT.act[x]){if(!confirm(L(l,LT.act[x])+'?'))return;setNote('');return void a.run(async()=>{await actOnResidentRecord(kind,rec.id,{action:x as any,version:rec.version});setNote(L(l,LT.done[x]))})}if(x==='edit')return setEdit(true);if(reasonNeeded.includes(x))return setRep(true);if(x==='delete'||x==='revoke'){if(!confirm(L(l,S.confirm)))return;return void a.run(()=>removeResidentRecord(kind,rec.id,{version:rec.version}))}
  void a.run(()=>actOnResidentRecord(kind,rec.id,{action:x as any,version:rec.version}))};
 const saveEdit=(e:FormEvent)=>{e.preventDefault();void a.run(async()=>{await updateResidentRecord(kind,rec.id,{title:t,body:b,...keepFields(kind,d),version:rec.version} as any);setEdit(false)})};
 if(edit&&kind==='listings')return <article className="im-card sx-rec"><ListingForm l={l} rec={rec} refresh={refresh} onDone={()=>setEdit(false)}/></article>;
 const vw=kind==='conversations'?fmtView(d,l):'';
 return <article className="im-card sx-rec"><div className="im-card-top"><span className="im-chip im-success">{statusLabel[rec.status]?L(l,statusLabel[rec.status]):'·'}</span>{(rec.supportCount??0)>0&&<span className="im-record-id">+{rec.supportCount}</span>}</div>
 {edit?<form onSubmit={saveEdit} className="sx-form"><input value={t} onChange={e=>setT(e.target.value)} maxLength={200} required/><textarea value={b} onChange={e=>setB(e.target.value)} maxLength={5000}/><div className="sx-row"><button className="im-button" disabled={a.busy}>{L(l,S.save)}</button><button type="button" aria-label="close" className="im-button im-secondary" onClick={()=>setEdit(false)}>×</button></div></form>:<><h3>{rec.title}</h3>{rec.body&&<p className="sx-body">{rec.body}</p>}{meta&&<small className="sx-meta">{meta}</small>}{vw&&<p role="status" className="sx-meta">{vw}</p>}</>}
 <div className="sx-row">{acts.map(x=><button key={x} disabled={a.busy} className="im-button im-secondary" onClick={()=>doAct(x)}>{actLabel[x]?L(l,actLabel[x]):LT.act[x]?L(l,LT.act[x]):L(l,S.open2)}</button>)}{hasMsg&&<button className="im-button im-secondary" onClick={()=>setOpen(!open)}>{L(l,S.msgs)}</button>}</div>
 <DiscussionLinks rec={rec} l={l} scope={c.id}/>
  {kind==='listings'&&<><ListingMap lat={typeof d.latitude==='number'?d.latitude:null} lon={typeof d.longitude==='number'?d.longitude:null} l={l} title={rec.title}/><ListingPhotos rec={rec} c={c} l={l} refresh={refresh}/></>}
 {kind==='listings'&&rec.actions.includes('inquire')&&<div className="sx-row"><ViewingForm rec={rec} l={l} refresh={refresh}/><CreateForm kind="conversations" l={l} parent={rec} label={inquire} refresh={refresh}/></div>}
 {rep&&<form className="sx-form" onSubmit={e=>{e.preventDefault();void a.run(async()=>{await actOnResidentRecord(kind,rec.id,{action:'report',version:rec.version,reason:reason.trim()});setRep(false);setReason('')})}}><label>{L(l,A2.reason)}<textarea required maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="sx-row"><button className="im-button" disabled={a.busy||!reason.trim()}>{L(l,actLabel.report)}</button><button type="button" aria-label="close" className="im-button im-secondary" onClick={()=>setRep(false)}>×</button></div></form>}{note&&<p role="status">{note}</p>}{a.err&&<p role="alert" className="sx-err">{a.err}</p>}{open&&hasMsg&&<Thread kind={kind} rec={rec} l={l} c={c}/>}</article>}
