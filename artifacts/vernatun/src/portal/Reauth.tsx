import type {RecentAuthenticationInput} from '@workspace/api-client-react';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {request,ApiClientError} from './client';
import type {Language} from './i18n';
const S={
 title:['Կրկնակի նույնականացում','Повторное подтверждение личности','Confirm it is you'],
 why:['Այս գործողությունը պահանջում է վերջին {n} րոպեում մուտքի հաստատում։ Հաստատումից հետո գործողությունը ձեռքով կրկնեք։','Для этого действия нужен вход не старше {n} мин.. После подтверждения отправьте действие повторно вручную.','This action needs a sign-in confirmed within the last {n} minutes. After confirming, submit the action again yourself.'],
 password:['Գաղտնաբառ','Пароль','Password'],code:['MFA կոդ (եթե կարգավորված է)','Код MFA (если настроен)','MFA code (if configured)'],
 go:['Հաստատել','Подтвердить','Confirm'],cancel:['Փակել','Закрыть','Close'],fail:['Հաստատումը չհաջողվեց։','Подтверждение не удалось.','Confirmation failed.'],ok:['Հաստատված է։ Այժմ կրկնեք գործողությունը։','Подтверждено. Теперь отправьте действие снова.','Confirmed. Now submit the action again.']} as const;
export const needsReauth=(e:unknown)=>e instanceof ApiClientError&&e.code==='recent_authentication_required';
export function ReauthPrompt({language,onDone,onCancel,freshnessMinutes=5}:{language:Language;onDone:()=>void;onCancel:()=>void;freshnessMinutes?:number}){
 const t=(k:keyof typeof S)=>S[k][language==='hy'?0:language==='ru'?1:2];
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);const [pw,setPw]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[err,setErr]=useState('');
 async function go(e:FormEvent){e.preventDefault();if(busy)return;setBusy(true);setErr('');
  try{const body:RecentAuthenticationInput={password:pw,...(code.trim()?{code:code.trim()}:{})};await request('/auth/reauthenticate','POST',body);if(!alive.current)return;setPw('');setCode('');onDone()}
  catch(x){if(!alive.current)return;setPw('');setCode('');setErr(t('fail')+(x instanceof ApiClientError?' ('+x.code+')':''))}finally{if(alive.current)setBusy(false)}}
 return <form className="p-card p-edit-form" onSubmit={go} autoComplete="off" role="dialog" aria-label={t('title')}><h3>{t('title')}</h3><p className="p-info">{t('why').replace('{n}',String(freshnessMinutes))}</p>{err&&<p className="p-error" role="alert">{err}</p>}
  <label>{t('password')}<input type="password" name="reauth-secret" autoComplete="off" required maxLength={72} value={pw} onChange={e=>setPw(e.target.value)}/></label>
  <label>{t('code')}<input type="text" name="reauth-code" inputMode="numeric" autoComplete="off" maxLength={30} value={code} onChange={e=>setCode(e.target.value)}/></label>
  <button className="p-button orange" disabled={busy||!pw}>{t('go')}</button> <button type="button" className="p-button" onClick={()=>{setPw('');setCode('');onCancel()}}>{t('cancel')}</button></form>}
export const reauthDone=(language:Language)=>S.ok[language==='hy'?0:language==='ru'?1:2];
