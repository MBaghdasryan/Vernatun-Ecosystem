import {useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {createResidentAiHistory,createResidentPlatformTicket,deleteResidentAiHistory} from '@workspace/api-client-react';
import type {ResidentContinuity} from '@workspace/api-client-react';
import type {RoleContext} from '../../portal/types';
import type {Language} from '../../portal/i18n';
import {useAct} from '../superapp/useAct';
import {contKey,newId,tt,fmtTime} from './core';
import './continuity.css';
const ticketStatus=(l:Language,v:string)=>{const k=v.toLowerCase();return k==='open'||k==='new'?tt(l,'Բաց','Открыто','Open'):k==='resolved'||k==='closed'?tt(l,'Փակված','Закрыто','Closed'):k==='waiting'||k==='pending'?tt(l,'Սպասում է','Ожидает','Waiting'):tt(l,'Մշակվում է','В работе','In progress')};
const aiStatus=(l:Language,v:string)=>v==='NOT_CONFIGURED'?tt(l,'AI-ն կարգավորված չէ','ИИ не настроен','AI not configured'):tt(l,'Անհասանելի','Недоступно','Unavailable');
export default function HelpDesk({c,l,d}:{c:RoleContext;l:Language;d:ResidentContinuity}){
 const qc=useQueryClient(),a=useAct(l,()=>{void qc.invalidateQueries({queryKey:contKey(c.id)})}),b=useAct(l,()=>{void qc.invalidateQueries({queryKey:contKey(c.id)})});
 const [sub,setSub]=useState(''),[body,setBody]=useState(''),[qt,setQt]=useState(''),[qb,setQb]=useState(''),cid=useRef(newId());
 return <section className="cx sx-section"><div className="im-section-title"><h2>{tt(l,'Պլատֆորմի աջակցություն','Поддержка платформы','Platform support')}</h2></div>
 <form className="im-card sx-form" onSubmit={e=>{e.preventDefault();void a.run(async()=>{await createResidentPlatformTicket({subject:sub.trim(),body:body.trim()});setSub('');setBody('')})}}>
 <label>{tt(l,'Թեմա','Тема','Subject')}<input required maxLength={160} value={sub} onChange={e=>setSub(e.target.value)}/></label>
 <label>{tt(l,'Նկարագրություն','Описание','Details')}<textarea required maxLength={4000} value={body} onChange={e=>setBody(e.target.value)}/></label>
 <button className="im-button" disabled={a.busy||!sub.trim()||!body.trim()}>{tt(l,'Ստեղծել դիմում','Создать обращение','Create ticket')}</button>{a.err&&<p role="alert" className="sx-err">{a.err}</p>}</form>
 <ul className="cx-list">{d.tickets.map(t=><li key={t.id} className="im-card"><div className="cx-row"><strong>{t.subject}</strong><span className="cx-badge">{ticketStatus(l,t.status)}</span><small>{fmtTime(l,t.createdAt)}</small></div><p>{t.body}</p>{t.reply?<p><strong>{tt(l,'Պատասխան','Ответ','Reply')}:</strong> {t.reply}</p>:<small>{tt(l,'Պատասխան դեռ չկա','Ответа пока нет','No reply yet')}</small>}</li>)}</ul>
 {!d.tickets.length&&<div className="im-card im-empty"><p>{tt(l,'Դիմումներ չկան','Обращений нет','No tickets yet')}</p></div>}
 <div className="im-section-title"><h2>{tt(l,'AI հարցերի պատմություն','История вопросов к ИИ','AI question history')}</h2></div>
 <div className="im-notice" role="status">{tt(l,'AI մատակարարը կարգավորված չէ (NOT_CONFIGURED)․ հարցերը միայն պահվում են, պատասխան չի ստեղծվում։','ИИ-провайдер не настроен (NOT_CONFIGURED): вопросы только сохраняются, ответы не формируются.','The AI provider is NOT_CONFIGURED: questions are only saved, no answer is generated.')}</div>
 <form className="im-card sx-form" onSubmit={e=>{e.preventDefault();void b.run(async()=>{await createResidentAiHistory({title:qt.trim(),body:qb.trim(),clientId:cid.current});cid.current=newId();setQt('');setQb('')})}}>
 <label>{tt(l,'Վերնագիր','Заголовок','Title')}<input required maxLength={160} value={qt} onChange={e=>setQt(e.target.value)}/></label>
 <label>{tt(l,'Հարց','Вопрос','Question')}<textarea required maxLength={4000} value={qb} onChange={e=>setQb(e.target.value)}/></label>
 <button className="im-button" disabled={b.busy||!qt.trim()||!qb.trim()}>{tt(l,'Պահել հարցը','Сохранить вопрос','Save question')}</button>{b.err&&<p role="alert" className="sx-err">{b.err}</p>}</form>
 <ul className="cx-list">{d.aiHistory.map(h=><li key={h.id} className="im-card cx-row"><div style={{flex:1}}><strong>{h.title}</strong><p>{h.body}</p><small>{fmtTime(l,h.createdAt)} · {aiStatus(l,h.providerStatus)}</small></div><button className="im-button" disabled={b.busy} onClick={()=>void b.run(()=>deleteResidentAiHistory(h.id))}>{tt(l,'Ջնջել','Удалить','Delete')}</button></li>)}</ul>
 <div className="im-card"><p>{tt(l,'Լուսանկարից հայտ․ ստեղծեք հայտը ձեռքով և կցեք լուսանկարը՝ ավտոմատ ճանաչում չկա։','Фото в заявку: создайте заявку вручную и приложите фото — автоматического распознавания нет.','Photo to request: create the request manually and attach the photo — there is no automatic image recognition.')}</p></div></section>}
