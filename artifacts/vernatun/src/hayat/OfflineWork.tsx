import {useEffect,useRef,useState} from 'react';
import type {Language} from '../portal/i18n';
import type {RoleContext} from '../portal/types';
import {ApiClientError,request,syncPhoto,syncTransition,verifySyncScope} from '../portal/client';
import {get,identity,sameScope,update,workKey,type Draft,type LocalWork,type Pending,type Scope,type Work} from './offline-store';
import {offlineText} from './offline-i18n';
import {prepareOfflineShell} from './offline-shell';
import {ht} from './i18n';

export default function OfflineWork({id,c,userId,language,kind='requests',changed=()=>{}}:{
 id:string;c:RoleContext;userId:string;language:Language;kind?:'requests'|'defects';changed?:()=>void;
}){
 const t=(key:string)=>offlineText(language,key);
 const label=(key:string)=>kind==='defects'?ht(language,key):t(key);
 const scope:Scope={userId,contextId:c.id},key=workKey(scope,kind,id);
 const [local,setLocal]=useState<LocalWork>(),[live,setLive]=useState<Work>();
 const [error,setError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const [saving,setSaving]=useState(0),[offline,setOffline]=useState(!navigator.onLine),[blocked,setBlocked]=useState(false);
 const ref=useRef<LocalWork|undefined>(undefined),alive=useRef(true),writes=useRef<Promise<unknown>>(Promise.resolve()),sending=useRef(false);
 const storageFailed=useRef(false);
 const state=local?.snapshot.work_status??local?.snapshot.status;
 const permission=c.permissions.includes(kind==='requests'?'workorders.execute':'defects.execute');
 const conflict=!!local&&!!live&&local.draft.version!==live.version;
 const photoConflict=!!local&&!!live&&local.photos.some(p=>!p.attempted&&p.version!==live.version);
 const adopt=(v:LocalWork)=>{ref.current=v;if(alive.current)setLocal(v)};
 function failure(e:unknown){
  const code=e instanceof ApiClientError?e.code:'error';
  if(alive.current)setError(['stale_version','idempotency_conflict'].includes(code)?'conflict':
   e instanceof ApiClientError&&[401,403,404].includes(e.status)?'blocked':'error');
  if(e instanceof ApiClientError&&[401,403,404].includes(e.status)){
   setBlocked(true);
  }
 }
 function persist(change:(old:LocalWork)=>LocalWork){
  if(!ref.current)return Promise.reject(new Error('not_loaded'));
  const base=ref.current,next=change(base);adopt(next);setSaving(n=>n+1);
  const write=writes.current.then(()=>update<LocalWork>(key,old=>storageFailed.current?next:change(old??base)));
  writes.current=write.catch(()=>{});
  return write.then(()=>{storageFailed.current=false;if(alive.current)setStatus('saved')}).catch(e=>{
   storageFailed.current=true;if(alive.current)setError('storage');throw e;
  }).finally(()=>{if(alive.current)setSaving(n=>n-1)});
 }
 async function load(){
  try{
   let d=await request<Work>(`/${kind}/${id}`);
   if(!alive.current||!sameScope(scope,identity()))return;
   await writes.current;
   const old=await get<LocalWork>(key);
   // A cached GET after a lost connection must not roll back a transition
   // whose server receipt was already confirmed on this device.
   if(old&&old.snapshot.version>d.version)d=old.snapshot;
   setLive(d);
   const initial:LocalWork=old?{...old,snapshot:d}:{snapshot:d,draft:emptyDraft(d),photos:[],savedAt:Date.now()};
   // Import a legacy manual text/checklist draft only for its current owner context.
   if(!old&&kind==='requests'){
    const legacy=localStorage.getItem(`vernatun.draft.${c.id}.${id}`);
    if(legacy){try{
     const v=JSON.parse(legacy);
     if(typeof v.note==='string'&&Array.isArray(v.checklist)&&Number.isInteger(v.version))
      initial.draft={note:v.note,checklist:v.checklist,version:v.version,key:v.key??crypto.randomUUID()};
    }catch{/* Keep malformed legacy bytes; never silently delete a draft. */}}
   }
   await update<LocalWork>(key,current=>{
    if(!current)return initial;
    const snapshot=current.snapshot.version>d.version?current.snapshot:d;
    return {...current,snapshot,
     ...(!current.pending&&!current.photos.length&&!current.draft.note&&JSON.stringify(current.draft.checklist)===JSON.stringify(current.snapshot.checklist??[])?{draft:emptyDraft(snapshot)}:{})};
   });
   if(alive.current){adopt((await get<LocalWork>(key))!);setBlocked(false)}
  }catch(e){failure(e)}
 }
 function emptyDraft(d:Work):Draft{
  return {note:'',checklist:d.checklist??[],version:d.version,key:crypto.randomUUID()};
 }
 useEffect(()=>{
  alive.current=true;
  const net=()=>setOffline(!navigator.onLine);
  const cached=()=>setOffline(true);
  const auth=()=>{
   if(!sameScope(scope,identity())){setBlocked(true);setError('blocked');setLocal(undefined);ref.current=undefined}
  };
  window.addEventListener('online',net);window.addEventListener('offline',net);
  window.addEventListener('storage',auth);window.addEventListener('hayat-identity',auth);
  window.addEventListener('hayat-offline-cache',cached);
  void load();
  void prepareOfflineShell().catch(()=>{if(alive.current&&navigator.onLine)setError('shellError')});
  return()=>{alive.current=false;window.removeEventListener('online',net);window.removeEventListener('offline',net);
   window.removeEventListener('storage',auth);window.removeEventListener('hayat-identity',auth);window.removeEventListener('hayat-offline-cache',cached)};
 },[key]);
 useEffect(()=>{
  const warn=(event:BeforeUnloadEvent)=>{
   if(saving||storageFailed.current){event.preventDefault();event.returnValue=''}
  };
  window.addEventListener('beforeunload',warn);
  return()=>window.removeEventListener('beforeunload',warn);
 },[saving]);
 const edit=(change:(v:LocalWork)=>LocalWork)=>{setError('');void persist(v=>({...change(v),savedAt:Date.now()})).catch(()=>{})};
 async function synchronize(action?:'start'|'report'){
  if(sending.current||blocked||!permission||!ref.current)return;
  if(storageFailed.current){setError('storage');return}
  sending.current=true;setBusy(true);setError('');setStatus('');
  const run=async()=>{
   await writes.current;
   if(storageFailed.current)throw new Error('storage_unavailable');
   // Each click revalidates the real session and server permissions. Reconnect
   // alone never sends data; no background sync can outlive logout.
   await verifySyncScope(scope);
   let v=(await get<LocalWork>(key))!;
   if(action&&!v.pending){
    if(live&&v.draft.version!==live.version)throw new ApiClientError('stale_version',409);
    const pending:Pending={key:v.draft.key,action,version:v.draft.version,note:v.draft.note,
     ...(kind==='requests'&&action==='report'?{checklist:v.draft.checklist}:{})};
    await persist(old=>({...old,pending,pendingFailure:undefined}));
    v=(await get<LocalWork>(key))!;
   }
   for(const photo of v.photos){
    await verifySyncScope(scope);
    const version=photo.version??v.draft.version;
    // Freeze the photo's expected version BEFORE the request. Rebasing a text
    // draft must not change the fingerprint of an ambiguous photo attempt.
    await persist(old=>({...old,photos:old.photos.map(p=>p.key===photo.key?{...p,version,attempted:true}:p)}));
    try{await syncPhoto(scope,kind,id,photo.file,photo.key,version)}
    catch(e){
     if(e instanceof ApiClientError&&e.code==='stale_version'){
      await persist(old=>({...old,photos:old.photos.map(p=>p.key===photo.key?{...p,attempted:false}:p)}));
     }
     throw e;
    }
    await persist(old=>({...old,photos:old.photos.filter(p=>p.key!==photo.key)}));
   }
   if(v.pending){
    await verifySyncScope(scope);
    const result=await syncTransition(scope,kind,id,v.pending);
    const snapshot=result.version<v.snapshot.version?v.snapshot:{...v.snapshot,...result,
     ...(v.pending.action==='report'?{report:v.pending.note,...(v.pending.checklist?{checklist:v.pending.checklist}:{})}:{})};
    await persist(old=>({...old,pending:undefined,pendingFailure:undefined,
     snapshot,draft:emptyDraft(snapshot)}));
   }
   setOffline(false);setStatus('sent');await load();changed();
  };
  try{
   if(navigator.locks)await navigator.locks.request(key,{ifAvailable:true},async lock=>{
    if(!lock)throw new Error('sync_in_another_tab');await run();
   });else await run();
  }catch(e){
   if(e instanceof ApiClientError&&[400,409].includes(e.status)){
    await persist(v=>({...v,pendingFailure:e.code})).catch(()=>{});
    if(e.code==='stale_version')await load();
   }
   if(storageFailed.current)setError('storage');else failure(e);
  }finally{sending.current=false;if(alive.current)setBusy(false)}
 }
 async function addPhoto(file:File){
  if(file.size>6*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type)){setError('invalidPhoto');return}
  edit(v=>({...v,photos:[...v.photos,{key:crypto.randomUUID(),file,version:v.draft.version}]}));
 }
 async function discard(){
  if(!local||!window.confirm(t('confirmDiscard')))return;
  await persist(v=>({...v,draft:emptyDraft(v.snapshot),photos:[],pending:undefined,pendingFailure:undefined})).catch(()=>{});
 }
 const d=local?.snapshot;
 const disabled=busy||!!local?.pending||blocked||!permission;
 return <section className={kind==='defects'?'h-defect-detail h-work-card':'p-card'}>
  {error&&<div className="p-error" role="alert">{t(error)}</div>}
  {offline&&<p className="p-info" role="status">{t('offline')}</p>}
  {blocked?<p>{t('blocked')}</p>:!d||!local?<p role="status">{t('loading')}</p>:<>
   <header><h2>{d.subject}</h2><span className={kind==='defects'?'h-badge h-status-'+state:'p-badge'}>{label(state)}</span></header>
   {kind==='defects'&&<p>{d.building_name} · {d.number} · {d.location}</p>}
   <p>{d.description}</p>{d.report&&<blockquote>{d.report}</blockquote>}
   <form className="p-edit-form" onSubmit={e=>{e.preventDefault();void synchronize(state==='assigned'?'start':'report')}}>
    {local.draft.checklist.map((item,i)=><label className="p-check-item" key={i}>
     <input type="checkbox" checked={item.done} disabled={disabled||state!=='in_progress'}
      onChange={e=>{const done=e.target.checked;edit(v=>({...v,draft:{...v.draft,checklist:v.draft.checklist.map((x,n)=>n===i?{...x,done}:x)}}))}}/>{item.text}
    </label>)}
    {(state==='in_progress'||local.draft.note||local.pending)&&<label>{kind==='defects'?label('description'):t('note')}
     <textarea name="note" minLength={5} maxLength={4000} required value={local.draft.note} disabled={disabled}
      onChange={e=>{const note=e.target.value;edit(v=>({...v,draft:{...v.draft,note}}))}}/>
    </label>}
    <p role="status">{t(saving?'saving':status||'saved')}</p>
    {local.pending&&<p role="status">{t('pending')}</p>}
    {local.pendingFailure&&<button type="button" className="p-button" disabled={busy} onClick={()=>edit(v=>({...v,pending:undefined,pendingFailure:undefined,draft:{...v.draft,key:crypto.randomUUID()}}))}>{t('editDraft')}</button>}
    {(conflict||photoConflict)&&<div className="p-error" role="alert"><p>{t('conflict')}</p>
     <p>{t('note')}: {live?.report??'—'}</p>
     {live&&(live.work_status??live.status)==='in_progress'&&!local.pending&&<button type="button" className="p-button" disabled={busy||offline}
      onClick={()=>edit(v=>({...v,photos:v.photos.map(p=>p.attempted?p:{...p,version:live.version,key:crypto.randomUUID()}),draft:{...v.draft,version:live.version,key:crypto.randomUUID(),
       checklist:(live.checklist??[]).map((item:{text:string;done:boolean})=>({...item,done:v.draft.checklist.find(x=>x.text===item.text)?.done??item.done}))}}))}>{t('compare')}</button>}
    </div>}
    {['assigned','in_progress'].includes(state)&&!local.pending&&<button className={kind==='defects'?'h-primary':'p-button orange'} disabled={busy||saving>0||offline||blocked||conflict||!permission||!!d.paused_at||!!d.blocked_reason||(state==='assigned'&&!!d.category_id&&!d.accepted_at)}>
     {label(state==='assigned'?'start':kind==='defects'?'submitReview':'report')}</button>}
    <div className="p-modal-actions" style={{flexWrap:'wrap',minWidth:0,maxWidth:'100%'}}>
     <button type="button" className="p-button" disabled={busy||saving>0||offline||blocked||!permission}
      onClick={()=>void synchronize()}>{t('sync')}</button>
     <button type="button" className="p-button" disabled={busy} onClick={()=>void discard()}>{t('discard')}</button>
     <button type="button" className="p-button" disabled={busy||saving>0} onClick={()=>{setError('');void load()}}>{t('refresh')}</button>
    </div>
   </form>
   <h3>{t('photos')}</h3>
   {!['closed','accepted'].includes(state)&&permission&&<input type="file" aria-label={t('photos')} accept="image/jpeg,image/png,image/webp" multiple disabled={disabled}
    onChange={e=>{for(const file of Array.from(e.target.files??[]))void addPhoto(file);e.target.value=''}}/>}
   <div className={kind==='defects'?'h-photo-grid':'p-photo-links'}>{(d.photos??[]).map((p:{id:string},i:number)=>kind==='defects'
    ?<a key={p.id} href={`/api/defect-photos/${p.id}`} target="_blank" rel="noreferrer"><img src={`/api/defect-photos/${p.id}`} alt={d.subject}/></a>
    :<a className="p-button" key={p.id} href={`/api/photos/${p.id}`} download>{t('photos').split(' (')[0]} {i+1} ↓</a>)}</div>
   <ul>{local.photos.map(p=><li key={p.key}>{p.file.name} · {t('queued')} <button type="button" className="p-button" disabled={disabled}
    onClick={()=>edit(v=>({...v,photos:v.photos.filter(x=>x.key!==p.key)}))}>{t('remove')}</button></li>)}</ul>
   {kind==='requests'&&<>
    <h3>{t('message')}</h3>{(d.messages??[]).map((m:Work)=><div className="p-message" key={m.id}><strong>{m.author} {m.internal?'· '+t('internal'):''}</strong><p>{m.body}</p></div>)}
    <form className="p-edit-form" onSubmit={async e=>{
     e.preventDefault();const form=e.currentTarget,data=new FormData(form);
     try{await verifySyncScope(scope);await request(`/requests/${id}/messages`,'POST',{body:data.get('body'),internal:data.get('internal')==='on'});form.reset();await load()}catch(e){failure(e)}
    }}><textarea name="body" aria-label={t('message')} required maxLength={4000}/>
     <label className="p-check-item"><input name="internal" type="checkbox"/>{t('internal')}</label>
     <button className="p-button" disabled={busy||offline||blocked}>{t('send')}</button>
    </form>
   </>}
   <h3>{t('history')}</h3>{(d.history??[]).map((h:Work)=><div className="p-history" key={h.id}>
    <strong>{t(h.action)} · {h.actor}</strong><small>{new Date(h.created_at).toLocaleString(language,{timeZone:'Asia/Yerevan'})} · {t(h.to_status??'')}</small><p>{h.note}</p>
   </div>)}
  </>}
 </section>;
}
