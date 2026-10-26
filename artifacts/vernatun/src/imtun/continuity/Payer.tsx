import {useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {createPayerResponsibility,getPayerResponsibilities,getResidentPayerPolicy,reviewPayerResponsibility,updateResidentPayerPolicy} from '@workspace/api-client-react';
import type {PayerResponsibility,PayerServicePolicy} from '@workspace/api-client-react';
import type {RoleContext} from '../../portal/types';
import type {Language} from '../../portal/i18n';
import {ReauthPrompt,reauthDone} from '../../portal/Reauth';
import {useAct} from '../superapp/useAct';
import {tt,needsReauth} from './core';
import './continuity.css';
const stl=(l:Language,s:string)=>s==='pending'?tt(l,'Սպասում է','Ожидает ответа','Awaiting reply'):s==='accepted'?tt(l,'Ընդունված','Принято','Accepted'):s==='declined'?tt(l,'Մերժված','Отклонено','Declined'):tt(l,'Չեղարկված','Отозвано','Revoked');
const per=(v:string)=>v.slice(0,7);
const money=(l:Language,m:string,c:string)=>(Number(m)/100).toLocaleString(l)+' '+c;
export default function Payer({c,l}:{c:RoleContext;l:Language}){
 const qc=useQueryClient(),key=['resident-payer',c.id],q=useQuery({queryKey:key,queryFn:()=>getPayerResponsibilities()});
 const a=useAct(l,()=>{void qc.invalidateQueries({queryKey:key})});
 const [need,setNeed]=useState(false),[notice,setNotice]=useState(''),[asg,setAsg]=useState(''),[rec,setRec]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const cid=useRef(crypto.randomUUID());
 const guard=(fn:()=>Promise<unknown>)=>{setNotice('');void a.run(async()=>{try{await fn();setNeed(false)}catch(e){if(needsReauth(e)){setNeed(true);return}throw e}})};
 if(q.isPending)return <div className="im-card sx-skel" aria-busy="true">…</div>;
 if(q.isError||!q.data)return <div className="im-notice" role="alert">{tt(l,'Վճարողի պատասխանատվությունը չբեռնվեց։','Не удалось загрузить ответственность плательщика.','Could not load payer responsibility.')} <button onClick={()=>q.refetch()}>{tt(l,'Կրկնել','Повторить','Retry')}</button></div>;
 const w=q.data,usable=w.assignments.filter(x=>x.enabled),start=from||per(w.nextPeriod);
 const okRange=start>=per(w.nextPeriod)&&(!to||to>=start);
 const act=(x:PayerResponsibility,action:'accept'|'decline'|'revoke')=>{if(action==='revoke'&&!confirm(tt(l,'Չեղարկե՞լ ապագա ժամանակաշրջանները։','Отозвать будущие периоды?','Revoke the future periods?')))return;guard(()=>reviewPayerResponsibility(x.id,{action,version:x.version}))};
 return <section className="im-card sx-form" aria-labelledby="cx-payer"><h3 id="cx-payer">{tt(l,'Վճարողի պատասխանատվություն','Ответственность плательщика','Payer responsibility')}</h3>
 <small>{tt(l,'Սա չի տեղափոխում գումար և սեփականություն։ Ընդունված կանոնը գործում է միայն մինչև ստացողը պիտանի է և ծառայությունը միացված է․ արդեն հաշվարկված ժամանակաշրջանները չեն փոխվում։','Это не перевод денег и не смена собственника. Принятое правило действует, пока получатель имеет право, а категория включена компанией; уже выставленные периоды не переносятся.','This moves no money and no ownership. An accepted rule applies only while the recipient stays eligible and the company keeps the category enabled; periods already billed never move.')}</small>
 {need&&<ReauthPrompt language={l} onCancel={()=>setNeed(false)} onDone={()=>{setNeed(false);setNotice(reauthDone(l))}}/>}{notice&&<p role="status">{notice}</p>}
 {w.canPropose&&<form className="sx-form" onSubmit={e=>{e.preventDefault();guard(async()=>{await createPayerResponsibility({payerAssignmentId:asg,recipientId:rec,startsOn:start+'-01',...(to?{endsOn:to+'-01'}:{}),clientId:cid.current});cid.current=crypto.randomUUID();setAsg('');setRec('');setFrom('');setTo('')})}}><h4>{tt(l,'Առաջարկել ապագա ամիսներ','Предложить будущие месяцы','Propose future months')}</h4>
 <label>{tt(l,'Ծառայություն','Услуга','Service')}<select required value={asg} onChange={e=>setAsg(e.target.value)}><option value="">—</option>{usable.map(x=><option key={x.id} value={x.id}>{x.serviceName}</option>)}</select></label>
 {!usable.length&&<small>{tt(l,'Ընկերությունը դեռ չի միացրել ծառայություն։','Компания пока не включила ни одной категории.','The company has not enabled any category yet.')}</small>}
 <label>{tt(l,'Ստացող','Получатель','Recipient')}<select required value={rec} onChange={e=>setRec(e.target.value)}><option value="">—</option>{w.recipients.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
 {!w.recipients.length&&<small>{tt(l,'Նույն բնակարանում ակտիվ վարձակալ կամ ընտանիքի անդամ չկա։','В этой квартире нет активного арендатора или члена семьи.','No active renter or family member in this unit.')}</small>}
 <label>{tt(l,'Սկսած (ամիս)','С месяца','From month')}<input type="month" required min={per(w.nextPeriod)} value={start} onChange={e=>setFrom(e.target.value)}/></label>
 <label>{tt(l,'Մինչև (ներառյալ, ըստ ցանկության)','По месяц включительно (необязательно)','Until month, inclusive (optional)')}<input type="month" min={start} value={to} onChange={e=>setTo(e.target.value)}/></label>
 <button className="im-button" disabled={a.busy||!asg||!rec||!okRange}>{tt(l,'Ուղարկել առաջարկը','Отправить предложение','Send proposal')}</button></form>}
 <ul className="cx-list">{w.delegations.map(x=><li key={x.id+x.version} className="cx-row"><strong>{x.serviceName}</strong><span>{x.ownerName} → {x.recipientName}</span><span>{per(x.startsOn)} – {x.endsOn?per(x.endsOn):tt(l,'անժամկետ','без срока','open-ended')}</span><span className="cx-badge">{stl(l,x.status)}</span>
 {x.canAccept&&<><button className="im-button" disabled={a.busy} onClick={()=>act(x,'accept')}>{tt(l,'Ընդունել','Принять','Accept')}</button><button className="im-button" disabled={a.busy} onClick={()=>act(x,'decline')}>{tt(l,'Մերժել','Отклонить','Decline')}</button></>}
 {x.canRevoke&&<button className="im-button" disabled={a.busy} onClick={()=>act(x,'revoke')}>{tt(l,'Չեղարկել ապագան','Отозвать на будущее','Revoke future')}</button>}</li>)}</ul>
 {!w.delegations.length&&<p>{tt(l,'Առաջարկներ չկան','Предложений нет','No proposals yet')}</p>}
 {!!w.invoices.length&&<><h4>{tt(l,'Իմ հրապարակված հաշիվները (դիտման համար)','Мои выставленные счета (только просмотр)','My published invoices (read-only)')}</h4><ul className="cx-list">{w.invoices.map(i=><li key={i.id} className="cx-row"><span>{per(i.period)}</span><strong>{money(l,i.amountMinor,i.currency)}</strong><span className="cx-badge">{i.status}</span></li>)}</ul></>}
 {a.err&&<p role="alert" className="sx-err">{a.err}</p>}</section>}
function PolicyRow({p,l,buildingId,guard,busy}:{p:PayerServicePolicy;l:Language;buildingId:string;guard:(fn:()=>Promise<unknown>)=>void;busy:boolean}){
 return <li className="cx-row"><strong>{p.serviceName??p.serviceId}</strong><span className="cx-badge">{p.enabled?tt(l,'Միացված','Включено','Enabled'):tt(l,'Անջատված','Выключено','Disabled')}</span>
 <button className="im-button" disabled={busy} onClick={()=>guard(()=>updateResidentPayerPolicy(p.serviceId,{enabled:!p.enabled,version:p.version},{buildingId}))}>{p.enabled?tt(l,'Անջատել','Выключить','Disable'):tt(l,'Միացնել','Включить','Enable')}</button></li>}
export function PayerPolicy({c,l,buildingId}:{c:RoleContext;l:Language;buildingId:string}){
 const qc=useQueryClient(),key=['resident-payer-policy',c.id,buildingId],q=useQuery({queryKey:key,queryFn:()=>getResidentPayerPolicy({buildingId})});
 const a=useAct(l,()=>{void qc.invalidateQueries({queryKey:key})}),[need,setNeed]=useState(false);
 const guard=(fn:()=>Promise<unknown>)=>{void a.run(async()=>{try{await fn();setNeed(false)}catch(e){if(needsReauth(e)){setNeed(true);return}throw e}})};
 return <section className="im-card sx-form" aria-labelledby="cx-pp"><h3 id="cx-pp">{tt(l,'Վճարողի պատասխանատվության կանոններ','Правила ответственности плательщика','Payer responsibility policy')}</h3>
 <small>{tt(l,'Ընտրեք՝ որ ծառայությունների համար սեփականատերը կարող է առաջարկել ստացողի։ Լռելյայն անջատված է։','Выберите категории, по которым собственник может предложить получателя. По умолчанию выключено.','Choose which charge categories an owner may hand to a recipient. Disabled by default.')}</small>
 {need&&<ReauthPrompt language={l} onCancel={()=>setNeed(false)} onDone={()=>setNeed(false)}/>}
 {q.isPending&&<div className="sx-skel" aria-busy="true">…</div>}{q.isError&&<div className="im-notice" role="alert">{tt(l,'Չբեռնվեց։','Не удалось загрузить.','Could not load.')} <button onClick={()=>q.refetch()}>{tt(l,'Կրկնել','Повторить','Retry')}</button></div>}
 {q.data&&!q.data.length&&<p>{tt(l,'Ծառայություններ չկան','Услуг нет','No services')}</p>}
 <ul className="cx-list">{q.data?.map(p=><PolicyRow key={p.serviceId+p.version} p={p} l={l} buildingId={buildingId} guard={guard} busy={a.busy}/>)}</ul>{a.err&&<p role="alert" className="sx-err">{a.err}</p>}</section>}
