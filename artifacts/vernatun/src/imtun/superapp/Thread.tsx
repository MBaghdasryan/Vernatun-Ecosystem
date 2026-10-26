import {useState,type FormEvent} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {getResidentMessages,postResidentMessage} from '@workspace/api-client-react';
import type {ResidentRecord,ResidentRecordKind} from '@workspace/api-client-react';
import type {RoleContext} from '../../portal/types';
import type {Language} from '../../portal/i18n';
import {L,S} from './text';
import {useAct} from './useAct';
export default function Thread({kind,rec,l,c}:{kind:ResidentRecordKind;rec:ResidentRecord;l:Language;c:RoleContext}){
 const qc=useQueryClient(),key=['resident-msg',c.id,kind,rec.id],q=useQuery({queryKey:key,queryFn:()=>getResidentMessages(kind,rec.id)});
 const [text,setText]=useState(''),[cid,setCid]=useState(()=>crypto.randomUUID()),a=useAct(l,()=>{void qc.invalidateQueries({queryKey:key})});
 const send=(e:FormEvent)=>{e.preventDefault();const body=text.trim();if(!body)return;void a.run(async()=>{await postResidentMessage(kind,rec.id,{body,clientId:cid});setText('');setCid(crypto.randomUUID())})};
 return <div className="sx-thread"><h4>{L(l,S.msgs)}</h4>{q.isPending&&<p>{L(l,S.loading)}</p>}{q.isError&&<p role="alert">{L(l,S.fail)} <button className="sx-link" onClick={()=>q.refetch()}>{L(l,S.retry)}</button></p>}{q.data?.map(m=><div key={m.id} className={'sx-msg '+(m.own?'own':'')}><small>{m.sender} · {new Date(m.createdAt).toLocaleString(l)}</small><p>{m.body}</p></div>)}{q.data&&!q.data.length&&<p>{L(l,S.empty)}</p>}
 <form onSubmit={send} className="sx-inline"><input aria-label={L(l,S.msg)} value={text} maxLength={5000} onChange={e=>setText(e.target.value)} placeholder={L(l,S.msg)}/><button className="im-button" disabled={a.busy||!text.trim()}>{L(l,S.send)}</button></form>{a.err&&<p role="alert" className="sx-err">{a.err}</p>}</div>}
