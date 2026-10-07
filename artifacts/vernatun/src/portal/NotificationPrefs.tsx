import {useEffect,useState,type FormEvent} from 'react';
import type {Language} from './i18n';
import {request} from './client';
type Pref={version:number;email_enabled:boolean;in_app_enabled:boolean;categories:Record<string,{email?:boolean;in_app?:boolean}>};
const labels:Record<string,[string,string,string]>={requests:['Заявки и SLA','Requests and SLA','Հայտեր և SLA'],finance:['Финансы','Finance','Ֆինանսներ'],community:['Объявления и собрания','Community','Համայնք'],access:['Пропуска','Passes','Անցագրեր'],leases:['Аренда','Leases','Վարձակալություն'],support:['Поддержка','Support','Աջակցություն'],onboarding:['Внедрение','Onboarding','Ներդրում'],system:['Система','System','Համակարգ']};
export default function NotificationPrefs({language:l}:{language:Language}){
 const tx=(ru:string,en:string,hy:string)=>l==='ru'?ru:l==='en'?en:hy;
 const [p,setP]=useState<Pref>(),[cats,setCats]=useState<string[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false);
 useEffect(()=>{let active=true;Promise.all([request<Pref>('/notifications/preferences'),request<{categories:string[]}>('/notifications/catalog')]).then(([p,c])=>{if(active){setP(p);setCats(c.categories)}}).catch(e=>{if(active)setError(String(e.message??e))});return()=>{active=false}},[]);
 async function save(e:FormEvent){e.preventDefault();if(!p||busy)return;setBusy(true);setError('');setSaved(false);try{setP(await request<Pref>('/notifications/preferences','PUT',p));setSaved(true)}catch(e:any){setError(String(e.message??e))}finally{setBusy(false)}}
 function category(k:string,ch:'email'|'in_app',v:string){if(!p)return;const next={...p.categories[k]};if(v==='inherit')delete next[ch];else next[ch]=v==='on';setP({...p,categories:{...p.categories,[k]:next}});setSaved(false)}
 return <section className="p-card"><h2>{tx('Настройки уведомлений','Notification preferences','Ծանուցումների կարգավորումներ')}</h2>
 <p>{tx('Применяются к новым уведомлениям. История не удаляется. Email ожидает готовности домена; SMS/push не подключены.','Applies to future notifications, without deleting history. Email awaits domain readiness; SMS/push are not connected.','Կիրառվում է նոր ծանուցումներին՝ առանց պատմությունը ջնջելու։ Email-ը սպասում է դոմենին, SMS/push միացված չեն։')}</p>
 {error&&<p className="p-error" role="alert">{error} <button className="p-button" onClick={()=>location.reload()}>{tx('Перезагрузить','Reload','Վերբեռնել')}</button></p>}
 {!p&&!error?<p role="status">{tx('Загрузка…','Loading…','Բեռնվում է…')}</p>:p&&<form onSubmit={save}><fieldset disabled={busy} style={{border:0,padding:0}}>
 <p>{tx('Общие переключатели отключают канал для всех категорий. Категории дополнительно ограничивают включённый канал.','Global switches disable the channel for all categories. Categories further limit an enabled channel.','Ընդհանուր անջատիչը անջատում է ալիքը բոլոր կատեգորիաների համար։ Կատեգորիաները սահմանափակում են միացված ալիքը։')}</p>
 <label><input type="checkbox" checked={p.in_app_enabled} onChange={e=>{setP({...p,in_app_enabled:e.target.checked});setSaved(false)}}/> {tx('В приложении','In app','Հավելվածում')}</label><br/>
 <label><input type="checkbox" checked={p.email_enabled} onChange={e=>{setP({...p,email_enabled:e.target.checked});setSaved(false)}}/> Email</label>
 {cats.map(k=><div key={k} className="p-edit-form" style={{marginTop:12}}><strong>{labels[k]?.[l==='ru'?0:l==='en'?1:2]??k}</strong>{(['in_app','email'] as const).map(ch=><label key={ch}>{ch==='email'?'Email':tx('В приложении','In app','Հավելվածում')}<select value={p.categories[k]?.[ch]===undefined?'inherit':p.categories[k][ch]?'on':'off'} onChange={e=>category(k,ch,e.target.value)}><option value="inherit">{tx('По общим настройкам','Use global setting','Ընդհանուր կարգավորում')}</option><option value="on">{tx('Включено','On','Միացված')}</option><option value="off">{tx('Выключено','Off','Անջատված')}</option></select></label>)}</div>)}
 <p>{tx('Оповещения о безопасности аккаунта обязательны независимо от этих настроек.','Account security notifications are mandatory regardless of these settings.','Հաշվի անվտանգության ծանուցումները պարտադիր են։')}</p>
 <button className="p-button orange">{busy?tx('Сохранение…','Saving…','Պահպանվում է…'):tx('Сохранить','Save','Պահպանել')}</button>
 </fieldset></form>}{saved&&<p role="status">{tx('Настройки сохранены','Preferences saved','Կարգավորումները պահպանված են')}</p>}</section>
}
