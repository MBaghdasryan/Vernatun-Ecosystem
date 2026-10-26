import {useState,type FormEvent} from 'react';
import {useQuery} from '@tanstack/react-query';
import {actOnResidentRecord,getRequestCategories,listGovernanceMeetings} from '@workspace/api-client-react';
import type {ResidentRecord} from '@workspace/api-client-react';
import type {Language} from '../../portal/i18n';
import {L,S,actLabel} from './text';
import {useAct} from './useAct';

export default function DiscussionConversion({rec,l,buildingId,scope,action,done,refresh}:{rec:ResidentRecord;l:Language;buildingId:string;scope:string;action:'request'|'proposal';done:()=>void;refresh:()=>void}){
 const [selected,setSelected]=useState(''),[pct,setPct]=useState(''),[confirmed,setConfirmed]=useState(false);
 const a=useAct(l,refresh);
 const q=useQuery({queryKey:['discussion-conversion',scope,buildingId,action],queryFn:async()=>{
  if(action==='request')return (await getRequestCategories()).filter(x=>x.active).map(x=>({id:String(x.id),title:String(x.name),version:0}));
  return (await listGovernanceMeetings()).filter(x=>x.building_id===buildingId&&x.status==='draft').map(x=>({id:String(x.id),title:String(x.title),version:Number(x.version)}));
 }});
 const chosen=q.data?.find(x=>x.id===selected);
 const points=Math.round(Number(pct)*100);
 const submit=(e:FormEvent)=>{e.preventDefault();if(!chosen||!confirmed)return;
  void a.run(async()=>{
   await actOnResidentRecord('discussions',rec.id,{action,version:rec.version,conversion:{confirmed:true,...(action==='request'?{categoryId:chosen.id}:{meetingId:chosen.id,meetingVersion:chosen.version,passBasisPoints:points})}},{buildingId});
   done();
  });
 };
 return <form className="sx-form im-card" onSubmit={submit}>
  <h3>{L(l,actLabel[action])}</h3>
  <p>{action==='request'?L(l,['Ընդհանուր տարածքի համակարգային հայտ՝ առանց բնակչին վերագրելու։','Системная заявка по общей зоне без назначения жителя автором.','A system common-area request, not attributed to a resident.']):L(l,['Ավելացնել գործող ժողովի սևագրին։ Աջակցությունը քվե չէ․ քվեարկությունը չի հրապարակվում։','Добавить в черновую повестку существующего собрания. Поддержка темы — не голос; голосование не публикуется.','Add to an existing meeting draft. Topic support is not a vote; voting is not published.'])}</p>
  {q.isPending&&<p role="status">{L(l,S.loading)}</p>}
  {q.isError&&<p role="alert">{L(l,S.fail)} <button type="button" onClick={()=>q.refetch()}>{L(l,S.retry)}</button></p>}
  <label>{L(l,action==='request'?['Կատեգորիա','Категория заявки','Request category']:['Ժողովի սևագիր','Черновик собрания','Meeting draft'])}
   <select required value={selected} disabled={a.busy} onChange={e=>setSelected(e.target.value)}><option value="">—</option>{q.data?.map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</select></label>
  {q.data?.length===0&&<p>{L(l,S.empty)}</p>}
  {action==='proposal'&&<><p>{L(l,['Տարբերակներ՝ այո / ոչ / ձեռնպահ։ Ընդունող տարբերակ՝ այո։','Варианты: да / нет / воздержался. Принимающий вариант: да.','Options: yes / no / abstain. Passing option: yes.'])}</p><label>{L(l,['Ընդունման շեմ (%)','Порог принятия (%)','Passing threshold (%)'])}<input required type="number" min="0.01" max="100" step="0.01" value={pct} disabled={a.busy} onChange={e=>setPct(e.target.value)}/></label></>}
  <label className="sx-check"><input type="checkbox" checked={confirmed} disabled={a.busy} onChange={e=>setConfirmed(e.target.checked)}/>{L(l,['Հաստատում եմ ստեղծումը','Подтверждаю создание объекта','I confirm creation of this object'])}</label>
  <div className="sx-row"><button className="im-button" disabled={a.busy||!chosen||!confirmed||(action==='proposal'&&(!Number.isFinite(points)||points<1||points>10000))}>{L(l,actLabel[action])}</button><button type="button" className="im-button im-secondary" disabled={a.busy} onClick={done}>{L(l,actLabel.cancel)}</button></div>
  {a.err&&<p role="alert" className="sx-err">{a.err}</p>}
 </form>;
}
