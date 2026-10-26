import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {changeDelegationExpiration,createResidentDelegation,getResidentHousehold,listResidentDelegations,resendResidentDelegation,revokeResidentDelegation,transitionResidentLease} from '@workspace/api-client-react';
import type {ListResidentDelegations200Item,ResidentHouseholdLeasesItem} from '@workspace/api-client-react';
import type {RoleContext} from '../../portal/types';
import type {Language} from '../../portal/i18n';
import {ReauthPrompt,reauthDone} from '../../portal/Reauth';
import {useAct} from '../superapp/useAct';
import {tt,needsReauth} from './core';
import './continuity.css';
type Perm='requests.own'|'requests.create'|'announcements.read'|'properties.own'|'access.create';
const perms:[Perm,string,string,string][]=[['requests.own','Տեսնել հայտերը','Видеть заявки','See requests'],['requests.create','Ստեղծել հայտեր','Создавать заявки','Create requests'],['announcements.read','Հայտարարություններ','Объявления','Announcements'],['properties.own','Տան տվյալներ','Данные дома','Home details'],['access.create','Հյուրերի անցագրեր','Гостевые пропуска','Guest passes']];
const dayOpts=[30,90,180,365];
const inDays=(n:number)=>new Date(Date.now()+n*864e5).toISOString();
export default function Household({c,l}:{c:RoleContext;l:Language}){
 const qc=useQueryClient(),h=useQuery({queryKey:['resident-household',c.id],queryFn:()=>getResidentHousehold()});
 const dl=useQuery({queryKey:['resident-delegations',c.id],enabled:!!h.data?.canManageDelegations,queryFn:()=>listResidentDelegations()});
 const [need,setNeed]=useState(false),[notice,setNotice]=useState('');
 const refresh=()=>{void qc.invalidateQueries({queryKey:['resident-household',c.id]});void qc.invalidateQueries({queryKey:['resident-delegations',c.id]})};
 const a=useAct(l,refresh);
 const guard=(fn:()=>Promise<unknown>)=>{setNotice('');void a.run(async()=>{try{await fn();setNeed(false)}catch(e){if(needsReauth(e)){setNeed(true);return}throw e}})};
 const [email,setEmail]=useState(''),[phone,setPhone]=useState(''),[days,setDays]=useState(90),[sel,setSel]=useState<Perm[]>(['requests.own']);
 if(h.isPending)return <div className="im-card sx-skel" aria-busy="true">…</div>;
 if(h.isError||!h.data)return null;
 const d=h.data;
 return <section className="im-card sx-form" aria-labelledby="cx-hh"><h3 id="cx-hh">{tt(l,'Իմ տունը','Моё домохозяйство','My household')}</h3>
 {need&&<ReauthPrompt language={l} onCancel={()=>setNeed(false)} onDone={()=>{setNeed(false);setNotice(reauthDone(l))}}/>}{notice&&<p role="status">{notice}</p>}
 <ul className="cx-list">{d.members.map(m=><li key={m.id} className="cx-row"><strong>{m.name}</strong><span className="cx-badge">{m.role}</span>{m.expiresAt&&<span>{tt(l,'Մինչև','До','Until')} {new Date(m.expiresAt).toLocaleDateString(l)}</span>}</li>)}</ul>
 {!d.members.length&&<p>{tt(l,'Անդամներ չկան','Участников нет','No members')}</p>}
 {d.canManageDelegations&&<>
 <form className="sx-form" onSubmit={e=>{e.preventDefault();guard(async()=>{await createResidentDelegation({email:email.trim(),...(phone.trim()?{phone:phone.trim()}:{}),expiresAt:inDays(days),permissions:sel});setEmail('');setPhone('')})}}><h4>{tt(l,'Հրավիրել ընտանիքի անդամ','Пригласить члена семьи','Invite a family member')}</h4>
 <label>{tt(l,'Էլ. փոստ','Эл. почта','Email')}<input type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label>
 <label>{tt(l,'Հեռախոս','Телефон','Phone')}<input type="tel" maxLength={30} value={phone} onChange={e=>setPhone(e.target.value)}/></label>
 <label>{tt(l,'Վավեր է (օր)','Действует (дней)','Valid for (days)')}<select value={days} onChange={e=>setDays(Number(e.target.value))}>{dayOpts.map(n=><option key={n} value={n}>{n}</option>)}</select></label>
 {perms.map(([k,hy,ru,en])=><label key={k} className="sx-check"><input type="checkbox" checked={sel.includes(k)} onChange={e=>setSel(e.target.checked?[...sel,k]:sel.filter(x=>x!==k))}/>{tt(l,hy,ru,en)}</label>)}
 <button className="im-button" disabled={a.busy||!sel.length||!email.includes('@')}>{tt(l,'Ուղարկել հրավեր','Отправить приглашение','Send invitation')}</button></form>
 {dl.isError&&<p role="alert">{tt(l,'Հրավերները չբեռնվեցին։','Приглашения не загрузились.','Invitations did not load.')}</p>}
 <ul className="cx-list">{dl.data?.map(x=><Invite key={x.id+x.version} x={x} l={l} guard={guard} busy={a.busy}/>)}</ul>
 {dl.data&&!dl.data.length&&<p>{tt(l,'Հրավերներ չկան','Приглашений нет','No invitations')}</p>}</>}
 {d.canManageLeases&&<><h4>{tt(l,'Վարձակալության պայմանագրեր','Договоры аренды','Leases')}</h4>
 <ul className="cx-list">{d.leases.map(x=><Lease key={x.id+x.version} x={x} l={l} guard={guard} busy={a.busy}/>)}</ul>{!d.leases.length&&<p>{tt(l,'Պայմանագրեր չկան','Договоров нет','No leases')}</p>}
 <small>{tt(l,'Նոր վարձակալի ավելացումը այս API-ով հասանելի չէ։','Добавление нового арендатора через этот API недоступно.','Adding a new renter is not available through this API.')}</small></>}
 {a.err&&<p role="alert" className="sx-err">{a.err}</p>}</section>}
type G=(fn:()=>Promise<unknown>)=>void;
function Invite({x,l,guard,busy}:{x:ListResidentDelegations200Item;l:Language;guard:G;busy:boolean}){
 const [days,setDays]=useState(90),[ask,setAsk]=useState(false);
 const state=x.revoked_at?tt(l,'Չեղարկված','Отозвано','Revoked'):x.accepted_at?tt(l,'Ընդունված','Принято','Accepted'):tt(l,'Սպասում է','Ожидает','Pending');
 return <li className="cx-row"><strong>{x.email}</strong><span className="cx-badge">{state}</span><span>{tt(l,'Մինչև','До','Until')} {new Date(x.expires_at).toLocaleDateString(l)}</span>
 {!x.revoked_at&&<><select aria-label={tt(l,'Նոր ժամկետ (օր)','Новый срок (дней)','New validity (days)')} value={days} onChange={e=>setDays(Number(e.target.value))}>{dayOpts.map(n=><option key={n} value={n}>{n}</option>)}</select>
 <button type="button" className="im-button" disabled={busy} onClick={()=>guard(()=>changeDelegationExpiration(x.id,{version:x.version,expiresAt:inDays(days)}))}>{tt(l,'Փոխել ժամկետը','Изменить срок','Change expiry')}</button>
 {!x.accepted_at&&<button type="button" className="im-button" disabled={busy} onClick={()=>guard(()=>resendResidentDelegation(x.id,{version:x.version}))}>{tt(l,'Նորից ուղարկել','Отправить снова','Resend')}</button>}
 {ask?<><button type="button" className="im-button" disabled={busy} onClick={()=>{setAsk(false);guard(()=>revokeResidentDelegation(x.id))}}>{tt(l,'Հաստատել հեռացումը','Подтвердить отзыв','Confirm revoke')}</button><button type="button" className="im-button" onClick={()=>setAsk(false)}>×</button></>:<button type="button" className="im-button" disabled={busy} onClick={()=>setAsk(true)}>{tt(l,'Չեղարկել հրավերը','Отозвать','Revoke')}</button>}</>}</li>}
function Lease({x,l,guard,busy}:{x:ResidentHouseholdLeasesItem;l:Language;guard:G;busy:boolean}){
 const [ends,setEnds]=useState(''),[reason,setReason]=useState('');
 const okEnd=/^\d{4}-\d{2}-\d{2}$/.test(ends)&&ends>x.endsOn.slice(0,10);
 return <li className="cx-row" style={{flexWrap:'wrap'}}><strong>{x.name}</strong><span>{x.startsOn.slice(0,10)} → {x.endsOn.slice(0,10)}</span><span className="cx-badge">{x.cancelled?tt(l,'Չեղարկված','Расторгнут','Cancelled'):tt(l,'Գործող','Действует','Active')}</span>
 {!x.cancelled&&<><label>{tt(l,'Նոր ավարտ','Новая дата окончания','New end date')}<input type="date" min={x.endsOn.slice(0,10)} value={ends} onChange={e=>setEnds(e.target.value)}/></label>
 <button type="button" className="im-button" disabled={busy||!okEnd} onClick={()=>guard(()=>transitionResidentLease(x.id,'extend',{version:x.version,endsOn:ends}))}>{tt(l,'Երկարացնել','Продлить','Extend')}</button>
 <label>{tt(l,'Պատճառ (առնվազն 3 նիշ)','Причина (минимум 3 символа)','Reason (min 3 characters)')}<input maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
 <button type="button" className="im-button" disabled={busy||reason.trim().length<3} onClick={()=>{if(confirm(tt(l,'Չեղարկե՞լ պայմանագիրը։','Расторгнуть договор?','Cancel this lease?')))guard(()=>transitionResidentLease(x.id,'cancel',{version:x.version,reason:reason.trim()}))}}>{tt(l,'Չեղարկել պայմանագիրը','Расторгнуть','Cancel lease')}</button></>}</li>}
