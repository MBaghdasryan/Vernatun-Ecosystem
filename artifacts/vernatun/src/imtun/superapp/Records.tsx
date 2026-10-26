import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {getResidentRecords} from '@workspace/api-client-react';
import type {ResidentRecordKind} from '@workspace/api-client-react';
import type {RoleContext} from '../../portal/types';
import type {Language} from '../../portal/i18n';
import {L,S,kindName,always,creatable} from './text';
import RecordCard from './RecordCard';
import CreateForm from './CreateForm';
export default function Records({kind,l,c,caps}:{kind:ResidentRecordKind;l:Language;c:RoleContext;caps?:Record<string,boolean>}){
 const qc=useQueryClient(),[search,setSearch]=useState(''),key=['resident-rec',c.id,kind,search];
 const enabled=always.includes(kind)||caps?.[kind]===true,q=useQuery({queryKey:key,enabled,queryFn:()=>getResidentRecords(kind,search?{search}:undefined)});
 const refresh=()=>{void qc.invalidateQueries({queryKey:['resident-rec',c.id]})};
 return <section className="sx-section"><div className="im-section-title"><h2>{L(l,kindName[kind])}</h2></div>
 {!enabled&&<div className="im-card im-empty"><p>{L(l,S.off)}</p></div>}
 {enabled&&<>{!['contacts','help','agreements'].includes(kind)&&<input className="sx-search" aria-label={L(l,S.search)} placeholder={L(l,S.search)} value={search} onChange={e=>setSearch(e.target.value)}/>}
 {creatable.includes(kind)&&kind!=='subscriptions'&&<CreateForm kind={kind} l={l} refresh={refresh}/>}
 {q.isPending&&<div className="im-card sx-skel" aria-busy="true">{L(l,S.loading)}</div>}
 {q.isError&&<div className="im-notice" role="alert">{L(l,S.fail)} <button onClick={()=>q.refetch()}>{L(l,S.retry)}</button></div>}
 {q.data&&!q.data.items.length&&<div className="im-card im-empty"><p>{L(l,S.empty)}</p></div>}
 {q.data?.items.map(r=><div key={r.id}><RecordCard kind={kind} rec={r} l={l} c={c} refresh={refresh}/>{kind==='services'&&caps?.subscriptions===true&&<div className="sx-row"><CreateForm kind="subscriptions" l={l} parent={r} label={S.order} refresh={refresh}/></div>}</div>)}</>}</section>}
