import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {RefreshCw,Send} from 'lucide-react';
import {request} from './client';
import PlatformNotificationsConsole from './PlatformNotificationsConsole';
import {fmtDate} from './console-util';
import type {Language} from './i18n';
import type {RoleContext} from './types';
import './console.css';

type Row=Record<string,any>;
type Target={type:'building'|'user';id?:string};
const strings={
  hy:{title:'Ծանուցումների բաժին',inbox:'Ստացված ծանուցումներ',empty:'Դեռ ծանուցումներ չկան։',refresh:'Թարմացնել',send:'Նոր ծանուցում',audience:'Ստացողներ',allResidents:'Իմ շենքի բոլոր բնակիչները',oneResident:'Մեկ բնակիչ',resident:'Բնակիչ',subject:'Վերնագիր',body:'Հաղորդագրություն',preview:'Ստուգել ստացողներին',count:'Ստացողներ',submit:'Ուղարկել հավելվածում',sent:'Ծանուցումն ուղարկվել է բնակիչներին։',building:'Շենք',sending:'Ուղարկվում է…',noBuilding:'Ուղարկելու համար ընտրեք կառավարչի՝ կոնկրետ շենքի միջավայրը։',history:'Ուղարկված հաղորդագրություններ',noneSent:'Դեռ ուղարկված հաղորդագրություններ չկան։',confirm:'Ուղարկե՞լ այս ծանուցումը ընտրված բնակիչներին։',unread:'Չընթերցված',push:'Web Push',pushStatus:'Կարգավորված չէ',pushDetails:'Բրաուզերի push-ը կակտիվացվի opt-in բաժանորդագրությունից և սերվերի կողմից կառավարվող VAPID բանալիներից հետո։ Այս պահին ծանուցումները հասանելի են հավելվածի ներսում։'},
 ru:{title:'Центр рассылок',inbox:'Полученные рассылки',empty:'Пока нет полученных рассылок.',refresh:'Обновить',send:'Новое уведомление',audience:'Кому отправить',allResidents:'Всем жителям моего здания',oneResident:'Одному жителю',resident:'Житель',subject:'Заголовок',body:'Текст уведомления',preview:'Проверить получателей',count:'Получателей',submit:'Отправить в приложении',sent:'Уведомление отправлено жителям.',building:'Здание',sending:'Отправка…',noBuilding:'Для отправки выберите контекст управляющего с назначенным зданием.',history:'Отправленные сообщения',noneSent:'Отправленных уведомлений пока нет.',confirm:'Отправить уведомление выбранным жителям?',unread:'Не прочитано',push:'Web Push',pushStatus:'Не настроен',pushDetails:'Web Push можно включить после добровольной подписки браузера и настройки серверных VAPID-ключей. Сейчас уведомления доступны внутри приложения.'},
 en:{title:'Broadcast center',inbox:'Received broadcasts',empty:'No broadcasts received yet.',refresh:'Refresh',send:'New notification',audience:'Recipients',allResidents:'All residents in my building',oneResident:'One resident',resident:'Resident',subject:'Title',body:'Notification text',preview:'Preview recipients',count:'Recipients',submit:'Send in app',sent:'Notification sent to residents.',building:'Building',sending:'Sending…',noBuilding:'Choose a manager context assigned to a specific building to send.',history:'Sent messages',noneSent:'No notifications sent yet.',confirm:'Send this notification to the selected residents?',unread:'Unread',push:'Web Push',pushStatus:'Not configured',pushDetails:'Web Push can be enabled after browser opt-in subscriptions and server-managed VAPID keys are configured. Notifications currently appear in the app inbox.'},
} as const;

export default function BroadcastsConsole({c,language}:{c:RoleContext;language:Language}){
 const t=strings[language],canPlatform=c.role_key==='platform_admin',canManager=c.role_key==='manager'&&c.permissions.includes('announcements.manage');
 const [inbox,setInbox]=useState<Row[]>(),[sent,setSent]=useState<Row[]>([]),[residents,setResidents]=useState<Row[]>([]);
 const [targetType,setTargetType]=useState<'building'|'user'>('building'),[residentId,setResidentId]=useState('');
 const [title,setTitle]=useState(''),[body,setBody]=useState(''),[preview,setPreview]=useState<number>();
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const loadInbox=useCallback(async()=>{setError('');try{setInbox(await request<Row[]>('/broadcasts/inbox'))}catch(e){setError(String((e as Error).message??e))}},[]);
 const loadSent=useCallback(async()=>{try{setSent(await request<Row[]>('/broadcasts/sent'))}catch(e){setError(String((e as Error).message??e))}},[]);
 useEffect(()=>{void loadInbox();if(canManager&&c.building_id&&c.organization_id){void loadSent();request<{residents:Row[]}>('/broadcasts/targets').then(r=>setResidents(r.residents)).catch(e=>setError(String((e as Error).message??e)))}
  const timer=window.setInterval(()=>void loadInbox(),30000);return()=>window.clearInterval(timer);
 },[c.id,canManager,c.building_id,c.organization_id,loadInbox,loadSent]);
 const target:Target=targetType==='building'?{type:'building'}:{type:'user',...(residentId?{id:residentId}:{})};
 async function previewAudience(){setBusy(true);setError('');setNotice('');try{const r=await request<{count:number}>('/broadcasts/preview','POST',{target});setPreview(r.count)}catch(e){setError(String((e as Error).message??e))}finally{setBusy(false)}}
 async function submit(e:FormEvent){e.preventDefault();if(busy||preview===undefined||!preview||!title.trim()||!body.trim())return;
  if(!window.confirm(t.confirm))return;
  setBusy(true);setError('');setNotice('');
  try{await request('/broadcasts','POST',{target,title:title.trim(),body:body.trim(),expectedRecipients:preview,idempotencyKey:crypto.randomUUID()});
   setTitle('');setBody('');setPreview(undefined);setNotice(t.sent);await Promise.all([loadSent(),loadInbox()]);
  }catch(e){setError(String((e as Error).message??e))}finally{setBusy(false)}
 }
 async function markRead(row:Row){try{const result=await request<Row>('/notifications/'+row.id+'/read','POST',{});setInbox(old=>old?.map(x=>x.id===row.id?{...x,read_at:result.read_at??new Date().toISOString()}:x));window.dispatchEvent(new CustomEvent('vernatun-notifications-changed',{detail:{broadcast:true}}))}catch(e){setError(String((e as Error).message??e))}}
 return <div className="p-business cx-wrap">
  {canPlatform&&<PlatformNotificationsConsole c={c} language={language}/>}
  {canManager&&<section className="p-card" aria-busy={busy}>
   <h2>{t.send}</h2>
   {!c.building_id||!c.organization_id?<p className="p-info">{t.noBuilding}</p>:<form onSubmit={submit}>
    <div className="cx-filters"><label>{t.audience}<select value={targetType} onChange={e=>{setTargetType(e.target.value as 'building'|'user');setPreview(undefined)}}><option value="building">{t.allResidents}</option><option value="user">{t.oneResident}</option></select></label>
     {targetType==='user'&&<label>{t.resident}<select required value={residentId} onChange={e=>{setResidentId(e.target.value);setPreview(undefined)}}><option value="">—</option>{residents.map(r=><option key={r.id} value={r.id}>{r.name} · {r.email}</option>)}</select></label>}
    </div>
    <p className="p-muted-note">{t.building}: <strong>{c.building_name??'—'}</strong></p>
    <div className="cx-filters"><label>{t.subject}<input maxLength={140} required value={title} onChange={e=>setTitle(e.target.value)}/></label></div>
    <label>{t.body}<textarea rows={4} maxLength={5000} required value={body} onChange={e=>setBody(e.target.value)}/></label>
    <div className="cx-row"><button type="button" className="p-button" disabled={busy||targetType==='user'&&!residentId} onClick={()=>void previewAudience()}>{t.preview}</button>
     {preview!==undefined&&<span aria-live="polite">{t.count}: <strong>{preview}</strong></span>}
     <button className="p-button orange" disabled={busy||preview===undefined||preview<1||!title.trim()||!body.trim()}><Send size={16}/>{busy?t.sending:t.submit}</button>
    </div>
   </form>}
   {notice&&<p role="status" className="p-success">{notice}</p>}{error&&<p role="alert" className="p-error">{error}</p>}
  </section>}
  {canManager&&<section className="p-card"><h2>{t.history}</h2>{sent.length?sent.map(r=><article className="p-message" key={r.id}><strong>{r.title}</strong><p>{fmtDate(r.created_at,language)} · {r.recipient_count} · {r.target_type==='user'?residents.find(x=>x.id===r.target_id)?.name??t.resident:t.allResidents}</p><p>{r.body}</p></article>):<p>{t.noneSent}</p>}</section>}
  {(canPlatform||canManager)&&<section className="p-card"><header className="cx-row"><h2>{t.push}</h2><span className="p-badge">{t.pushStatus}</span></header><p>{t.pushDetails}</p></section>}
  <section className="p-card"><header className="cx-row"><h2>{t.inbox}</h2><button className="p-button" type="button" onClick={()=>void loadInbox()}><RefreshCw size={16}/>{t.refresh}</button></header>
   {!inbox&&<p role="status">{language==='ru'?'Загрузка…':language==='hy'?'Բեռնվում է…':'Loading…'}</p>}
   {inbox&&!inbox.length&&<p>{t.empty}</p>}
   {inbox?.map(r=><article className="p-message" key={r.id}><strong>{r.title}</strong><p>{fmtDate(r.created_at,language)} · {r.read_at?null:<span className="p-badge">{t.unread}</span>}</p><p className="p-prewrap">{r.body}</p>
    {!r.read_at&&<button className="p-button" type="button" onClick={()=>void markRead(r)}>{language==='ru'?'Отметить прочитанным':language==='hy'?'Նշել որպես կարդացված':'Mark as read'}</button>}
   </article>)}
  </section>
 </div>
}
