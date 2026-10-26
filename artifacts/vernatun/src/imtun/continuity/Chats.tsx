import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {createResidentDirectChat,getResidentDirectMessages,postResidentDirectMessage,updateResidentDirectChatState} from '@workspace/api-client-react';
import type {ResidentContinuity,ResidentDirectChat,ResidentDirectMessage} from '@workspace/api-client-react';
import type {RoleContext} from '../../portal/types';
import type {Language} from '../../portal/i18n';
import {useAct} from '../superapp/useAct';
import {contKey,newId,tt,fmtTime} from './core';
import './continuity.css';
function Conv({chat,l,c,refresh}:{chat:ResidentDirectChat;l:Language;c:RoleContext;refresh:()=>void}){
 const qc=useQueryClient(),[older,setOlder]=useState<ResidentDirectMessage[]>([]),[more,setMore]=useState<boolean|null>(null),[text,setText]=useState(''),a=useAct(l,refresh);
 const cid=useRef(newId()),key=['resident-dm',c.id,chat.id];
 const q=useQuery({queryKey:key,queryFn:()=>getResidentDirectMessages(chat.id)});
 const all=[...older,...(q.data?.items??[])],hasMore=more??q.data?.hasMore??false;
 const loadOlder=()=>void a.run(async()=>{const first=all[0];if(!first)return;const r=await getResidentDirectMessages(chat.id,{before:first.id});setOlder([...r.items,...older]);setMore(r.hasMore)});
 const send=()=>{const body=text.trim();if(!body)return;void a.run(async()=>{await postResidentDirectMessage(chat.id,{body,clientId:cid.current});cid.current=newId();setText('');await qc.invalidateQueries({queryKey:key})})};
 return <div className="im-card sx-form"><h3>{chat.name}</h3>
 <div className="cx-row">{chat.unread>0&&<span className="cx-badge">{tt(l,`Չկարդացված՝ ${chat.unread}`,`Непрочитано: ${chat.unread}`,`Unread: ${chat.unread}`)}</span>}
 {chat.unread>0&&<button type="button" className="im-button" disabled={a.busy} onClick={()=>void a.run(()=>updateResidentDirectChatState(chat.id,{action:'read'}))}>{tt(l,'Նշել կարդացված','Отметить прочитанным','Mark as read')}</button>}
 {(!chat.blocked||chat.blockedByMe)&&<button type="button" className="im-button" disabled={a.busy} onClick={()=>void a.run(()=>updateResidentDirectChatState(chat.id,{action:chat.blockedByMe?'unblock':'block'}))}>{chat.blockedByMe?tt(l,'Ապաարգելափակել','Разблокировать','Unblock'):tt(l,'Արգելափակել','Заблокировать','Block')}</button>}</div>
 {q.isPending&&<div className="sx-skel" aria-busy="true">…</div>}{q.isError&&<div className="im-notice" role="alert">{tt(l,'Չհաջողվեց բեռնել։','Не удалось загрузить.','Could not load.')} <button onClick={()=>q.refetch()}>{tt(l,'Կրկնել','Повторить','Retry')}</button></div>}
 {hasMore&&<button type="button" className="im-button" disabled={a.busy} onClick={loadOlder}>{tt(l,'Ավելի վաղ','Загрузить раньше','Load earlier')}</button>}
 <ul className="cx-list" aria-live="polite">{all.map(m=><li key={m.id} className={'cx-msg '+(m.own?'own':'')}>{m.body}<br/><small>{fmtTime(l,m.createdAt)}</small></li>)}</ul>
 {q.data&&!all.length&&<p>{tt(l,'Հաղորդագրություններ դեռ չկան','Сообщений пока нет','No messages yet')}</p>}
 {chat.blocked?<p role="status">{chat.blockedByMe?tt(l,'Դուք արգելափակել եք այս զրուցակցին։','Вы заблокировали этого собеседника.','You blocked this neighbor.'):tt(l,'Զրույցը հասանելի չէ։','Чат недоступен.','This chat is unavailable.')}</p>
 :<><label>{tt(l,'Հաղորդագրություն','Сообщение','Message')}<textarea maxLength={2000} value={text} onChange={e=>setText(e.target.value)}/></label><button className="im-button" disabled={a.busy||!text.trim()} onClick={send}>{tt(l,'Ուղարկել','Отправить','Send')}</button></>}
 {a.err&&<p role="alert" className="sx-err">{a.err}</p>}</div>}
export default function Chats({c,l,d}:{c:RoleContext;l:Language;d:ResidentContinuity}){
 const qc=useQueryClient(),refresh=()=>{void qc.invalidateQueries({queryKey:contKey(c.id)})},a=useAct(l,refresh),[pick,setPick]=useState(''),[open,setOpen]=useState('');
 useEffect(()=>{if(!open&&d.chats[0])setOpen(d.chats[0].id)},[d.chats,open]);
 if(!d.canChat)return <div className="im-card im-empty"><p>{tt(l,'Անձնական զրույցները միացված չեն այս շենքում։','Личные чаты не включены для этого здания.','Private chats are not enabled for this building.')}</p></div>;
 const sel=d.chats.find(x=>x.id===open);
 return <section className="cx sx-section"><div className="im-section-title"><h2>{tt(l,'Անձնական զրույցներ','Личные чаты','Private chats')}</h2></div>
 <form className="im-card sx-form" onSubmit={e=>{e.preventDefault();void a.run(async()=>{const ch=await createResidentDirectChat({recipientId:pick});setOpen(ch.id);setPick('')})}}>
 <label>{tt(l,'Հարևան (համաձայնած)','Сосед (в справочнике по согласию)','Neighbor (opted in)')}<select value={pick} onChange={e=>setPick(e.target.value)}><option value="">—</option>{d.neighbors.map(n=><option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
 <button className="im-button" disabled={a.busy||!pick}>{tt(l,'Սկսել զրույց','Начать чат','Start chat')}</button>
 {!d.neighbors.length&&<small>{tt(l,'Ցուցակում դեռ հարևաններ չկան։','В справочнике пока нет соседей.','No neighbors have opted in yet.')}</small>}{a.err&&<p role="alert" className="sx-err">{a.err}</p>}</form>
 {d.chats.length>0&&<div className="cx-row" role="tablist" aria-label={tt(l,'Զրույցներ','Чаты','Chats')}>{d.chats.map(ch=><button key={ch.id} role="tab" aria-selected={ch.id===open} className={'im-button'+(ch.id===open?' active':'')} onClick={()=>setOpen(ch.id)}>{ch.name}{ch.unread>0?' ('+ch.unread+')':''}</button>)}</div>}
 {sel&&<Conv key={sel.id} chat={sel} l={l} c={c} refresh={refresh}/>}
 {!d.chats.length&&<div className="im-card im-empty"><p>{tt(l,'Զրույցներ դեռ չկան','Чатов пока нет','No chats yet')}</p></div>}</section>}
