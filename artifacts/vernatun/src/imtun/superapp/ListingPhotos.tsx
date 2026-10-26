import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {getResidentListingPhoto,uploadResidentListingPhoto,deleteResidentListingPhoto} from '@workspace/api-client-react';
import type {ResidentRecord} from '@workspace/api-client-react';
import type {Language} from '../../portal/i18n';
import {L,S} from './text';
import {LT} from './listingText';
import {useAct} from './useAct';
const OK=['image/jpeg','image/png','image/webp'],MAX=6*1024*1024;
function Photo({rec,id,c,l,onDelete,busy,buildingId}:{rec:ResidentRecord;id:string;c:{id:string};l:Language;onDelete?:()=>void;busy:boolean;buildingId?:string}){
 const [large,setLarge]=useState(false);
 const q=useQuery({queryKey:['resident-photo',c.id,buildingId,rec.id,id],queryFn:()=>getResidentListingPhoto(rec.id,id,buildingId?{buildingId}:undefined),staleTime:300000});
 const [url,setUrl]=useState('');
 useEffect(()=>{
  if(!q.data){setUrl('');return}
  // Create and release in the same effect: StrictMode's setup/cleanup replay
  // must not revoke a URL retained by a render-time memo.
  const next=URL.createObjectURL(q.data);setUrl(next);
  return ()=>URL.revokeObjectURL(next);
 },[q.data]);
 return <figure className="sx-photo" style={{margin:0,position:'relative',width:large?'min(640px, 100%)':120,maxWidth:'100%',flexShrink:0}}>{url?<button type="button" aria-label={L(l,LT.details)} aria-expanded={large} onClick={()=>setLarge(!large)} style={{border:0,padding:0,background:'transparent',width:'100%',maxWidth:'100%'}}><img src={url} alt={rec.title} style={{width:'100%',maxWidth:'100%',height:large?'auto':90,maxHeight:large?'70vh':90,objectFit:'contain',borderRadius:8}}/></button>:q.isError?<button type="button" className="im-button im-secondary" onClick={()=>q.refetch()}>{L(l,S.retry)}</button>:<div className="sx-skel" style={{width:120,height:90,borderRadius:8}} aria-busy={q.isPending}/>}
 {onDelete&&<button type="button" className="im-button im-secondary" disabled={busy} aria-label={L(l,LT.delPhoto)} onClick={onDelete}>×</button>}</figure>}
export default function ListingPhotos({rec,c,l,refresh,buildingId}:{rec:ResidentRecord;c:{id:string};l:Language;refresh:()=>void;buildingId?:string}){
 const a=useAct(l,refresh),[ok,setOk]=useState(''),[localErr,setLocalErr]=useState(''),ids=rec.photos??[],editable=rec.actions.includes('edit')&&['draft','rejected'].includes(rec.status),ref=useRef<HTMLInputElement>(null);
 const pick=(files:FileList|null)=>{setOk('');setLocalErr('');if(!files?.length)return;const list=Array.from(files);
  if(ids.length+list.length>10)return setLocalErr(L(l,LT.tooMany));
  if(list.some(f=>!OK.includes(f.type)||f.size>MAX||f.size===0))return setLocalErr(L(l,LT.badFile));
  void a.run(async()=>{let v=rec.version;for(const f of list){const r=await uploadResidentListingPhoto(rec.id,f,{version:v});v=r.version}setOk(L(l,LT.uploaded))});if(ref.current)ref.current.value=''};
 const del=(pid:string)=>{if(!confirm(L(l,S.confirm)))return;setOk('');void a.run(async()=>{await deleteResidentListingPhoto(rec.id,pid,{version:rec.version});setOk(L(l,LT.removed))})};
 if(!ids.length&&!editable)return null;
 return <div className="sx-form"><h4>{L(l,LT.photos)} ({ids.length}/10)</h4>
 <div className="sx-row">{ids.map(id=><Photo key={id} rec={rec} id={id} c={c} l={l} buildingId={buildingId} busy={a.busy} onDelete={editable?()=>del(id):undefined}/>)}{!ids.length&&<small>{L(l,LT.noPhotos)}</small>}</div>
 {editable&&<><input ref={ref} type="file" multiple accept={OK.join(',')} aria-label={L(l,LT.upload)} disabled={a.busy||ids.length>=10} onChange={e=>pick(e.target.files)}/><small>{L(l,LT.photoRules)}</small></>}
 {ok&&<p role="status">{ok}</p>}{(localErr||a.err)&&<p role="alert" className="sx-err">{localErr||a.err}</p>}</div>}
