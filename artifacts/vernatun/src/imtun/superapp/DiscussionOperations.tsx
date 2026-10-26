import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {request} from '../../portal/client';
import type {RoleContext} from '../../portal/types';
import type {Language} from '../../portal/i18n';
import {L,S} from './text';
import AdminRecords from './AdminRecords';
import './admin.css';

export default function DiscussionOperations({c,l,onChanged}:{c:RoleContext;l:Language;onChanged:()=>void}){
 const [pick,setPick]=useState('');
 const q=useQuery({queryKey:['discussion-buildings',c.id],queryFn:()=>request<{id:string;name:string}[]>('/community/buildings')});
 const buildingId=c.building_id||pick||q.data?.[0]?.id||'';
 return <section className="sx-root sx-admin">
  <h3>{L(l,['Բնակիչների քննարկումներ','Обсуждения жителей','Resident discussions'])}</h3>
  {q.isPending&&<p>{L(l,S.loading)}</p>}{q.isError&&<p role="alert">{L(l,S.fail)} <button onClick={()=>q.refetch()}>{L(l,S.retry)}</button></p>}
  <label>{L(l,['Շենք','Здание','Building'])}<select value={buildingId} onChange={e=>setPick(e.target.value)}>
   {(q.data??[]).filter(b=>!c.building_id||b.id===c.building_id).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
  </select></label>
  {buildingId&&<AdminRecords key={c.id+buildingId} kind="discussions" l={l} scope={c.id+buildingId} buildingId={buildingId} onChanged={onChanged}/>}
 </section>;
}
