import {useState,type FormEvent} from 'react';
import {createResidentRecord} from '@workspace/api-client-react';
import type {ResidentRecord} from '@workspace/api-client-react';
import type {Language} from '../../portal/i18n';
import {L} from './text';
import {LT} from './listingText';
import {useAct} from './useAct';
export default function ViewingForm({rec,l,refresh}:{rec:ResidentRecord;l:Language;refresh:()=>void}){
 const [open,setOpen]=useState(false),[at,setAt]=useState(''),[yes,setYes]=useState(false),[ok,setOk]=useState(''),[err,setErr]=useState(''),a=useAct(l,refresh);
 const submit=(e:FormEvent)=>{e.preventDefault();setErr('');setOk('');const t=new Date(at);if(!at||isNaN(t.getTime())||t.getTime()<=Date.now()||!yes)return setErr(L(l,LT.badNum));
  if(!confirm(L(l,LT.confirmSend)+'\n'+t.toLocaleString(l)))return;
  void a.run(async()=>{await createResidentRecord('conversations',{title:rec.title,body:'',parentId:rec.id,viewingAt:t.toISOString(),viewingConsent:true} as any);setOk(L(l,LT.sent));setOpen(false);setAt('');setYes(false)})};
 if(!open)return <>{ok&&<p role="status">{ok}</p>}<button className="im-button im-secondary" onClick={()=>{setOk('');setOpen(true)}}>{L(l,LT.reqView)}</button></>;
 return <form className="sx-form" onSubmit={submit}><label>{L(l,LT.when)}<input type="datetime-local" required value={at} onChange={e=>setAt(e.target.value)}/></label><label><input type="checkbox" checked={yes} onChange={e=>setYes(e.target.checked)}/> {L(l,LT.consent)}</label>
 <div className="sx-row"><button className="im-button" disabled={a.busy||!yes||!at}>{L(l,LT.reqView)}</button><button type="button" aria-label="close" className="im-button im-secondary" onClick={()=>setOpen(false)}>×</button></div>{(err||a.err)&&<p role="alert" className="sx-err">{err||a.err}</p>}</form>}
