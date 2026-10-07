import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {ApiClientError,request} from './client';
import {ReauthPrompt} from './Reauth';
import type {Language} from './i18n';
import type {RoleContext} from './types';
type Policy={policy:{required:boolean;enforceAfter:string|null;version:number};enrolled:boolean;verified:boolean;enforced:boolean;canManage:boolean};
const S={
title:['MFA քաղաքականություն ընթացիկ դերի համար','Политика MFA для текущей роли','MFA policy for the current role'],
load:['Բեռնվում է…','Загрузка…','Loading…'],
loadErr:['Չհաջողվեց բեռնել քաղաքականությունը։','Не удалось загрузить политику.','Could not load the policy.'],
retry:['Կրկնել','Повторить','Retry'],
required:['Պարտադիր','Обязательна','Required'],optional:['Պարտադիր չէ','Не обязательна','Not required'],
enforced:['Գործում է արդեն','Действует сейчас','Enforced now'],grace:['Սկսվում է՝','Начнёт действовать:','Takes effect:'],
enrolled:['MFA միացված է','MFA подключена','MFA enrolled'],notEnrolled:['MFA միացված չէ','MFA не подключена','MFA not enrolled'],
verified:['Վերջերս հաստատված','Недавно подтверждено','Recently verified'],notVerified:['Վերջերս չի հաստատվել','Нет недавнего подтверждения','Not recently verified'],
how:['Միացրեք TOTP-ը «Երկգործոն պաշտպանություն» բաժնում, ապա հաստատեք կոդը մինչև ժամկետը։','Подключите TOTP в разделе двухфакторной защиты и подтвердите код до наступления срока.','Enable TOTP in the two-factor section and verify a code before the date.'],
req:['Պահանջել MFA','Требовать MFA','Require MFA'],when:['Ակտիվացում (UTC)','Активация (UTC)','Activation (UTC)'],
whenHint:['Նվազագույնը 24 ժամ հետո։ Ժամանակը՝ UTC։','Не раньше чем через 24 часа. Время в UTC.','At least 24 hours ahead. Time is UTC.'],
reason:['Պատճառ (առնվազն 8 նիշ)','Причина (не менее 8 символов)','Reason (at least 8 characters)'],
save:['Պահպանել','Сохранить','Save'],saving:['Պահպանվում է…','Сохранение…','Saving…'],ok:['Պահպանված է։','Сохранено.','Saved.'],
need:['Պահպանելու համար պետք է միացված և վերջերս հաստատված MFA։','Для сохранения нужна подключённая MFA с недавним подтверждением.','Saving needs enrolled MFA with a recent verification.'],
tooSoon:['Ակտիվացումը պետք է լինի առնվազն 24 ժամ հետո։','Активация должна быть не раньше чем через 24 часа.','Activation must be at least 24 hours ahead.'],
short:['Պատճառը շատ կարճ է։','Причина слишком короткая.','Reason is too short.'],
c409:['Քաղաքականությունը փոխվել է։ Թարմացված տարբերակը բեռնվեց, կրկնեք։','Политика изменилась. Загружена актуальная версия, повторите.','The policy changed. The latest version was loaded; try again.'],
c403:['Թույլտվություն չկա կամ պահանջվում է MFA հաստատում։','Нет прав или требуется подтверждение MFA.','Not permitted, or MFA verification is required.'],
refresh:['Թարմացնել կարգավիճակը','Обновить статус','Refresh status'],reverify:['Կրկին հաստատել (գաղտնաբառ + MFA)','Подтвердить заново (пароль + MFA)','Re-verify (password + MFA)'],fresh:['Հաստատումը վավեր է 15 րոպե։','Подтверждение действует 15 минут.','Verification is valid for 15 minutes.'],gen:['Չհաջողվեց պահպանել։','Не удалось сохранить.','Could not save.'],
bad:['Ստուգեք ամսաթիվը (UTC, ձևաչափ՝ ՏՏՏՏ-ԱԱ-ՕՕ ԺԺ:ՐՐ)։','Проверьте дату (UTC, формат ГГГГ-ММ-ДД ЧЧ:ММ).','Check the date (UTC, format YYYY-MM-DD HH:MM).']} as const;
const iso=(v:string|null)=>v?new Date(v).toISOString().slice(0,16).replace('T',' '):'';
export default function MfaPolicy({c,language}:{c:RoleContext;language:Language}){
const t=(k:keyof typeof S)=>S[k][language==='hy'?0:language==='ru'?1:2];
const [d,setD]=useState<Policy>(),[err,setErr]=useState(false),[req,setReq]=useState(false),[when,setWhen]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[msg,setMsg]=useState<{ok:boolean;text:string}>(),[reauth,setReauth]=useState(false);
const load=useCallback((signal?:{stale:boolean})=>{setErr(false);return request<Policy>('/mfa/policy').then(p=>{if(signal?.stale)return;setD(p);setReq(p.policy.required);setWhen(iso(p.policy.enforceAfter))}).catch(()=>{if(!signal?.stale)setErr(true)})},[]);
useEffect(()=>{const s={stale:false};setD(undefined);void load(s);return()=>{s.stale=true}},[c.id,load]);
async function submit(e:FormEvent){e.preventDefault();if(busy||!d)return;setMsg(undefined);
 let enforceAfter:string|null=null;
 if(req){const m=/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(when.trim());const dt=m?new Date(`${m[1]}T${m[2]}:00.000Z`):null;
  if(!dt||isNaN(dt.getTime()))return setMsg({ok:false,text:t('bad')});
  if(dt.getTime()<Date.now()+864e5)return setMsg({ok:false,text:t('tooSoon')});enforceAfter=dt.toISOString()}
 if(reason.trim().length<8)return setMsg({ok:false,text:t('short')});
 setBusy(true);
 try{const r=await request<Policy|{policy:Policy['policy']}>('/mfa/policy','PUT',{required:req,enforceAfter,version:d.policy.version,reason:reason.trim()});
  setReason('');setMsg({ok:true,text:t('ok')});await load()}
 catch(x){const s=x instanceof ApiClientError?x.status:0;
  if(s===409){await load();setMsg({ok:false,text:t('c409')})}else if(s===403)setMsg({ok:false,text:t('c403')});else setMsg({ok:false,text:t('gen')})}
 finally{setBusy(false)}}
if(err)return <section className="p-card"><h2>{t('title')}</h2><p className="p-error" role="alert">{t('loadErr')}</p><button className="p-button" onClick={()=>void load()}>{t('retry')}</button></section>;
if(!d)return <section className="p-card" aria-busy="true"><h2>{t('title')}</h2><p>{t('load')}</p></section>;
const ready=d.enrolled&&d.verified;
return <section className="p-card"><h2>{t('title')}</h2>
<p><strong>{d.policy.required?t('required'):t('optional')}</strong>{d.policy.required&&<> · {d.enforced?t('enforced'):<>{t('grace')} {iso(d.policy.enforceAfter)} UTC</>}</>}</p>
<p>{t(d.enrolled?'enrolled':'notEnrolled')} · {t(d.verified?'verified':'notVerified')} <small>({t('fresh')})</small></p>
<p><button type="button" className="p-button" onClick={()=>void load()}>{t('refresh')}</button>{d.canManage&&<> <button type="button" className="p-button" onClick={()=>setReauth(true)}>{t('reverify')}</button></>}</p>
{reauth&&<ReauthPrompt freshnessMinutes={15} language={language} onCancel={()=>setReauth(false)} onDone={()=>{setReauth(false);setMsg(undefined);void load()}}/>}
{!d.canManage?<p className="p-info">{t('how')}</p>:<form className="p-edit-form" onSubmit={submit}>
{!ready&&<p className="p-info" role="status">{t('need')}</p>}
<label><input type="checkbox" checked={req} onChange={e=>setReq(e.target.checked)}/> {t('req')}</label>
{req&&<label>{t('when')}<input value={when} onChange={e=>setWhen(e.target.value)} placeholder="2030-01-31 09:00" aria-describedby="mfa-when-h" required/><small id="mfa-when-h">{t('whenHint')}</small></label>}
<label>{t('reason')}<input value={reason} onChange={e=>setReason(e.target.value)} minLength={8} maxLength={500} required/></label>
<button className="p-button" disabled={busy||!ready}>{busy?t('saving'):t('save')}</button>
{msg&&<p className={msg.ok?'p-info':'p-error'} role={msg.ok?'status':'alert'}>{msg.text}</p>}</form>}
</section>}
