import {useState,type FormEvent} from 'react';
import type {Language} from './i18n';
import {Dlg,Fail,Frozen,useFrozen,useMounted,p6,type Row} from './phase6-ui';
import {useMe} from './phase5-ui';
/** Reopen an accepted defect. Rendered only for defects.accept holders who are not the defect's contractor. */
export default function DefectReopen({defect,permissions,language:l,onDone}:{defect:Row;permissions:string[];language:Language;onDone:()=>void}){
 const me=useMe(),live=useMounted(),h=useFrozen();const [open,setOpen]=useState(false),[note,setNote]=useState(''),[err,setErr]=useState<unknown>();
 if(defect.status!=='accepted'||!permissions.includes('defects.accept')||!me||(defect.contractor_id??defect.contractor_uid)===me)return null;
 const done=()=>{setOpen(false);setNote('');onDone()};
 async function go(e:FormEvent){e.preventDefault();if(h.pending)return;const n=note.trim();if(n.length<5)return;setErr(undefined);const id=defect.id,v=defect.version;
  try{const r=await h.send('POST','/defects/'+id+'/transition',key=>({key,version:v,action:'reopen',note:n}),()=>live.current);if(r!==undefined&&live.current)done()}catch(x){if(live.current)setErr(x)}}
 async function retry(){try{const r=await h.retry(()=>live.current);if(r!==undefined&&live.current)done()}catch(x){if(live.current)setErr(x)}}
 return <><button type="button" className="p-button" onClick={()=>{setErr(undefined);setOpen(true)}}>{p6(l,'reopenDefect')}</button>
  {open&&<Dlg l={l} title={p6(l,'reopenDefect')} onClose={()=>{if(!h.uncertain&&!h.pending)setOpen(false)}}><form className="p-edit-form" onSubmit={e=>void go(e)}><p className="p-info">{p6(l,'reopenInfo')}</p>
   <label>{p6(l,'reopenNote')}<textarea required minLength={5} maxLength={4000} disabled={h.uncertain} value={note} onChange={e=>setNote(e.target.value)}/></label>
   <Fail l={l} error={err} onRefresh={done}/><Frozen l={l} h={h} onRetry={()=>void retry()} onAbandon={()=>onDone()}/>
   <button className="p-button orange" disabled={h.pending||h.uncertain||note.trim().length<5}>{h.pending?p6(l,'saving'):p6(l,'reopenDefect')}</button></form></Dlg>}</>;
}
