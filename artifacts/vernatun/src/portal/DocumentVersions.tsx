import {useRef,useState,type FormEvent,type ReactNode} from 'react';
import {uploadDocumentVersion,uploadDocument} from './client';
import {isUncertain} from './finance-util';
import {ApiClientError} from './client';
async function boundedUpload<T>(work:Promise<T>):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([work,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new ApiClientError('connection',0)),35000)})])}
 finally{if(timer)clearTimeout(timer)}
}
import type {Language} from './i18n';
import type {RoleContext} from './types';
import {Fail,useMounted,useLoad,LoadFail,Empty,p6,fmt,g,type Row} from './phase6-ui';
import {p5} from './phase5-ui';

const MAX=6*1024*1024;
type Intent={key:string;id:string;query:URLSearchParams;file:File};
export default function DocumentsConsole({c,language:l}:{c:RoleContext;language:Language;legacy?:ReactNode}){
 const manage=c.permissions.includes('documents.manage');
 const list=useLoad<Row[]>('/documents',[c.id]);const [sel,setSel]=useState('');const doc=list.data?.find(d=>d.id===sel);
 const hist=useLoad<Row[]>(sel?'/documents/'+sel+'/versions':null,[c.id]);
 const blds=useLoad<Row[]>(manage?'/community/buildings':null,[c.id]),units=useLoad<Row[]>(manage?'/units':null,[c.id]),meets=useLoad<Row[]>(manage&&c.permissions.includes('meetings.read')?'/governance/meetings':null,[c.id]);
 const live=useMounted(),intent=useRef<Intent|null>(null),gen=useRef(0);const [pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false),[err,setErr]=useState<unknown>(),[bad,setBad]=useState('');
 const [f,setF]=useState({title:'',category:'',visibility:'staff',relatedType:'',relatedId:''});const fileRef=useRef<HTMLInputElement>(null);
 function pick(id:string){if(uncertain)return;setSel(id);const d=list.data?.find(x=>x.id===id);if(d)setF({title:d.title??'',category:d.category??'',visibility:d.visibility??'staff',relatedType:d.related_type??'',relatedId:d.related_id??''});setErr(undefined);setBad('')}
 async function fire(){const it=intent.current;if(!it||pending)return;setPending(true);const my=gen.current;
  try{await boundedUpload(uploadDocumentVersion(it.id,it.query,it.file));if(my!==gen.current)return;intent.current=null;if(live.current){setUncertain(false);setErr(undefined);if(fileRef.current)fileRef.current.value='';list.reload();hist.reload()}}
  catch(e){if(my!==gen.current)return;if(isUncertain(e)){if(live.current)setUncertain(true)}else{intent.current=null;if(live.current)setUncertain(false)}if(live.current)setErr(e)}
  finally{if(my===gen.current&&live.current)setPending(false)}}
 function submit(e:FormEvent){e.preventDefault();setBad('');if(!doc||pending)return;const file=fileRef.current?.files?.[0];
  if(!file||!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.type)){setBad(p6(l,'invalid'));return}if(file.size>MAX){setBad(p6(l,'tooBig'));return}
  if(f.title.trim().length<1||f.category.trim().length<1||(f.relatedType&&!f.relatedId)){setBad(p6(l,'invalid'));return}
  if(!intent.current){const key=crypto.randomUUID();const q=new URLSearchParams({key,version:String(doc.version),title:f.title.trim(),category:f.category.trim(),visibility:f.visibility});if(f.relatedType){q.set('relatedType',f.relatedType);q.set('relatedId',f.relatedId)}intent.current={key,id:doc.id,query:q,file}}
  void fire()}
 const related=f.relatedType==='building'?blds.data?.map(b=>({id:b.id,name:b.name})):f.relatedType==='unit'?units.data?.map(u=>({id:u.id,name:u.building_name+' · '+u.number})):f.relatedType==='meeting'?meets.data?.map(m=>({id:m.id,name:m.title})):[];
 const relName=(d:Row)=>d.related_type?p6(l,d.related_type)+' · '+String(d.related_id).slice(0,8):'—';
 const [nd,setNd]=useState({buildingId:'',unitId:'',title:'',category:'general',visibility:'staff',relatedType:'',relatedId:''});const nfile=useRef<HTMLInputElement>(null),nIntent=useRef<{file:File;query:URLSearchParams}|null>(null),nGen=useRef(0);const [nPend,setNPend]=useState(false),[nUnc,setNUnc]=useState(false),[nErr,setNErr]=useState<unknown>(),[nBad,setNBad]=useState('');
 async function nFire(){const it=nIntent.current;if(!it||nPend)return;setNPend(true);const my=nGen.current;
  try{await boundedUpload(uploadDocument(it.query,it.file));if(my!==nGen.current)return;nIntent.current=null;if(live.current){setNUnc(false);setNErr(undefined);if(nfile.current)nfile.current.value='';setNd({...nd,title:'',relatedId:''});list.reload()}}
  catch(e){if(my!==nGen.current)return;if(isUncertain(e)){if(live.current)setNUnc(true)}else{nIntent.current=null;if(live.current)setNUnc(false)}if(live.current)setNErr(e)}
  finally{if(my===nGen.current&&live.current)setNPend(false)}}
 function nSubmit(e:FormEvent){e.preventDefault();setNBad('');if(nPend)return;const file=nfile.current?.files?.[0];
  if(!file||!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.type)){setNBad(p6(l,'invalid'));return}if(file.size>MAX){setNBad(p6(l,'tooBig'));return}
  if(!nd.buildingId||!nd.title.trim()||!nd.category.trim()||(nd.relatedType&&!nd.relatedId)){setNBad(p6(l,'invalid'));return}
  if(!nIntent.current){const q=new URLSearchParams({key:crypto.randomUUID(),buildingId:nd.buildingId,title:nd.title.trim(),category:nd.category.trim(),visibility:nd.visibility});if(nd.unitId)q.set('unitId',nd.unitId);if(nd.relatedType){q.set('relatedType',nd.relatedType);q.set('relatedId',nd.relatedId)}nIntent.current={file,query:q}}
  void nFire()}
 const nRelated=nd.relatedType==='building'?blds.data?.map(b=>({id:b.id,name:b.name})):nd.relatedType==='unit'?units.data?.map(u=>({id:u.id,name:u.building_name+' · '+u.number})):nd.relatedType==='meeting'?meets.data?.map(m=>({id:m.id,name:m.title})):[];
 return <div className="p5"><div className="p5-split"><section className="p-card"><header><h2>{p6(l,'docsVersions')}</h2><button className="p-button small" onClick={list.reload}>{p6(l,'refresh')}</button></header>
  <LoadFail l={l} error={list.error} onRetry={list.reload}/>{!list.data&&!list.error?<p role="status">{p6(l,'loading')}</p>:list.data&&(list.data.length===0?<Empty l={l}/>:<div className="p6-scroll"><table><thead><tr><th>{p6(l,'title')}</th><th>{p6(l,'category')}</th><th>{p6(l,'related')}</th><th>{p6(l,'version')}</th></tr></thead><tbody>{list.data.map(d=><tr key={d.id} aria-selected={sel===d.id}><td><button className="p-button small" onClick={()=>pick(d.id)}>{d.title}</button></td><td>{d.category??'—'}</td><td>{relName(d)}</td><td className="p6-num">v{d.version??1}</td></tr>)}</tbody></table></div>)}</section>
  <div className="p5">{doc?<section className="p-card"><header><h2>{doc.title}</h2><a className="p-button small" href={'/api/documents/'+doc.id+'/download'} download>{p6(l,'download')} ↓</a></header>
   <h3>{p6(l,'history')}</h3><LoadFail l={l} error={hist.error} onRetry={hist.reload}/>{!hist.data&&!hist.error?<p role="status">{p6(l,'loading')}</p>:hist.data&&(hist.data.length===0?<Empty l={l}/>:<div className="p6-scroll"><table><thead><tr><th>{p6(l,'version')}</th><th>{p6(l,'title')}</th><th>{p6(l,'category')}</th><th>{p6(l,'visibility')}</th><th>{p6(l,'uploadedAt')}</th><th/></tr></thead><tbody>{hist.data.map(v=><tr key={v.id}><td className="p6-num">v{v.version_number}</td><td>{v.title}</td><td>{v.category??'—'}</td><td>{p6(l,v.visibility)}</td><td>{fmt(g(v,'uploaded_at'),l)}</td><td><a href={'/api/documents/'+doc.id+'/versions/'+v.id+'/download'} download>{p6(l,'download')} ↓</a></td></tr>)}</tbody></table></div>)}
   <p className="p5-muted">{p6(l,'versionNote')}</p></section>:<Empty l={l} text={p6(l,'docsVersions')}/>}
  {doc&&manage&&<form className="p-card p-edit-form" onSubmit={submit}><h3>{p6(l,'newVersion')} · v{(doc.version??1)+1}</h3>
   <label>{p6(l,'title')}<input required maxLength={200} disabled={uncertain} value={f.title} onChange={e=>setF({...f,title:e.target.value})}/></label>
   <label>{p6(l,'category')}<input required maxLength={80} disabled={uncertain} value={f.category} onChange={e=>setF({...f,category:e.target.value})}/></label>
   <label>{p6(l,'visibility')}<select disabled={uncertain} value={f.visibility} onChange={e=>setF({...f,visibility:e.target.value})}>{['staff','residents','unit_owner'].map(k=><option key={k} value={k}>{p6(l,k)}</option>)}</select></label>
   <div className="p5-grid2"><label>{p6(l,'related')}<select disabled={uncertain} value={f.relatedType} onChange={e=>setF({...f,relatedType:e.target.value,relatedId:''})}><option value="">—</option>{['building','unit',...(c.permissions.includes('meetings.read')?['meeting']:[])].map(k=><option key={k} value={k}>{p6(l,k)}</option>)}</select></label>
   {f.relatedType&&<label>{p6(l,'select')}<select required disabled={uncertain} value={f.relatedId} onChange={e=>setF({...f,relatedId:e.target.value})}><option value="">—</option>{related?.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}</div>
   <label>{p6(l,'file')}<input ref={fileRef} type="file" required disabled={uncertain} accept=".pdf,.png,.jpg,.jpeg,.webp"/></label>
   {bad&&<p className="p-error" role="alert">{bad}</p>}<Fail l={l} error={err} onRefresh={()=>{list.reload();hist.reload()}}/>
   {uncertain&&<div className="p5-frozen" role="alert"><strong>{p5(l,'uncertain')}</strong><div className="p5-row"><button type="button" className="p-button orange" disabled={pending} onClick={()=>void fire()}>{p5(l,'retrySame')}</button><button type="button" className="p-button" disabled={pending} onClick={()=>{gen.current++;intent.current=null;setUncertain(false);setPending(false);list.reload();hist.reload()}}>{p5(l,'abandon')}</button></div></div>}
   <button className="p-button orange" disabled={pending||uncertain}>{pending?p6(l,'saving'):p6(l,'newVersion')}</button></form>}</div></div>
  {manage&&<section className="p-card"><form className="p-edit-form" onSubmit={nSubmit}><h3>{p6(l,'newDoc')}</h3>
   <div className="p5-grid2"><label>{p6(l,'building')}<select required disabled={nUnc} value={nd.buildingId} onChange={e=>setNd({...nd,buildingId:e.target.value})}><option value="">—</option>{blds.data?.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
   <label>{p6(l,'unit')}<select disabled={nUnc} value={nd.unitId} onChange={e=>setNd({...nd,unitId:e.target.value})}><option value="">—</option>{units.data?.filter(u=>!nd.buildingId||u.building_id===nd.buildingId).map(u=><option key={u.id} value={u.id}>{u.number}</option>)}</select></label></div>
   <label>{p6(l,'title')}<input required maxLength={200} disabled={nUnc} value={nd.title} onChange={e=>setNd({...nd,title:e.target.value})}/></label>
   <div className="p5-grid2"><label>{p6(l,'category')}<input required maxLength={80} disabled={nUnc} value={nd.category} onChange={e=>setNd({...nd,category:e.target.value})}/></label>
   <label>{p6(l,'visibility')}<select disabled={nUnc} value={nd.visibility} onChange={e=>setNd({...nd,visibility:e.target.value})}>{['staff','residents','unit_owner'].map(k=><option key={k} value={k}>{p6(l,k)}</option>)}</select></label></div>
   <div className="p5-grid2"><label>{p6(l,'related')}<select disabled={nUnc} value={nd.relatedType} onChange={e=>setNd({...nd,relatedType:e.target.value,relatedId:''})}><option value="">—</option>{['building','unit',...(c.permissions.includes('meetings.read')?['meeting']:[])].map(k=><option key={k} value={k}>{p6(l,k)}</option>)}</select></label>
   {nd.relatedType&&<label>{p6(l,'select')}<select required disabled={nUnc} value={nd.relatedId} onChange={e=>setNd({...nd,relatedId:e.target.value})}><option value="">—</option>{nRelated?.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}</div>
   <label>{p6(l,'file')}<input ref={nfile} type="file" required disabled={nUnc} accept=".pdf,.png,.jpg,.jpeg,.webp"/></label>
   {nBad&&<p className="p-error" role="alert">{nBad}</p>}<Fail l={l} error={nErr}/>
   {nUnc&&<div className="p5-frozen" role="alert"><strong>{p5(l,'uncertain')}</strong><div className="p5-row"><button type="button" className="p-button orange" disabled={nPend} onClick={()=>void nFire()}>{p5(l,'retrySame')}</button><button type="button" className="p-button" disabled={nPend} onClick={()=>{nGen.current++;nIntent.current=null;setNUnc(false);setNPend(false);list.reload()}}>{p5(l,'abandon')}</button></div></div>}
   <button className="p-button orange" disabled={nPend||nUnc}>{nPend?p6(l,'saving'):p6(l,'create')}</button></form></section>}</div>}
