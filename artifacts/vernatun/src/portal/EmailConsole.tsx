import {useState,useEffect,useCallback,useRef} from 'react';
import {request} from './client';
import {errText,fmtDate} from './console-util';
import type {Language} from './i18n';
import type {RoleContext} from './types';
import './console.css';
type Row=Record<string,any>;
const S:Record<string,[string,string,string]>={
 title:['Էլ․ փոստի գործառնություններ (միայն կարդալ)','Операции email (только чтение)','Email operations (read-only)'],
 provider:['Մատակարար','Провайдер','Provider'],sender:['Ուղարկող','Отправитель','Sender'],
 configured_unverified:['Կարգավորված է, ստուգված չէ','Настроен, не проверен','Configured, not verified'],not_configured:['Կարգավորված չէ','Не настроен','Not configured'],
 notReady:['Կարգավորված վիճակը չի նշանակում, որ տվյալները կամ դոմենը ստուգված են։ Ստորագրված իրադարձություն դեռ չի ստացվել, արտադրական պատրաստությունը չի հաստատվում։ Դոմենը դեռ պատրաստ չէ։','Статус «настроен» не означает, что ключи или домен проверены. Подписанное событие ещё не получено, готовность к продакшену не подтверждена. Домен пока не готов.','Configured does not mean credentials or domain are verified. No signed event has been received yet, so production readiness is not confirmed. The domain is not ready.'],
 notReadyShort:['Ստորագրված իրադարձություն չի ստացվել։','Подписанное событие не получено.','No signed event received.'],
 live:['Կենդանի ստուգում չի կատարվել։ Թեստային նամակ չի ուղարկվում։','Живая проверка не выполнялась. Тестовые письма не отправляются.','Live verification not performed. No test emails are sent.'],
 target:['Ապագա webhook՝ https://vernatun.io/api/webhooks/resend','Будущий webhook: https://vernatun.io/api/webhooks/resend','Future webhook: https://vernatun.io/api/webhooks/resend'],
 complaintWarn:['Այս ժամանակահատվածում կան սպամի բողոքներ՝ ','В периоде есть жалобы на спам: ','Spam complaints in this period: '],
 rate:['Առաքման տոկոս','Доля доставки','Delivery rate'],period:['Ժամանակահատված','Период','Period'],
 lastAccepted:['Վերջին ընդունված','Последнее принято','Last accepted'],lastDelivered:['Վերջին առաքված','Последнее доставлено','Last delivered'],lastBounce:['Վերջին մերժում','Последний отказ','Last bounce'],lastComplaint:['Վերջին բողոք','Последняя жалоба','Last complaint'],lastFailure:['Վերջին ձախողում','Последняя ошибка','Last failure'],
 webhook:['Webhook','Webhook','Webhook'],wConf:['Կարգավորված','Настроен','Configured'],wSig:['Ստորագրության ստուգում պատրաստ','Проверка подписи готова','Signature verification ready'],wLast:['Վերջին իրադարձություն','Последнее событие','Last event'],wValid:['Վերջին վավեր','Последнее валидное','Last valid event'],wInvalid:['Վերջին անվավեր ստորագրություն','Последняя неверная подпись','Last invalid signature'],wFail:['Վերջին խափանումներ','Недавние сбои','Recent failures'],
 yes:['Այո','Да','Yes'],no:['Ոչ','Нет','No'],
 messages:['Նամակներ','Сообщения','Messages'],recipient:['Ստացող','Получатель','Recipient'],businessType:['Տեսակ','Тип','Type'],status:['Կարգավիճակ','Статус','Status'],created:['Ստեղծված','Создано','Created'],lastEvent:['Վերջին իրադարձություն','Последнее событие','Last event'],msgId:['Նամակի ID','ID письма','Message ID'],
 from:['Սկսած','С','From'],to:['Մինչև','По','To'],all:['Բոլորը','Все','All'],apply:['Կիրառել','Применить','Apply'],refresh:['Թարմացնել','Обновить','Refresh'],retry:['Կրկնել','Повторить','Retry'],loading:['Բեռնվում է…','Загрузка…','Loading…'],empty:['Նամակներ չկան։','Сообщений нет.','No messages.'],
 prev:['Նախորդ','Назад','Previous'],next:['Հաջորդ','Далее','Next'],page:['Էջ','Страница','Page'],total:['Ընդամենը','Всего','Total'],close:['Փակել','Закрыть','Close'],
 accepted_at:['Ընդունվել է','Принято','Accepted at'],events:['Իրադարձություններ','События','Events'],outcome:['Արդյունք','Исход','Outcome'],occurred:['Տեղի է ունեցել','Произошло','Occurred'],received:['Ստացվել է','Получено','Received'],noEvents:['Իրադարձություններ չկան։','Событий нет.','No events.'],scope:['Շրջանակ','Область','Scope'],
 s_unknown:['Անհայտ','Неизвестно','Unknown'],s_local:['Տեղական','Локально','Local'],s_accepted:['Ընդունված','Принято','Accepted'],s_sent:['Ուղարկված','Отправлено','Sent'],s_delayed:['Ուշացած','Задержано','Delayed'],s_delivered:['Առաքված','Доставлено','Delivered'],s_bounced:['Մերժված','Отклонено','Bounced'],s_complained:['Բողոք','Жалоба','Complained'],s_failed:['Ձախողված','Ошибка','Failed'],
 b_invitation:['Հրավեր','Приглашение','Invitation'],b_password_reset:['Գաղտնաբառի վերականգնում','Сброс пароля','Password reset'],b_delegation:['Լիազորում','Делегирование','Delegation'],b_notification:['Ծանուցում','Уведомление','Notification'],b_platform_invoice:['Հաշիվ','Счёт платформы','Platform invoice'],b_support:['Աջակցություն','Поддержка','Support'],b_other:['Այլ','Другое','Other'],
 note:['Առաքված նշանակում է՝ ստացողի սերվերն ընդունել է։ Բացումներ և սեղմումներ չեն հետևվում։','Доставлено означает, что сервер адресата принял письмо. Открытия и клики не отслеживаются.','Delivered means the recipient server accepted the message. Opens and clicks are not tracked.']};
const STATUSES=['unknown','local','accepted','sent','delayed','delivered','bounced','complained','failed'],TYPES=['invitation','password_reset','delegation','notification','platform_invoice','support','other'];
const L={en:2,ru:1,hy:0} as const;
const day=(d:Date)=>d.toISOString().slice(0,10);
export default function EmailConsole({c,language}:{c:RoleContext;language:Language}){
 const t=(k:string)=>(S[k]??[k,k,k])[L[language]];
 const [from,setFrom]=useState(()=>day(new Date(Date.now()-29*864e5))),[to,setTo]=useState(()=>day(new Date()));
 const [f,setF]=useState({status:'',provider:'',businessType:'',recipient:''});
 const [applied,setApplied]=useState({from,to,...f});
 const [page,setPage]=useState(1);
 const [health,setHealth]=useState<Row>(),[list,setList]=useState<Row>(),[err,setErr]=useState('');
 const [sel,setSel]=useState<string>(),[detail,setDetail]=useState<Row>(),[dErr,setDErr]=useState('');
 const seq=useRef(0),dseq=useRef(0),ctx=useRef(c.id);ctx.current=c.id;
 const load=useCallback(async()=>{
  const n=++seq.current;const q=new URLSearchParams({from:applied.from,to:applied.to});
  const m=new URLSearchParams({page:String(page),pageSize:'20',from:applied.from,to:applied.to});
  for(const k of ['status','provider','businessType','recipient'] as const)if(applied[k])m.set(k,applied[k]);
  try{const [h,l]=await Promise.all([request<Row>('/platform/email/health?'+q),request<Row>('/platform/email/messages?'+m)]);
   if(n===seq.current&&ctx.current===c.id){setHealth(h);setList(l);setErr('')}}
  catch(e){if(n===seq.current)setErr(errText(language,e))}
 },[applied,page,language,c.id]);
 useEffect(()=>{void load()},[load]);
 useEffect(()=>{let k=0;const id=window.setInterval(()=>{if(++k>10){window.clearInterval(id);return}if(document.visibilityState==='visible')void load()},30000);return()=>window.clearInterval(id)},[load]);
 useEffect(()=>{if(!sel){setDetail(undefined);return}const n=++dseq.current;setDetail(undefined);setDErr('');
  request<Row>('/platform/email/messages/'+encodeURIComponent(sel)).then(d=>{if(n===dseq.current)setDetail(d)}).catch(e=>{if(n===dseq.current)setDErr(errText(language,e))})},[sel,language]);
 const counts=health?.counts??{},complaints=Number(counts.complained??0);
 const pages=list?Math.max(1,Math.ceil(list.total/list.pageSize)):1;
 const w=health?.webhook;
 const st=(s:string)=>S['s_'+s]?t('s_'+s):s;
 const kv=(k:string,v:any)=><div key={k} className="cx-row"><strong>{t(k)}:</strong><span>{v}</span></div>;
 const yn=(b:boolean)=>t(b?'yes':'no');
 return <div className="p-business cx-wrap">
  <h2>{t('title')}</h2>
  <p className="cx-warn" role="note">{t('notReady')}</p>
  <p className="p-info">{t('live')} {t('target')}</p>
  {err&&<div role="alert"><p className="p-error">{err}</p><button className="p-button" onClick={()=>void load()}>{t('retry')}</button></div>}
  {complaints>0&&<p className="p-error cx-warn" role="alert">{t('complaintWarn')}{complaints}</p>}
  {!health?(!err&&<p role="status">{t('loading')}</p>):<div className="cx-grid">
   <section className="p-card"><h3>{t('provider')}</h3>
    {kv('provider',health.provider)}{kv('status',t(health.providerStatus))}{kv('sender',health.sender??'—')}
    {kv('period',health.period.from+' — '+health.period.to)}{kv('rate',health.deliveryRate==null?'—':(health.deliveryRate*100>100?health.deliveryRate:health.deliveryRate*100).toFixed(1)+'%')}
    {['lastAccepted','lastDelivered','lastBounce','lastComplaint','lastFailure'].map(k=>kv(k,fmtDate(health[k],language)))}
    <div className="cx-row">{STATUSES.map(s=><span key={s} className="p-badge amber">{st(s)}: {counts[s]??0}</span>)}</div></section>
   <section className="p-card"><h3>{t('webhook')}</h3>
    {kv('wConf',yn(w.configured))}{kv('wSig',yn(w.signatureVerificationReady))}{kv('wLast',fmtDate(w.lastEventReceived,language))}{kv('wValid',fmtDate(w.lastValidEvent,language))}{kv('wInvalid',fmtDate(w.lastInvalidSignature,language))}{kv('wFail',w.recentFailures)}
    {!w.lastValidEvent&&<p className="cx-warn">{t('notReadyShort')}</p>}<p className="p-info">{t('note')}</p></section></div>}
  <section className="p-card"><h3>{t('messages')}</h3>
   <form className="cx-filters cx-form" onSubmit={e=>{e.preventDefault();setPage(1);setApplied({from,to,...f})}}>
    <label>{t('from')}<input type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)} required/></label>
    <label>{t('to')}<input type="date" value={to} min={from} onChange={e=>setTo(e.target.value)} required/></label>
    <label>{t('status')}<select value={f.status} onChange={e=>setF({...f,status:e.target.value})}><option value="">{t('all')}</option>{STATUSES.map(s=><option key={s} value={s}>{st(s)}</option>)}</select></label>
    <label>{t('businessType')}<select value={f.businessType} onChange={e=>setF({...f,businessType:e.target.value})}><option value="">{t('all')}</option>{TYPES.map(s=><option key={s} value={s}>{t('b_'+s)}</option>)}</select></label>
    <label>{t('provider')}<input value={f.provider} maxLength={40} onChange={e=>setF({...f,provider:e.target.value})}/></label>
    <label>{t('recipient')}<input value={f.recipient} maxLength={100} onChange={e=>setF({...f,recipient:e.target.value})}/></label>
    <div className="cx-row"><button className="p-button orange">{t('apply')}</button><button type="button" className="p-button" onClick={()=>void load()}>{t('refresh')}</button></div></form>
   {!list?(!err&&<p role="status">{t('loading')}</p>):<div className="cx-scroll"><table className="cx-table"><thead><tr><th>{t('created')}</th><th>{t('recipient')}</th><th>{t('businessType')}</th><th>{t('provider')}</th><th>{t('status')}</th><th>{t('lastEvent')}</th></tr></thead><tbody>
    {list.items.map((r:Row)=><tr key={r.id} aria-selected={sel===r.id}><td><button className="p-button" onClick={()=>setSel(r.id)}>{fmtDate(r.created_at,language)}</button></td><td>{r.recipient_masked}</td><td>{TYPES.includes(r.business_type)?t('b_'+r.business_type):r.business_type}</td><td>{r.provider}</td><td>{st(r.status)}</td><td>{fmtDate(r.last_event_at,language)}</td></tr>)}
    {!list.items.length&&<tr><td colSpan={6}>{t('empty')}</td></tr>}</tbody></table></div>}
   {list&&<div className="cx-row"><button className="p-button" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>{t('prev')}</button><span>{t('page')} {page} / {pages} · {t('total')}: {list.total}</span><button className="p-button" disabled={page>=pages} onClick={()=>setPage(p=>p+1)}>{t('next')}</button></div>}</section>
  {sel&&<section className="p-card" aria-live="polite"><div className="cx-row"><h3>{t('events')}</h3><button className="p-button" onClick={()=>setSel(undefined)}>{t('close')}</button></div>
   {dErr&&<p className="p-error" role="alert">{dErr}</p>}{!detail&&!dErr&&<p role="status">{t('loading')}</p>}
   {detail&&<><div className="cx-grid"><div>{kv('msgId',detail.message.provider_message_id_short??'—')}{kv('status',st(detail.message.status))}{kv('sender',detail.message.sender??'—')}{kv('scope',detail.message.provider_scope??'—')}</div><div>{kv('created',fmtDate(detail.message.created_at,language))}{kv('accepted_at',fmtDate(detail.message.accepted_at,language))}</div></div>
    {!detail.events.length?<p>{t('noEvents')}</p>:<div className="cx-scroll"><table className="cx-table"><thead><tr><th>{t('events')}</th><th>{t('outcome')}</th><th>{t('occurred')}</th><th>{t('received')}</th><th/></tr></thead><tbody>{detail.events.map((e:Row,i:number)=><tr key={i}><td>{e.event_type}</td><td>{e.outcome}</td><td>{fmtDate(e.occurred_at,language)}</td><td>{fmtDate(e.received_at,language)}</td><td><pre className="cx-pre">{JSON.stringify(e.safe_metadata??{},null,1)}</pre></td></tr>)}</tbody></table></div>}</>}</section>}
 </div>}
