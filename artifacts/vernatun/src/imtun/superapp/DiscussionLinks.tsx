import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {getResidentDiscussionTarget} from '@workspace/api-client-react';
import type {ResidentRecord} from '@workspace/api-client-react';
import type {Language} from '../../portal/i18n';
import {L,S,statusLabel} from './text';
export default function DiscussionLinks({rec,l,scope,buildingId}:{rec:ResidentRecord;l:Language;scope:string;buildingId?:string}){
 const [target,setTarget]=useState<'request'|'proposal'>();
 const q=useQuery({queryKey:['discussion-target',scope,rec.id,target],enabled:!!target,queryFn:()=>getResidentDiscussionTarget(rec.id,target!,buildingId?{buildingId}:undefined),staleTime:0});
 if(rec.kind!=='discussions')return null;
 return <div className="sx-section">
  {rec.linkedRequestId&&<button className="sx-link" onClick={()=>setTarget('request')}>{L(l,['Բացել ստեղծված հայտը','Открыть созданную заявку','Open created request'])}</button>}
  {!!rec.data.proposalConversion&&<button className="sx-link" onClick={()=>setTarget('proposal')}>{L(l,['Բացել օրակարգի առաջարկը','Открыть предложение повестки','Open agenda proposal'])}</button>}
  {target&&<section className="im-card" aria-live="polite">
   {q.isPending&&<p>{L(l,S.loading)}</p>}{q.isError&&<p role="alert">{L(l,S.fail)} <button onClick={()=>q.refetch()}>{L(l,S.retry)}</button></p>}
    {q.data&&<><h4>{q.data.title}</h4><p>{q.data.meetingTitle}</p><p>{statusLabel[q.data.status]?L(l,statusLabel[q.data.status]):q.data.status}</p>{q.data.sourceExcerpt&&<div className="im-card"><strong>{L(l,['Մեջբերում քննարկումից','Фрагмент обсуждения','Excerpt from discussion'])}</strong><p>{q.data.sourceExcerpt}</p></div>}<small>ID: {q.data.id}</small>{target==='proposal'&&<p>{L(l,['Աջակցությունը իրավական քվե չէ։','Поддержка обсуждения не является юридическим голосованием.','Discussion support is not a legal vote.'])}</p>}</>}
   <button className="sx-link" onClick={()=>setTarget(undefined)}>{L(l,['Փակել','Закрыть','Close'])}</button>
  </section>}
 </div>;
}
