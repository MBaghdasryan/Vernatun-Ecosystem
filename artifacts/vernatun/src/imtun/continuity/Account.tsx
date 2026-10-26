import {useEffect,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {confirmResidentEmailVerification,startResidentEmailVerification,updateResidentNotificationSettings} from '@workspace/api-client-react';
import type {ResidentContinuity,ResidentNotificationSettings} from '@workspace/api-client-react';
import type {RoleContext} from '../../portal/types';
import type {Language} from '../../portal/i18n';
import {viewRoute} from '../../../shared/products';
import {useAct} from '../superapp/useAct';
import {contKey,tt,status} from './core';
import Avatar from './Avatar';
import Household from './Household';
import Payer from './Payer';
import './continuity.css';
const COOL=60;
function Email({d,l,refresh}:{d:ResidentContinuity;l:Language;refresh:()=>void}){
 const [sent,setSent]=useState(false),[code,setCode]=useState(''),[left,setLeft]=useState(0),a=useAct(l,refresh),[note,setNote]=useState('');
 useEffect(()=>{if(left<=0)return;const id=window.setTimeout(()=>setLeft(left-1),1000);return()=>window.clearTimeout(id)},[left]);
 const start=()=>{setNote('');void a.run(async()=>{try{await startResidentEmailVerification();setSent(true);setLeft(COOL)}catch(e){if(status(e)===429){setLeft(COOL);setNote(tt(l,'Խնդրում ենք սպասել նախքան նոր կոդ պահանջելը։','Подождите перед повторной отправкой кода.','Please wait before requesting another code.'))}else throw e}})};
 return <section className="im-card sx-form" aria-labelledby="cx-email"><h3 id="cx-email">{tt(l,'Էլ. փոստի հաստատում','Подтверждение почты','Email verification')}</h3>
 <p>{d.email||'—'} <span className={'cx-badge '+(d.emailVerified?'ok':'')}>{d.emailVerified?tt(l,'Հաստատված է','Подтверждена','Verified'):tt(l,'Չհաստատված','Не подтверждена','Not verified')}</span></p>
 {!d.emailVerified&&<>
 <button type="button" className="im-button" disabled={a.busy||left>0} onClick={start}>{left>0?tt(l,`Կրկին ուղարկել ${left} վրկ հետո`,`Отправить снова через ${left} с`,`Resend in ${left}s`):sent?tt(l,'Կրկին ուղարկել կոդը','Отправить код снова','Resend code'):tt(l,'Ուղարկել կոդը','Отправить код','Send code')}</button>
 {sent&&<form className="sx-form" onSubmit={e=>{e.preventDefault();void a.run(async()=>{await confirmResidentEmailVerification({code});setCode('');setSent(false)})}}>
 <label>{tt(l,'6-նիշ կոդ','6-значный код','6-digit code')}<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))}/></label>
 <button className="im-button" disabled={a.busy||code.length!==6}>{tt(l,'Հաստատել','Подтвердить','Confirm')}</button></form>}</>}
 {note&&<p role="status">{note}</p>}{a.err&&<p role="alert" className="sx-err">{a.err}</p>}</section>}
function Notify({v,l,refresh}:{v:ResidentNotificationSettings;l:Language;refresh:()=>void}){
 const [s,setS]=useState(v),[ok,setOk]=useState(false),a=useAct(l,refresh);
 const set=<K extends keyof ResidentNotificationSettings>(k:K,x:ResidentNotificationSettings[K])=>{setOk(false);setS({...s,[k]:x})};
 const zones=typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('timeZone'):[];
 const conflict=a.err&&/changed|изменил|փոխվել/.test(a.err);
 return <form className="im-card sx-form" aria-labelledby="cx-notif" onSubmit={e=>{e.preventDefault();void a.run(async()=>{await updateResidentNotificationSettings(s);setOk(true)})}}><h3 id="cx-notif">{tt(l,'Ծանուցումներ','Уведомления','Notifications')}</h3>
 <label className="sx-check"><input type="checkbox" checked={s.emailEnabled} onChange={e=>set('emailEnabled',e.target.checked)}/>{tt(l,'Էլ. փոստով','По почте','By email')}</label>
 <label className="sx-check"><input type="checkbox" checked={s.inAppEnabled} onChange={e=>set('inAppEnabled',e.target.checked)}/>{tt(l,'Հավելվածում','В приложении','In app')}</label>
 <label className="sx-check"><input type="checkbox" checked={s.quietEnabled} onChange={e=>set('quietEnabled',e.target.checked)}/>{tt(l,'Լռության ժամեր','Тихие часы','Quiet hours')}</label>
 {s.quietEnabled&&<div className="cx-row"><label>{tt(l,'Սկիզբ','С','From')}<input type="time" required value={s.quietStart} onChange={e=>set('quietStart',e.target.value)}/></label><label>{tt(l,'Ավարտ','До','To')}<input type="time" required value={s.quietEnd} onChange={e=>set('quietEnd',e.target.value)}/></label>
 <label>{tt(l,'Ժամային գոտի','Часовой пояс','Time zone')}<input list="cx-zones" required value={s.timezone} onChange={e=>set('timezone',e.target.value)}/></label><datalist id="cx-zones">{zones.map(z=><option key={z} value={z}/>)}</datalist></div>}
 <small>{tt(l,'Լռության ժամերը հետաձգում են ոչ կրիտիկական ծանուցումները․ էլ. փոստի աշխատողը դեռ կարգավորված չէ, իսկ անվտանգության կոդերը ուղարկվում են անմիջապես։','Тихие часы откладывают некритичные уведомления. Почтовый обработчик пока не настроен; коды безопасности отправляются сразу.','Quiet hours defer non-critical notifications. The email worker is not configured yet; security codes are always sent immediately.')}</small>
 <button className="im-button" disabled={a.busy}>{tt(l,'Պահպանել','Сохранить','Save')}</button>
 {ok&&<p role="status">{tt(l,'Պահպանված է','Сохранено','Saved')}</p>}{a.err&&<p role="alert" className="sx-err">{a.err}{conflict?' '+tt(l,'Ցուցադրված են թարմ տվյալները։','Показаны актуальные настройки.','Latest settings are shown.'):''}</p>}</form>}
export default function Account({c,l,d}:{c:RoleContext;l:Language;d:ResidentContinuity}){
 const qc=useQueryClient(),refresh=()=>{void qc.invalidateQueries({queryKey:contKey(c.id)})},act=d.activation;
 return <div className="cx sx-root">
 {act&&<section className="im-card" aria-labelledby="cx-act"><h3 id="cx-act">{tt(l,'Ակտիվացում','Активация','Activation')} <span className={'cx-badge '+(act.ready?'ok':'')}>{act.ready?tt(l,'Պատրաստ է','Готово','Ready'):act.required?tt(l,'Պարտադիր է','Требуется','Required'):tt(l,'Ոչ պարտադիր','Не требуется','Not required')}</span></h3>
 <ul className="cx-list"><li>{act.emailVerified?'✓ ':'○ '}{tt(l,'Էլ. փոստը հաստատված է','Почта подтверждена','Email verified')}</li>
 <li>{act.missingAgreements===0?'✓ ':'○ '}{act.missingAgreements===0?tt(l,'Պարտադիր համաձայնագրերը ընդունված են','Обязательные соглашения приняты','Mandatory agreements accepted'):tt(l,`Չընդունված պարտադիր համաձայնագրեր՝ ${act.missingAgreements}`,`Не принято обязательных соглашений: ${act.missingAgreements}`,`Mandatory agreements pending: ${act.missingAgreements}`)}
 {act.missingAgreements>0&&<> <a className="sx-link" href={viewRoute('imtun','agreements',c.role_key)}>{tt(l,'Բացել համաձայնագրերը','Открыть соглашения','Open agreements')}</a></>}</li></ul></section>}
 <Email d={d} l={l} refresh={refresh}/>
 <section className="im-card"><h3>{tt(l,'Հեռախոսի հաստատում','Подтверждение телефона','Phone verification')}</h3><p>{tt(l,'SMS մատակարարը կարգավորված չէ, հեռախոսը հաստատել հնարավոր չէ։ (PROVIDER_REQUIRED)','SMS-провайдер не подключён, подтвердить телефон пока нельзя. (PROVIDER_REQUIRED)','No SMS provider is configured, so the phone cannot be verified yet. (PROVIDER_REQUIRED)')}</p></section>
 <Avatar l={l} available={d.avatarAvailable===true} ctx={c.id} refresh={refresh}/>
 <Household c={c} l={l}/>
 <Payer c={c} l={l}/>
 <Notify key={d.notificationSettings.version} v={d.notificationSettings} l={l} refresh={refresh}/></div>}
