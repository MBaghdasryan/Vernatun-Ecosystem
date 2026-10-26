import {useState,type FormEvent} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {getResidentRecords,createResidentRecord,updateResidentRecord,actOnResidentRecord,removeResidentRecord,getResidentMessages,postResidentMessage} from '@workspace/api-client-react';
import type {ResidentRecord,ResidentRecordKind,ResidentRecordInput} from '@workspace/api-client-react';
import type {Language} from '../../portal/i18n';
import {L,S,actLabel,statusLabel,contactCats,agreementCats,helpLangs,reasonNeeded,type T} from './text';
import {A,staffCreate} from './adminText';
import {useAct} from './useAct';
import ListingPhotos from './ListingPhotos';
import {listingSummary,fmtView} from './listingText';
import DiscussionConversion from './DiscussionConversion';
import DiscussionLinks from './DiscussionLinks';
type P={kind:ResidentRecordKind;l:Language;scope:string;buildingId:string;onChanged?:()=>void};
const reasonActs=['approve','reject','freeze','close','reopen','report'];
function AdminThread({kind,rec,l,scope,buildingId}:P&{rec:ResidentRecord}){
 const qc=useQueryClient(),key=['resident-admin-msg',scope,kind,rec.id],q=useQuery({queryKey:key,queryFn:()=>getResidentMessages(kind,rec.id,{buildingId})});
 const [text,setText]=useState(''),[cid,setCid]=useState(()=>crypto.randomUUID()),a=useAct(l,()=>{void qc.invalidateQueries({queryKey:key})});
 const send=(e:FormEvent)=>{e.preventDefault();const body=text.trim();if(!body)return;void a.run(async()=>{await postResidentMessage(kind,rec.id,{body,clientId:cid},{buildingId});setText('');setCid(crypto.randomUUID())})};
 return <div className="sx-thread">{q.isPending&&<p>{L(l,S.loading)}</p>}{q.isError&&<p role="alert">{L(l,S.fail)} <button className="sx-link" onClick={()=>q.refetch()}>{L(l,S.retry)}</button></p>}{q.data?.map(m=><div key={m.id} className={'sx-msg '+(m.own?'own':'')}><small>{m.sender} · {new Date(m.createdAt).toLocaleString(l)}</small><p>{m.body}</p></div>)}
 <form onSubmit={send} className="sx-inline"><input aria-label={L(l,A.reply)} value={text} maxLength={5000} onChange={e=>setText(e.target.value)}/><button className="im-button" disabled={a.busy||!text.trim()}>{L(l,A.reply)}</button></form>{a.err&&<p role="alert" className="sx-err">{a.err}</p>}</div>}
function AdminCard({kind,rec,l,scope,buildingId,refresh}:P&{rec:ResidentRecord;refresh:()=>void}){
 const a=useAct(l,refresh),[reason,setReason]=useState(''),[open,setOpen]=useState(false),[edit,setEdit]=useState(false);
 const [conversion,setConversion]=useState<'request'|'proposal'>();
 const hasMsg=rec.actions.includes('message')&&kind!=='listings',acts=rec.actions.filter(x=>x!=='message'&&x!=='inquire'&&x!=='edit');
 const canEdit=rec.actions.includes('edit')&&staffCreate.includes(kind);
 const go=(x:string)=>{if(x==='request'||x==='proposal')return setConversion(x);if(x==='delete'){if(!confirm(L(l,S.confirm)))return;return void a.run(()=>removeResidentRecord(kind,rec.id,{version:rec.version,buildingId}))}
  void a.run(async()=>{await actOnResidentRecord(kind,rec.id,{action:x as any,version:rec.version,...(reason.trim()?{reason:reason.trim()}:{})},{buildingId});setReason('')})};
 return <article className="im-card sx-rec"><div className="im-card-top"><span className="im-chip im-warning">{statusLabel[rec.status]?L(l,statusLabel[rec.status]):'·'}</span></div><h3>{rec.title}</h3>{rec.body&&<p className="sx-body">{rec.body}</p>}
 {kind==='listings'&&<><p className="sx-meta">{listingSummary(rec.data as Record<string,unknown>,l)}</p><ListingPhotos rec={rec} c={{id:scope}} l={l} buildingId={buildingId} refresh={refresh}/></>}
 {kind==='conversations'&&<p className="sx-meta">{fmtView(rec.data as Record<string,unknown>,l)}</p>}
 <DiscussionLinks rec={rec} l={l} scope={scope} buildingId={buildingId}/>
 {conversion&&<DiscussionConversion rec={rec} l={l} scope={scope} buildingId={buildingId} action={conversion} done={()=>setConversion(undefined)} refresh={refresh}/>}
 {acts.some(x=>reasonActs.includes(x)||reasonNeeded.includes(x))&&<input className="sx-search" aria-label={L(l,A.reason)} placeholder={L(l,A.reason)} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/>}
 <div className="sx-row">{acts.map(x=><button key={x} disabled={a.busy||(reasonNeeded.includes(x)&&!reason.trim())} className="im-button im-secondary" onClick={()=>go(x)}>{actLabel[x]?L(l,actLabel[x]):L(l,S.open2)}</button>)}{canEdit&&<button className="im-button im-secondary" onClick={()=>setEdit(true)}>{L(l,actLabel.edit)}</button>}{hasMsg&&<button className="im-button im-secondary" onClick={()=>setOpen(!open)}>{L(l,S.msgs)}</button>}</div>
 {edit&&<StaffForm kind={kind} l={l} buildingId={buildingId} refresh={refresh} rec={rec} onDone={()=>setEdit(false)}/>}{a.err&&<p role="alert" className="sx-err">{a.err}</p>}{open&&hasMsg&&<AdminThread kind={kind} rec={rec} l={l} scope={scope} buildingId={buildingId}/>}</article>}
function StaffForm({kind,l,buildingId,refresh,rec,onDone}:{kind:ResidentRecordKind;l:Language;buildingId:string;refresh:()=>void;rec?:ResidentRecord;onDone?:()=>void}){
 const rd=(rec?.data??{}) as Record<string,any>,str=(k:string)=>rd[k]==null?undefined:String(rd[k]);
 const [v,setV]=useState<Record<string,string>>(rec?Object.fromEntries([['title',rec.title],['body',rec.body],...['phone','email','hours','category','priceMinor','currency'].map(k=>[k,str(k)]).filter(x=>x[1]!==undefined)] as [string,string][]):{}),[chk,setChk]=useState({mandatory:!!rd.mandatory,withdrawable:rd.withdrawable!==false}),[open,setOpen]=useState(!!rec),a=useAct(l,refresh);
 const f=(k:string,lab:typeof A.hours)=><label>{L(l,lab)}<input value={v[k]??''} onChange={e=>setV({...v,[k]:e.target.value})}/></label>;
 const submit=(e:FormEvent)=>{e.preventDefault();void a.run(async()=>{const d:ResidentRecordInput={title:(v.title??'').trim(),body:v.body??''};
  if(kind==='contacts'){for(const k of ['phone','email','hours'] as const)if(v[k])d[k]=v[k];d.category=v.category||'management'}
  if(kind==='help')d.category=v.category||'hy';
  if(kind==='agreements'){d.category=v.category||'terms';d.mandatory=chk.mandatory;d.withdrawable=chk.mandatory?false:chk.withdrawable}
  if(kind==='services'){if(v.category)d.category=v.category;if(v.priceMinor)d.priceMinor=v.priceMinor;d.currency=(v.currency as any)||'AMD'}
  if(rec){await updateResidentRecord(kind,rec.id,{...d,version:rec.version},{buildingId});onDone?.()}else{await createResidentRecord(kind,d,{buildingId});setV({})}setOpen(!!rec)})};
 if(!open)return <button className="im-button" onClick={()=>setOpen(true)}>{L(l,S.add)}</button>;
 return <form className="im-card sx-form" onSubmit={submit}><label>{L(l,S.title)}<input required maxLength={200} value={v.title??''} onChange={e=>setV({...v,title:e.target.value})}/></label><label>{L(l,S.body)}<textarea maxLength={5000} value={v.body??''} onChange={e=>setV({...v,body:e.target.value})}/></label>
 {(kind==='contacts')&&<>{f('phone',A.phone)}{f('email',A.email)}{f('hours',A.hours)}</>}{kind==='services'&&f('category',A.category)}{(['contacts','help','agreements'] as string[]).includes(kind)&&<label>{L(l,A.category)}<select value={v.category??(kind==='contacts'?'management':kind==='help'?'hy':'terms')} onChange={e=>setV({...v,category:e.target.value})}>{((kind==='contacts'?contactCats:kind==='help'?helpLangs:agreementCats) as [string,T][]).map(([k,t])=><option key={k} value={k}>{L(l,t)}</option>)}</select></label>}
 {kind==='services'&&<>{f('priceMinor',A.price)}<label>{L(l,A.currency)}<select value={v.currency??'AMD'} onChange={e=>setV({...v,currency:e.target.value})}><option>AMD</option><option>RUB</option><option>USD</option></select></label></>}
 {kind==='agreements'&&<><label className="sx-check"><input type="checkbox" checked={chk.mandatory} onChange={e=>setChk({mandatory:e.target.checked,withdrawable:e.target.checked?false:chk.withdrawable})}/>{L(l,A.mandatory)}</label><label className="sx-check"><input type="checkbox" checked={chk.withdrawable&&!chk.mandatory} disabled={chk.mandatory} onChange={e=>setChk({...chk,withdrawable:e.target.checked})}/>{L(l,A.withdrawable)}</label></>}
 <div className="sx-row"><button className="im-button" disabled={a.busy}>{L(l,S.save)}</button><button type="button" aria-label="close" className="im-button im-secondary" onClick={()=>{setOpen(!!rec);onDone?.()}}>×</button></div>{a.err&&<p role="alert" className="sx-err">{a.err}</p>}</form>}
export default function AdminRecords({kind,l,scope,buildingId,onChanged}:P){
 const qc=useQueryClient(),key=['resident-admin-rec',scope,kind],q=useQuery({queryKey:key,queryFn:()=>getResidentRecords(kind,{buildingId}),refetchInterval:kind==='discussions'?30000:false});
 const refresh=()=>{void qc.invalidateQueries({queryKey:['resident-admin-rec',scope]});onChanged?.()};
 return <section className="sx-section">{staffCreate.includes(kind)&&<StaffForm key={scope+kind} kind={kind} l={l} buildingId={buildingId} refresh={refresh}/>}
 {q.isPending&&<div className="im-card sx-skel" aria-busy="true">{L(l,S.loading)}</div>}{q.isError&&<div className="im-notice" role="alert">{L(l,S.fail)} <button onClick={()=>q.refetch()}>{L(l,S.retry)}</button></div>}
 {q.data&&!q.data.items.length&&<div className="im-card im-empty"><p>{L(l,S.empty)}</p></div>}{q.data?.items.map(r=><AdminCard key={r.id} kind={kind} rec={r} l={l} scope={scope} buildingId={buildingId} refresh={refresh}/>)}</section>}
