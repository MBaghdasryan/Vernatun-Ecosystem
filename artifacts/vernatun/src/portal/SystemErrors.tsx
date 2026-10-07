import {useCallback,useEffect,useRef,useState} from 'react';
import {getSystemErrors,getSystemError,updateSystemError,type SystemErrors as ErrorsPage,type SystemErrorDetail,type SystemErrorGroup,type GetSystemErrorsParams} from '@workspace/api-client-react';
import {fmtDate} from './console-util';
import {getCsrfHeaders} from './client';
import type {Language} from './i18n';

const L=(l:Language)=>l==='hy'?0:l==='ru'?1:2;
const S:Record<string,[string,string,string]>={
 all:['Բոլորը','Все','All'],open:['Բաց','Открыта','Open'],resolved:['Լուծված','Решена','Resolved'],
 message:['Սխալ','Ошибка','Error'],service:['Ծառայություն','Сервис','Service'],category:['Կատեգորիա','Категория','Category'],
 firstSeen:['Առաջին անգամ','Впервые','First seen'],lastSeen:['Վերջին անգամ','Последний раз','Last seen'],occurrences:['Դեպքեր','Случаи','Occurrences'],
 users:['Օգտատերեր','Пользователи','Users'],orgs:['Կազմակերպություններ','Организации','Organizations'],status:['Կարգավիճակ','Статус','Status'],
 requestId:['Վերջին հարցման ID','ID последнего запроса','Latest request ID'],fingerprint:['Fingerprint','Fingerprint','Fingerprint'],
 eventRequestId:['Հարցման ID','ID запроса','Request ID'],actorId:['Օգտատիրոջ ID','ID пользователя','User ID'],orgId:['Կազմակերպության ID','ID организации','Organization ID'],
 diagnostics:['Դեպքի ախտորոշում','Диагностика события','Event diagnostics'],
 environment:['Վերջին դեպքի միջավայր','Окружение последнего события','Latest event environment'],version:['Վերջին դեպքի API build ID','ID сборки API последнего события','Latest event API build ID'],
 stack:['Անվտանգ կոդի տողեր','Безопасные строки вызовов','Safe call locations'],notRecorded:['Չի գրանցվել','Не записано','Not recorded'],
 details:['Մանրամասներ','Подробнее','Details'],hide:['Թաքցնել','Скрыть','Hide'],refresh:['Թարմացնել','Обновить','Refresh'],retry:['Կրկնել','Повторить','Retry'],
 loading:['Բեռնվում է…','Загрузка…','Loading…'],error:['Չհաջողվեց բեռնել տվյալները։','Не удалось загрузить данные.','Could not load data.'],forbidden:['Այս բաժնի համար թույլտվություն չկա։','Нет разрешения на этот раздел.','You do not have permission for this section.'],
 empty:['Սխալների խմբեր չկան։','Групп ошибок нет.','No error groups.'],prev:['Նախորդ','Назад','Previous'],next:['Հաջորդ','Далее','Next'],page:['Էջ','Страница','Page'],
 resolve:['Նշել լուծված','Отметить решённой','Mark resolved'],reopen:['Վերաբացել','Открыть снова','Reopen'],saving:['Պահպանվում է…','Сохранение…','Saving…'],
 confirmResolve:['Նշե՞լ այս սխալների խումբը որպես լուծված։ Նոր դեպքի դեպքում այն կրկին կբացվի։','Отметить эту группу ошибок решённой? При новом случае она откроется снова.','Mark this error group resolved? It reopens if the error recurs.'],
 conflict:['Խումբը փոխվել է այլ տեղ կամ կրկնվել է։ Տվյալները թարմացվել են — ստուգեք և կրկնեք։','Группа изменилась или ошибка повторилась. Данные обновлены — проверьте и повторите.','The group changed elsewhere or recurred. Data was reloaded — review and try again.'],
 saved:['Կարգավիճակը թարմացվեց։','Статус обновлён.','Status updated.'],saveFailed:['Չհաջողվեց թարմացնել կարգավիճակը։','Не удалось обновить статус.','Could not update status.'],
 recurred:['Կրկնվել է լուծումից հետո','Повторилась после решения','Recurred after resolution'],
 events:['Վերջին իրադարձությունները','Последние события','Latest events'],more:['Ցուցադրված են վերջին 50-ը․ կան ավելի հին իրադարձություններ «Մատյաններ»-ում։','Показаны последние 50; более ранние — в «Журналах».','Showing latest 50; older events are in Logs.'],
 time:['Ժամանակ','Время','Time'],level:['Մակարդակ','Уровень','Level'],event:['Իրադարձություն','Событие','Event'],endpoint:['Endpoint','Endpoint','Endpoint'],http:['HTTP','HTTP','HTTP'],code:['Կոդ','Код','Code'],
 note:['Ցուցադրվում են միայն անվտանգ կոդեր և մետատվյալներ։ Ավտոթարմացում՝ 30 վ։','Только безопасные коды и метаданные. Автообновление: 30 с.','Safe codes and metadata only. Auto-refresh: 30 s.'],
 readonly:['Միայն դիտում՝ կարգավիճակը փոխելու թույլտվություն չկա։','Только просмотр: нет права менять статус.','Read-only: no permission to change status.'],
};
const statusOf=(e:unknown)=>typeof e==='object'&&e&&'status' in e?Number((e as {status:unknown}).status):0;

function usePolled<T>(fetcher:(signal:AbortSignal)=>Promise<T>,key:string,enabled=true){
 const [data,setData]=useState<T>();const [error,setError]=useState<unknown>();const [loading,setLoading]=useState(true);
 const ctrl=useRef<AbortController|undefined>(undefined);const fRef=useRef(fetcher);fRef.current=fetcher;
 const load=useCallback(()=>{ctrl.current?.abort();const c=new AbortController();ctrl.current=c;setLoading(true);
  fRef.current(c.signal).then(d=>{if(!c.signal.aborted){setData(d);setError(undefined)}}).catch(e=>{if(!c.signal.aborted){setError(e);setData(undefined)}}).finally(()=>{if(!c.signal.aborted)setLoading(false)})},[]);
 useEffect(()=>{setData(undefined);setError(undefined);if(!enabled)return;load();const id=setInterval(load,30000);const focus=()=>load();window.addEventListener('focus',focus);
  return()=>{clearInterval(id);window.removeEventListener('focus',focus);ctrl.current?.abort()}},[key,load,enabled]);
 return {data,error,loading,reload:load,setData};
}

function Failure({error,l,onRetry,tx}:{error:unknown;l:Language;onRetry:()=>void;tx:(k:string)=>string}){const st=statusOf(error);void l;return <div className="sc-failure" role="alert" data-testid="status-errors-error"><p className="p-error">{st===403?tx('forbidden'):tx('error')+(st?' (HTTP '+st+')':'')}</p><button className="p-button" onClick={onRetry} data-testid="button-retry-errors">{tx('retry')}</button></div>}
function Skeleton(){return <div className="sc-skeleton" role="status" aria-busy="true" data-testid="status-errors-loading"><span/><span/><span/></div>}
function StatusPill({s,tx}:{s:string;tx:(k:string)=>string}){return <span className={'p-badge sc-pill '+(s==='open'?'red':'green')} data-testid={'status-error-'+s}>{tx(s)}</span>}

type Filter='all'|'open'|'resolved';

function Detail({fp,ck,l,canManage,onChanged}:{fp:string;ck:string;l:Language;canManage:boolean;onChanged:()=>void}){
 const tx=(k:string)=>S[k][L(l)];
 const q=usePolled<SystemErrorDetail>(signal=>getSystemError(fp,{signal,credentials:'include'}),ck+':err:'+fp);
 const [pending,setPending]=useState(false);const [msg,setMsg]=useState<{t:string;bad?:boolean}>();
 const resolvedAt=useRef<string|null>(null);
 const ctl=useRef<AbortController|null>(null);
 useEffect(()=>()=>ctl.current?.abort(),[]);
 const g=q.data?.group;
 const recurred=!!g&&g.status==='open'&&resolvedAt.current!==null&&g.lastEventId!==resolvedAt.current;
 const toggle=async(gr:SystemErrorGroup)=>{
  const status=gr.status==='open'?'resolved':'open';
  if(status==='resolved'&&!window.confirm(tx('confirmResolve')))return;
  const c=new AbortController();ctl.current=c;setPending(true);setMsg(undefined);
  try{
   const updated=await updateSystemError(fp,{status,lastEventId:gr.lastEventId,occurrences:gr.occurrences,revision:gr.revision},{credentials:'include',headers:getCsrfHeaders(),signal:c.signal});
   if(c.signal.aborted)return;
   resolvedAt.current=updated.status==='resolved'?updated.lastEventId:null;
   q.setData(d=>d?{...d,group:updated}:d);setMsg({t:tx('saved')});onChanged();q.reload();
  }catch(e){if(c.signal.aborted)return;const st=statusOf(e);setMsg({t:st===409?tx('conflict'):st===403?tx('forbidden'):tx('saveFailed'),bad:true});if(st===409){q.reload();onChanged()}}
  finally{if(!c.signal.aborted)setPending(false)}
 };
 if(q.error)return <Failure error={q.error} l={l} onRetry={q.reload} tx={tx}/>;
 if(!q.data||!g)return <Skeleton/>;
 const d=q.data;const ev=d.events.items;
 const nr=(v:string|null,id:string)=>v===null?<dd className="sc-null" data-testid={'text-error-'+id}>{tx('notRecorded')}</dd>:<dd className="sc-mono" data-testid={'text-error-'+id}>{v}</dd>;
 return <div className="se-detail" aria-busy={q.loading} data-testid={'detail-error-'+fp}>
  <div className="sc-head"><div><span className="sc-label">{tx('status')}</span><span className="se-inline"><StatusPill s={g.status} tx={tx}/>{recurred&&<span className="p-badge sc-pill amber" data-testid="status-error-recurred">{tx('recurred')}</span>}</span></div>
   {canManage?<button className={'p-button small'+(g.status==='open'?' orange':'')} disabled={pending||q.loading} onClick={()=>void toggle(g)} data-testid={'button-toggle-error-'+fp}>{pending?tx('saving'):g.status==='open'?tx('resolve'):tx('reopen')}</button>:<span className="sc-note se-ro" data-testid="text-errors-readonly">{tx('readonly')}</span>}</div>
  {msg&&<p role={msg.bad?'alert':'status'} className={msg.bad?'p-error':'sc-note'} data-testid="text-error-action">{msg.t}</p>}
  <dl className="se-dl">
   <div><dt>{tx('fingerprint')}</dt><dd className="sc-mono">{g.fingerprint}</dd></div>
   <div><dt>{tx('requestId')}</dt><dd className="sc-mono">{g.latestRequestId??'—'}</dd></div>
   <div><dt>{tx('environment')}</dt>{nr(d.environment,'environment')}</div>
   <div><dt>{tx('version')}</dt>{nr(d.applicationVersion,'version')}</div>
   <div><dt>{tx('stack')}</dt>{d.stackTrace===null?nr(null,'stack'):<dd><pre className="sc-mono se-pre" data-testid="text-error-stack">{d.stackTrace}</pre></dd>}</div>
  </dl>
  <h4 className="sc-label se-h">{tx('events')} ({ev.length})</h4>
  <div className="cx-scroll"><table className="cx-table sc-table"><thead><tr><th>{tx('time')}</th><th>{tx('level')}</th><th>{tx('event')}</th><th>{tx('endpoint')}</th><th>{tx('http')}</th><th>{tx('code')}</th><th>{tx('eventRequestId')}</th><th>{tx('actorId')}</th><th>{tx('orgId')}</th></tr></thead><tbody>
   {ev.map(e=>[
    <tr key={e.id} data-testid={'row-error-event-'+e.id}><td>{fmtDate(e.createdAt,l)}</td><td><span className={'sc-level sc-level-'+e.level}>{e.level}</span></td><td className="sc-mono">{e.event}</td><td className="sc-mono">{e.method?e.method+' ':''}{e.endpoint??'—'}</td><td>{e.status??'—'}</td><td className="sc-mono">{e.errorCode??'—'}</td><td className="sc-mono">{e.requestId??'—'}</td><td className="sc-mono">{e.actorId??'—'}</td><td className="sc-mono">{e.organizationId??'—'}</td></tr>,
    <tr key={e.id+':diagnostics'}><td colSpan={9}><details data-testid={'event-diagnostics-'+e.id}><summary>{tx('diagnostics')} · {e.id}</summary><p className="sc-mono">{e.applicationVersion??tx('notRecorded')} · {e.environment??tx('notRecorded')}</p><pre className="sc-mono se-pre">{e.stackTrace??tx('notRecorded')}</pre></details></td></tr>
   ])}
   {!ev.length&&<tr><td colSpan={9} className="sc-empty">{S.empty[L(l)]}</td></tr>}
  </tbody></table></div>
  {d.events.hasMore&&<p className="sc-note" data-testid="text-error-events-more">{tx('more')}</p>}
 </div>;
}

export default function SystemErrors({ck,l,canManage}:{ck:string;l:Language;canManage:boolean}){
 const tx=(k:string)=>S[k][L(l)];
 const [filter,setFilter]=useState<Filter>('all');const [page,setPage]=useState(1);const [open,setOpen]=useState<string>();
 const params=():GetSystemErrorsParams=>filter==='all'?{page}:{page,status:filter};
 const q=usePolled<ErrorsPage>(signal=>getSystemErrors(params(),{signal,credentials:'include'}),ck+':errors:'+filter+':'+page);
 const items=q.data?.items??[];
 return <div className="sc-stack" data-testid="system-errors">
  <section className="p-card sc-card"><div className="cx-row se-bar">
   <div className="se-seg" role="group" aria-label={tx('status')}>{(['all','open','resolved'] as Filter[]).map(f=><button key={f} type="button" aria-pressed={filter===f} className={filter===f?'selected':''} onClick={()=>{setFilter(f);setPage(1);setOpen(undefined)}} data-testid={'filter-errors-'+f}>{tx(f)}</button>)}</div>
   <button className="p-button small" disabled={q.loading} onClick={q.reload} data-testid="button-refresh-errors">{q.loading?tx('loading'):tx('refresh')}</button>
  </div><p className="sc-note">{tx('note')}</p></section>
  {q.error?<Failure error={q.error} l={l} onRetry={q.reload} tx={tx}/>:!q.data?<Skeleton/>:<section className="p-card sc-card" aria-busy={q.loading}>
   <div className="cx-scroll"><table className="cx-table sc-table se-table"><thead><tr><th>{tx('message')}</th><th>{tx('service')}</th><th>{tx('status')}</th><th>{tx('occurrences')}</th><th>{tx('users')}</th><th>{tx('orgs')}</th><th>{tx('firstSeen')}</th><th>{tx('lastSeen')}</th><th><span className="sr-only">{tx('details')}</span></th></tr></thead><tbody>
    {items.map(g=>[<tr key={g.fingerprint} className={open===g.fingerprint?'se-open':''} data-testid={'row-error-'+g.fingerprint}>
      <td><strong className="sc-mono" data-testid={'text-error-message-'+g.fingerprint}>{g.message}</strong><div className="sc-note se-sub">{g.category}</div></td>
      <td className="sc-mono">{g.service}</td><td><StatusPill s={g.status} tx={tx}/></td>
      <td data-testid={'text-error-occurrences-'+g.fingerprint}><strong>{g.occurrences}</strong></td><td>{g.affectedUsers}</td><td>{g.affectedOrganizations}</td>
      <td>{fmtDate(g.firstSeen,l)}</td><td>{fmtDate(g.lastSeen,l)}</td>
      <td><button className="p-button small" aria-expanded={open===g.fingerprint} onClick={()=>setOpen(o=>o===g.fingerprint?undefined:g.fingerprint)} data-testid={'button-error-details-'+g.fingerprint}>{open===g.fingerprint?tx('hide'):tx('details')}</button></td></tr>,
     open===g.fingerprint&&<tr key={g.fingerprint+':d'} className="sc-detail"><td colSpan={9}><Detail key={ck+':'+g.fingerprint} fp={g.fingerprint} ck={ck} l={l} canManage={canManage} onChanged={q.reload}/></td></tr>])}
    {!items.length&&<tr><td colSpan={9} className="sc-empty" data-testid="text-errors-empty">{tx('empty')}</td></tr>}
   </tbody></table></div>
   <div className="cx-row" aria-live="polite"><button className="p-button" disabled={q.loading||page<=1} onClick={()=>{setPage(p=>p-1);setOpen(undefined)}} data-testid="button-prev-errors">{tx('prev')}</button><span data-testid="text-page-errors">{tx('page')} {page}</span><button className="p-button" disabled={q.loading||!q.data.hasMore} onClick={()=>{setPage(p=>p+1);setOpen(undefined)}} data-testid="button-next-errors">{tx('next')}</button></div>
  </section>}
 </div>;
}
