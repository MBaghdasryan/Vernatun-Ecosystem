import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {ResidentDelegationInput,DelegationExpirationInput,DelegationResendInput} from '@workspace/api-client-react';
import {request,ApiClientError} from './client';
import {BusinessTable} from './Business';
import {ReauthPrompt,needsReauth,reauthDone} from './Reauth';
import {usePolling} from './Phase2';
import {bt} from './business-i18n';
import {date,type Language} from './i18n';
import type {RoleContext} from './types';
type Row=Record<string,any>;
const S={phone:['Հեռախոս (կապի համար, ոչ պարտադիր)','Телефон (для связи, необязательно)','Phone (contact only, optional)'],phoneNote:['Էլ․ փոստը պարտադիր է։ SMS չի ուղարկվում, հեռախոսով մուտք չկա։','Email обязателен. SMS не отправляется, вход по телефону невозможен.','Email is required. No SMS is sent and phone cannot be used to sign in.'],
 expiry:['Փոխել ժամկետը','Изменить срок','Change expiration'],resend:['Նորից ուղարկել','Отправить повторно','Resend invitation'],loading:['Բեռնվում է…','Загрузка…','Loading…'],retry:['Կրկնել','Повторить','Retry'],error:['Գործողությունը չհաջողվեց։','Действие не выполнено.','Action failed.'],conflict:['Տվյալները փոխվել են։ Թարմացրեք։','Запись изменена. Обновите.','Record changed. Refresh.'],changed:['Սերվերում նոր տարբերակ կա, ձեր փոփոխությունները պահպանված են։','На сервере новая версия; ваши правки сохранены.','A newer server version exists; your edits are kept.'],empty:['Հրավերներ չկան','Приглашений нет','No invitations'],latest:['Օգտագործել վերջին տարբերակը՝ պահելով իմ արժեքը','Взять последнюю версию с моим значением','Use latest version with my value'],done:['Պահպանված է','Сохранено','Saved'],close:['Փակել','Закрыть','Close']} as const;
export default function Delegations({c,language}:{c:RoleContext;language:Language}){
 const i=language==='hy'?0:language==='ru'?1:2;const t=(k:string)=>(S as Record<string,readonly string[]>)[k]?.[i]??bt(language,k);
 const [data,setData]=useState<Row[]>();const [selId,setSelId]=useState<string>();const [error,setError]=useState('');const [ok,setOk]=useState('');const [busy,setBusy]=useState(false);const [secret,setSecret]=useState('');const [reauth,setReauth]=useState(false);
 const [exp,setExp]=useState<{id:string;version:number;value:string}>();
 const key=useRef(c.id);key.current=c.id;const seq=useRef(0);const busyRef=useRef(false);
 const time=(v:FormDataEntryValue|null)=>new Date(String(v)).toISOString();
 async function load(){const k=c.id;const n=++seq.current;try{const r=await request<Row[]>('/delegations');if(k!==key.current||n!==seq.current)return;setData(r);setError('')}catch(e){if(k===key.current&&n===seq.current)setError(t('error')+(e instanceof ApiClientError?' ('+e.code+')':''))}}
 useEffect(()=>{seq.current++;setData(undefined);setSelId(undefined);setSecret('');setReauth(false);setExp(undefined);setError('');setOk('');void load()},[c.id]);
 usePolling(()=>void load(),[c.id],false);
 async function act(path:string,body:unknown,after?:(r:any)=>void){if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');setOk('');const k=c.id;
  try{const r=await request<any>(path,'POST',body);if(k!==key.current)return;after?.(r);setOk(t('done'));await load()}
  catch(e){if(k!==key.current)return;if(needsReauth(e)){setReauth(true)}else{if(e instanceof ApiClientError&&e.code==='stale_version')void load();setError(e instanceof ApiClientError&&e.code==='stale_version'?t('conflict'):t('error')+(e instanceof ApiClientError?' ('+e.code+')':''))}}finally{busyRef.current=false;setBusy(false)}}
 const status=(d:Row)=>d.revoked_at?'revoked':Date.parse(d.expires_at)<Date.now()?'expired':d.accepted_at?'active':'pending';
 const sel=data?.find(d=>d.id===selId);
 function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget;const f=new FormData(form);const phone=String(f.get('phone')??'').trim();
  const body:ResidentDelegationInput={email:String(f.get('email')),...(phone?{phone}:{}),expiresAt:time(f.get('expiresAt')),permissions:[...(f.get('requests')?['requests.own','requests.create']:[]),...(f.get('announcements')?['announcements.read']:[]),...(f.get('properties')?['properties.own']:[]),...(f.get('passPermission')?['access.create']:[])] as ResidentDelegationInput['permissions']};void act('/delegations',body,r=>{setSecret(r?.url??'');form.reset()})}
 return <><section className="p-card" aria-busy={busy}>{error&&<p className="p-error" role="alert">{error} <button className="p-button" onClick={()=>void load()}>{t('retry')}</button></p>}{ok&&<p role="status">{ok}</p>}
  {!data&&!error&&<p role="status">{t('loading')}</p>}{data&&!data.length&&<p>{t('empty')}</p>}
  {data&&<BusinessTable rows={data.map(d=>({...d,status:status(d),until:date(d.expires_at,language)}))} columns={[["email","email"],["contact_phone","phone"],["until","until"],["status","status"]]} language={language} onSelect={r=>{setSelId(r.id);setExp(undefined)}}/>}</section>
  {reauth&&<ReauthPrompt language={language} onCancel={()=>setReauth(false)} onDone={()=>{setReauth(false);setOk(reauthDone(language))}}/>}
  {secret&&<section className="p-card"><p>{t('localLink')}</p><a className="p-invite-url" href={secret}>{secret}</a></section>}
  <div className="p-business-grid"><form className="p-card p-edit-form" onSubmit={submit} autoComplete="off"><h3>{t('invite')}</h3>
   <label>{t('email')}<input name="email" type="email" required maxLength={254}/></label>
   <label>{t('phone')}<input name="phone" type="tel" maxLength={30} pattern="[+]?[0-9 ()\-]{6,30}"/></label><p className="p-info">{t('phoneNote')}</p>
   <label>{t('until')}<input name="expiresAt" type="datetime-local" required/></label>
   {['requests','announcements','properties','passPermission'].map(k=><label className="p-check-item" key={k}><input type="checkbox" name={k} defaultChecked={k==='requests'}/>{t(k)}</label>)}
   <button className="p-button orange" disabled={busy}>{t('invite')}</button></form>
  {sel&&!sel.revoked_at&&<section className="p-card p-edit-form" key={sel.id}><h3>{sel.email}</h3>{sel.contact_phone&&<p>{sel.contact_phone}</p>}
   {exp&&exp.id===sel.id&&exp.version!==sel.version&&<p className="p-info">{t('changed')} <button className="p-button" onClick={()=>setExp({...exp,version:sel.version})}>{t('latest')}</button></p>}
   <label>{t('expiry')}<input type="datetime-local" value={(exp&&exp.id===sel.id?exp.value:'')} onChange={e=>setExp({id:sel.id,version:(exp&&exp.id===sel.id?exp.version:sel.version),value:e.target.value})}/></label>
   <button className="p-button" disabled={busy||!(exp&&exp.id===sel.id&&exp.value&&exp.version===sel.version)} onClick={()=>exp&&void act('/delegations/'+sel.id+'/expiration',{version:exp.version,expiresAt:new Date(exp.value).toISOString()} satisfies DelegationExpirationInput,()=>setExp(undefined))}>{t('expiry')}</button>
   {status(sel)==='pending'&&<button className="p-button" disabled={busy} onClick={()=>void act('/delegations/'+sel.id+'/resend',{version:sel.version} satisfies DelegationResendInput,r=>{if(r?.url)setSecret(r.url)})}>{t('resend')}</button>}
   <button className="p-button orange" disabled={busy} onClick={()=>void act('/delegations/'+sel.id+'/revoke',{},()=>setSelId(undefined))}>{t('revoke')}</button></section>}</div></>}
