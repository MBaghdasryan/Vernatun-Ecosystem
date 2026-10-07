import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {getApiCenter,createApiClient,setApiClientStatus,createManagedApiKey,actManagedApiKey,type GetApiCenter200,type ManagedApiClient,type ManagedApiKey,type CreateApiClientBodyClientType} from '@workspace/api-client-react';
import {fmtDate} from './console-util';
import {getCsrfHeaders} from './client';
import {ReauthPrompt,needsReauth,reauthDone} from './Reauth';
import type {Language} from './i18n';

type T3=[string,string,string];
const L=(l:Language)=>l==='hy'?0:l==='ru'?1:2;
const S:Record<string,T3>={
 title:['API կենտրոն','API-центр','API Center'],
 loading:['Բեռնվում է…','Загрузка…','Loading…'],retry:['Կրկնել','Повторить','Retry'],refresh:['Թարմացնել','Обновить','Refresh'],cancel:['Չեղարկել','Отмена','Cancel'],close:['Փակել','Закрыть','Close'],
 forbidden:['Այս բաժնի համար թույլտվություն չկա։','Нет разрешения на этот раздел.','You do not have permission for this section.'],error:['Չհաջողվեց բեռնել տվյալները։','Не удалось загрузить данные.','Could not load data.'],
 boundary:['Արտաքին API-ի սահմաններ','Границы внешнего API','External API boundaries'],
 b1:['/api/v1-ը միայն կարդալու համար է՝ առողջություն, գույքեր, միավորներ և հայտեր։ Գրելու endpoint-ներ չկան։','/api/v1 только для чтения: состояние, объекты, помещения и заявки. Эндпоинтов записи нет.','/api/v1 is read-only: health, properties, units and requests. There are no write endpoints.'],
 b2:['API scope-երը առանձին են վահանակի թույլտվություններից․ բանալին երբեք չի ստանում օգտատիրոջ դեր կամ UI հասանելիություն։','API-скоупы отделены от прав консоли: ключ никогда не получает роль пользователя или доступ к UI.','API scopes are separate from console permissions: a key never receives a user role or UI access.'],
 b3:['Scope-երը միտումնավոր ներառում են միայն իրականացված endpoint-ները։ Վճարումներ կամ բանկեր միացված չեն։','Скоупы намеренно покрывают только реализованные эндпоинты. Платежи и банки не подключены.','Scopes intentionally cover only implemented endpoints. No payments or banks are connected.'],
 b4:['Այս վահանակը արտաքին հարցումներ չի կատարում և հարցումների փորձարկիչ չունի։ API փաստաթղթերը կավելացվեն առանձին։','Консоль не выполняет внешних запросов и не содержит тестера запросов. Документация API будет добавлена отдельно.','This console makes no external calls and has no request tester. API documentation will be added separately.'],
 scopes:['Հասանելի scope-եր','Доступные скоупы','Available scopes'],
 clients:['Կլիենտներ','Клиенты','Clients'],total:['Ընդամենը՝ {n}','Всего: {n}','Total: {n}'],empty:['API կլիենտներ դեռ չկան։','API-клиентов пока нет.','No API clients yet.'],
 newClient:['Նոր կլիենտ','Новый клиент','New client'],name:['Անուն','Название','Name'],description:['Նկարագրություն','Описание','Description'],org:['Կազմակերպության UUID','UUID организации','Organization UUID'],orgHint:['Բիզնես scope-երը պահանջում են կազմակերպություն։ Միայն platform.health.read-ը կարող է լինել գլոբալ։','Бизнес-скоупы требуют организацию. Глобальным может быть только platform.health.read.','Business scopes require an organization. Only platform.health.read alone may be global.'],
 type:['Տեսակ','Тип','Type'],platform:['Հարթակ','Платформа','Platform'],organization:['Կազմակերպություն','Организация','Organization'],integration:['Ինտեգրում','Интеграция','Integration'],machine_to_machine:['Մեքենա-մեքենա','Машина-машина','Machine to machine'],
 ips:['Թույլատրված IP-ներ (ճշգրիտ հասցեներ, մեկ տողում մեկ)','Разрешённые IP (точные адреса, по одному на строку)','Allowed IPs (exact addresses, one per line)'],ipsHint:['Դատարկ՝ առանց IP սահմանափակման։ CIDR չի ընդունվում։','Пусто — без ограничения по IP. CIDR не принимается.','Empty means no IP restriction. CIDR is not accepted.'],
 badIp:['Անվավեր IP՝ {v}','Неверный IP: {v}','Invalid IP: {v}'],badOrg:['Անվավեր UUID','Неверный UUID','Invalid UUID'],needOrg:['Ընտրված scope-երի համար պահանջվում է կազմակերպություն։','Для выбранных скоупов нужна организация.','The selected scopes require an organization.'],needScope:['Ընտրեք առնվազն մեկ scope։','Выберите хотя бы один скоуп.','Select at least one scope.'],
 typeConfirm:['Հաստատելու համար մուտքագրեք','Для подтверждения введите','Type to confirm'],create:['Ստեղծել','Создать','Create'],
 active:['Ակտիվ','Активен','Active'],disabled:['Անջատված','Отключён','Disabled'],enable:['Միացնել','Включить','Enable'],disable:['Անջատել','Отключить','Disable'],global:['Գլոբալ','Глобальный','Global'],
 created:['Ստեղծված','Создан','Created'],lastUsed:['Վերջին օգտագործում','Последнее использование','Last used'],never:['Երբեք','Никогда','Never'],anyIp:['Ցանկացած IP','Любой IP','Any IP'],
 keys:['Բանալիներ','Ключи','Keys'],noKeys:['Բանալիներ չկան։','Ключей нет.','No keys.'],newKey:['Նոր բանալի','Новый ключ','New key'],
 expires:['Ժամկետ','Истекает','Expires'],rpm:['Հարցում/րոպե (1–300)','Запросов/мин (1–300)','Requests/min (1–300)'],prefix:['Նախածանց','Префикс','Prefix'],revoked:['Չեղարկված','Отозван','Revoked'],expired:['Ժամկետանց','Истёк','Expired'],
 badExp:['Ժամկետը պետք է լինի ապագայում և ոչ ավել քան 366 օր։','Срок должен быть в будущем и не более 366 дней.','Expiry must be in the future and at most 366 days away.'],badRpm:['1-ից 300 ամբողջ թիվ։','Целое от 1 до 300.','Whole number from 1 to 300.'],
 rotate:['Պտտել','Ротировать','Rotate'],revoke:['Չեղարկել','Отозвать','Revoke'],
 rotateWarn:['Պտտումը ատոմար կերպով չեղարկում է ընթացիկ բանալին և թողարկում փոխարինող։ Հին գաղտնիքն անմիջապես դադարում է աշխատել։','Ротация атомарно отзывает текущий ключ и выпускает замену. Старый секрет сразу перестаёт работать.','Rotation atomically revokes the current key and issues a replacement. The old secret stops working immediately.'],
 revokeWarn:['Չեղարկումը անդառնալի է։','Отзыв необратим.','Revocation is irreversible.'],
 statusWarn:['Կլիենտի անջատումը արգելափակում է նրա բոլոր բանալիները։','Отключение клиента блокирует все его ключи.','Disabling a client blocks all of its keys.'],
 secretTitle:['Գաղտնիքը ցուցադրվում է միայն մեկ անգամ','Секрет показывается только один раз','The secret is shown only once'],
 secretNote:['Պատճենեք հիմա և պահեք անվտանգ վայրում։ Այն չի պահվում դիտարկիչում և կթաքցվի փակելիս կամ համատեքստը փոխելիս։','Скопируйте сейчас и сохраните в надёжном месте. Он не хранится в браузере и будет скрыт при закрытии или смене контекста.','Copy it now and store it safely. It is not stored in the browser and will be hidden on close or context change.'],
 copy:['Պատճենել','Копировать','Copy'],copied:['Պատճենված է','Скопировано','Copied'],done:['Պահպանել եմ, թաքցնել','Сохранил, скрыть','I saved it, hide'],
 clientOk:['Կլիենտը ստեղծված է։','Клиент создан.','Client created.'],statusOk:['Կարգավիճակը թարմացված է։','Статус обновлён.','Status updated.'],revokeOk:['Բանալին չեղարկված է։','Ключ отозван.','Key revoked.'],
 prev:['Նախորդ','Назад','Previous'],next:['Հաջորդ','Далее','Next'],page:['Էջ','Страница','Page'],readOnly:['Միայն դիտում․ կառավարման թույլտվություն չկա։','Только просмотр: нет прав управления.','View only: no management permission.'],
};
const ERR:Record<string,T3>={
 rate:['Չափազանց շատ հարցումներ։ Սպասեք։','Слишком много запросов. Подождите.','Too many requests. Wait a moment.'],
 forbidden:['Թույլտվություն չկա։','Нет разрешения.','Not permitted.'],
 not_found:['Չի գտնվել։','Не найдено.','Not found.'],
 conflict:['Վիճակը փոխվել է։ Թարմացրեք։','Состояние изменилось. Обновите.','State changed. Refresh.'],
 invalid:['Տվյալները մերժվել են սերվերի կողմից։','Данные отклонены сервером.','The server rejected the input.'],
 failed:['Գործողությունը չհաջողվեց։','Действие не выполнено.','The action failed.'],
};
const POLL=30000;const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IPV4=/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const isIp=(s:string)=>IPV4.test(s)||(/^[0-9a-f:]+$/i.test(s)&&s.includes(':')&&s.split('::').length<=2);
const GLOBAL_OK='platform.health.read';
const statusOf=(e:unknown)=>typeof e==='object'&&e&&'status' in e?Number((e as {status:unknown}).status):0;
const codeOf=(e:unknown)=>{if(typeof e==='object'&&e&&'code' in e&&typeof (e as {code:unknown}).code==='string')return (e as {code:string}).code;const d=typeof e==='object'&&e&&'data' in e?(e as {data:unknown}).data:null;if(d&&typeof d==='object'){const o=d as Record<string,unknown>;if(typeof o.error==='string')return o.error;if(typeof o.code==='string')return o.code}return ''};
const isReauth=(e:unknown)=>needsReauth(e)||codeOf(e)==='recent_authentication_required';
const TYPES:CreateApiClientBodyClientType[]=['organization','integration','machine_to_machine','platform'];
const pad=(n:number)=>String(n).padStart(2,'0');
const localInput=(d:Date)=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());

type Perms={clients:boolean;keys:boolean};
type Secret={keyId:string;name:string;value:string;rotated:boolean};
export default function ApiCenter({ck,l,perms}:{ck:string;l:Language;perms:Perms}){
 const t=(k:string)=>S[k]?.[L(l)]??k;
 const errText=(e:unknown)=>{const c=codeOf(e),st=statusOf(e);const base=st===429?ERR.rate:st===403?ERR.forbidden:st===404?ERR.not_found:st===409?ERR.conflict:st===400||st===422?ERR.invalid:ERR.failed;return base[L(l)]+(c&&c!=='recent_authentication_required'?' ('+c+')':'')};
 const [page,setPage]=useState(1);
 const [data,setData]=useState<GetApiCenter200>();const [qErr,setQErr]=useState<unknown>();const [loading,setLoading]=useState(true);
 const qc=useRef<AbortController|null>(null);const per=useRef(0);
 const load=useCallback(()=>{qc.current?.abort();const c=new AbortController();qc.current=c;setLoading(true);
  getApiCenter({page},{signal:c.signal,credentials:'include'}).then(d=>{if(c.signal.aborted)return;per.current=Math.max(per.current,d.clients.length);setData(d);setQErr(undefined)}).catch(e=>{if(!c.signal.aborted){setQErr(e);setData(undefined)}}).finally(()=>{if(!c.signal.aborted)setLoading(false)})},[page]);
 useEffect(()=>{load();const id=setInterval(load,POLL);const f=()=>load();window.addEventListener('focus',f);return()=>{clearInterval(id);window.removeEventListener('focus',f);qc.current?.abort()}},[load]);
 const [msg,setMsg]=useState<{t:string;bad?:boolean}>();const [reauth,setReauth]=useState(false);const [busy,setBusy]=useState('');
 const [secret,setSecret]=useState<Secret>();const [showNew,setShowNew]=useState(false);
 const [act,setAct]=useState<{kind:'status'|'rotate'|'revoke'|'newKey';client:ManagedApiClient;key?:ManagedApiKey}>();
 const mc=useRef<AbortController|null>(null);
 // Secret lives only in this component's state; cleared on unmount via key=ck remount and on hide.
 useEffect(()=>()=>{mc.current?.abort();setSecret(undefined)},[]);
 const run=async(tag:string,fn:(s:AbortSignal)=>Promise<string>)=>{if(busy)return false;const c=new AbortController();mc.current=c;setBusy(tag);setMsg(undefined);
  try{const r=await fn(c.signal);if(c.signal.aborted)return false;if(r)setMsg({t:r});load();return true}
  catch(e){if(c.signal.aborted)return false;if(isReauth(e)){setReauth(true);return false}setMsg({t:errText(e),bad:true});load();return false}
  finally{if(!c.signal.aborted)setBusy('')}};
 const opts=(signal:AbortSignal)=>({signal,credentials:'include' as const,headers:getCsrfHeaders()});
 const d=data;const pageSize=per.current||1;const hasMore=!!d&&d.clients.length>0&&(page-1)*pageSize+d.clients.length<d.total;
 const canMut=perms.clients||perms.keys;
 return <div className="sc-stack" data-testid="system-api">
  <section className="p-card sc-card ac-hero">
   <div className="sc-head"><h3 className="sb-h">{t('boundary')}</h3><button className="p-button small" onClick={load} disabled={loading} data-testid="button-refresh-api">{t('refresh')}</button></div>
   <ol className="ac-rules">{['b1','b2','b3','b4'].map(k=><li key={k}>{t(k)}</li>)}</ol>
   {!canMut&&<p className="sc-note" data-testid="text-api-readonly">{t('readOnly')}</p>}
  </section>
  {qErr?<div className="sc-failure" role="alert" data-testid="status-error"><p className="p-error">{statusOf(qErr)===403?t('forbidden'):t('error')+(statusOf(qErr)?' (HTTP '+statusOf(qErr)+')':'')}</p><button className="p-button" onClick={load} data-testid="button-retry">{t('retry')}</button></div>
  :!d?<div className="sc-skeleton" role="status" aria-busy="true" data-testid="status-loading"><span/><span/><span/></div>:<>
   <section className="p-card sc-card"><h3 className="sb-h">{t('scopes')}</h3>
    <div className="ac-chips" data-testid="list-api-scopes">{d.scopes.map(s=><code key={s} className={'ac-chip sc-mono'+(s===GLOBAL_OK?' g':'')}>{s}</code>)}</div>
    <p className="sc-note">{t('orgHint')}</p>
   </section>
   {secret&&<SecretPanel s={secret} t={t} onHide={()=>setSecret(undefined)}/>}
   {reauth&&<ReauthPrompt language={l} onDone={()=>{setReauth(false);setMsg({t:reauthDone(l)})}} onCancel={()=>setReauth(false)}/>}
   {msg&&<p className={msg.bad?'p-error':'p-info'} role="status" data-testid="status-api-action">{msg.t}</p>}
   {perms.clients&&(showNew?<ClientForm key={ck} scopes={d.scopes} t={t} busy={busy==='client'} onCancel={()=>setShowNew(false)} onSubmit={body=>run('client',async s=>{await createApiClient({...body,confirmation:'API CLIENT'},opts(s));setShowNew(false);return t('clientOk')})}/>
    :<div className="cx-row"><button className="p-button orange" onClick={()=>{setMsg(undefined);setShowNew(true)}} data-testid="button-new-client">{t('newClient')}</button></div>)}
   {act&&<ActionForm key={act.kind+':'+act.client.id+':'+(act.key?.id??'')} a={act} t={t} l={l} busy={busy==='act'} onCancel={()=>setAct(undefined)} onSubmit={async body=>{
    const a=act;let ok=false;
    if(a.kind==='status'){const next=a.client.status==='active'?'disabled':'active';ok=await run('act',async s=>{await setApiClientStatus(a.client.id,{status:next,confirmation:'API CLIENT'},opts(s));return t('statusOk')})}
    else if(a.kind==='newKey'&&body){ok=await run('act',async s=>{const r=await createManagedApiKey(a.client.id,{...body,confirmation:'API KEY'},opts(s));if(r.secret&&!s.aborted)setSecret({keyId:r.id,name:body.name,value:r.secret,rotated:false});return ''})}
    else if(a.key){const k=a.key;const action=a.kind==='rotate'?'rotate':'revoke';ok=await run('act',async s=>{const r=await actManagedApiKey(k.id,action,{confirmation:'API KEY'},opts(s));if(action==='rotate'&&r.secret&&!s.aborted){setSecret({keyId:r.id,name:k.name,value:r.secret,rotated:true});return ''}return t('revokeOk')})}
    if(ok)setAct(undefined)}}/>}
   <section className="p-card sc-card" aria-busy={loading}>
    <div className="sc-head"><h3 className="sb-h">{t('clients')}</h3><small className="sc-note" data-testid="text-api-total">{t('total').replace('{n}',String(d.total))}</small></div>
    {!d.clients.length?<p className="sc-empty" data-testid="text-empty"><strong>{t('empty')}</strong></p>:
    <div className="ac-list">{d.clients.map(c=>{const keys=d.keys.filter(k=>k.clientId===c.id);const on=c.status==='active';return <article key={c.id} className={'ac-client'+(on?'':' off')} data-testid={'card-client-'+c.id}>
     <header className="ac-ch"><div><strong>{c.name}</strong> <span className={'p-badge sc-pill '+(on?'green':'grey')} data-testid={'status-client-'+c.id}>{t(on?'active':'disabled')}</span> <span className="p-badge sc-pill grey">{t(c.clientType)}</span>
      {c.description&&<p className="sc-note">{c.description}</p>}</div>
      <div className="cx-row">{perms.clients&&<button className="p-button small" disabled={!!busy} onClick={()=>{setMsg(undefined);setAct({kind:'status',client:c})}} data-testid={'button-status-client-'+c.id}>{t(on?'disable':'enable')}</button>}
       {perms.keys&&on&&<button className="p-button small orange" disabled={!!busy} onClick={()=>{setMsg(undefined);setAct({kind:'newKey',client:c})}} data-testid={'button-new-key-'+c.id}>{t('newKey')}</button>}</div></header>
     <dl className="ac-meta"><div><dt>{t('organization')}</dt><dd className="sc-mono sb-wrap">{c.organizationId??t('global')}</dd></div><div><dt>{t('created')}</dt><dd>{fmtDate(c.createdAt,l)}</dd></div><div><dt>{t('lastUsed')}</dt><dd>{c.lastUsedAt?fmtDate(c.lastUsedAt,l):t('never')}</dd></div><div><dt>IP</dt><dd className="sc-mono sb-wrap">{c.allowedIps.length?c.allowedIps.join(', '):t('anyIp')}</dd></div></dl>
     <div className="ac-chips">{c.allowedScopes.map(s=><code key={s} className="ac-chip sc-mono">{s}</code>)}</div>
     <div className="cx-scroll"><table className="cx-table sc-table"><thead><tr><th>{t('name')}</th><th>{t('prefix')}</th><th>{t('scopes')}</th><th>{t('rpm')}</th><th>{t('expires')}</th><th>{t('lastUsed')}</th><th><span className="sr-only">{t('keys')}</span></th></tr></thead><tbody>
      {keys.map(k=>{const exp=Date.parse(k.expiresAt)<=Date.now();const dead=!!k.revokedAt||exp;return <tr key={k.id} data-testid={'row-key-'+k.id}>
       <td>{k.name}</td><td className="sc-mono">{k.prefix}…</td><td className="sc-mono sb-wrap">{k.scopes.join(', ')}</td><td>{k.requestsPerMinute}</td>
       <td>{k.revokedAt?<span className="p-badge sc-pill red">{t('revoked')}</span>:exp?<span className="p-badge sc-pill grey">{t('expired')}</span>:fmtDate(k.expiresAt,l)}</td>
       <td>{k.lastUsedAt?fmtDate(k.lastUsedAt,l):t('never')}</td>
       <td>{perms.keys&&!dead&&<div className="cx-row sb-actions">{on&&<button className="p-button small" disabled={!!busy} onClick={()=>{setMsg(undefined);setAct({kind:'rotate',client:c,key:k})}} data-testid={'button-rotate-key-'+k.id}>{t('rotate')}</button>}<button className="p-button small" disabled={!!busy} onClick={()=>{setMsg(undefined);setAct({kind:'revoke',client:c,key:k})}} data-testid={'button-revoke-key-'+k.id}>{t('revoke')}</button></div>}</td></tr>})}
      {!keys.length&&<tr><td colSpan={7} className="sc-empty">{t('noKeys')}</td></tr>}
     </tbody></table></div>
    </article>})}</div>}
    <div className="cx-row" aria-live="polite"><button className="p-button" disabled={loading||page<=1} onClick={()=>setPage(p=>p-1)} data-testid="button-prev-api">{t('prev')}</button><span data-testid="text-page-api">{t('page')} {page}</span><button className="p-button" disabled={loading||!hasMore} onClick={()=>setPage(p=>p+1)} data-testid="button-next-api">{t('next')}</button></div>
   </section>
  </>}
 </div>;
}

function SecretPanel({s,t,onHide}:{s:Secret;t:(k:string)=>string;onHide:()=>void}){
 const [copied,setCopied]=useState(false);
 return <section className="p-card sc-card sa-danger ac-secret" role="alert" data-testid="section-api-secret">
  <h3 className="sb-h">{t('secretTitle')} · {s.name}</h3>
  {s.rotated&&<p className="sc-note">{t('rotateWarn')}</p>}
  <div className="bi-cmd"><code className="sc-mono sb-wrap" data-testid="text-api-secret">{s.value}</code><button type="button" className="p-button small" onClick={()=>{navigator.clipboard.writeText(s.value).then(()=>setCopied(true),()=>setCopied(false))}} data-testid="button-copy-secret">{copied?t('copied'):t('copy')}</button></div>
  <p className="sc-note">{t('secretNote')}</p>
  <div className="cx-row"><button type="button" className="p-button orange" onClick={onHide} data-testid="button-hide-secret">{t('done')}</button></div>
 </section>;
}

type ClientBody={name:string;description:string;organizationId:string|null;clientType:CreateApiClientBodyClientType;allowedScopes:string[];allowedIps:string[]};
function ClientForm({scopes,t,busy,onCancel,onSubmit}:{scopes:string[];t:(k:string)=>string;busy:boolean;onCancel:()=>void;onSubmit:(b:ClientBody)=>Promise<boolean>}){
 const [name,setName]=useState('');const [desc,setDesc]=useState('');const [org,setOrg]=useState('');const [type,setType]=useState<CreateApiClientBodyClientType>('organization');
 const [sel,setSel]=useState<string[]>([]);const [ips,setIps]=useState('');const [typed,setTyped]=useState('');
 const ipList=ips.split(/[\s,]+/).map(x=>x.trim()).filter(Boolean);const badIp=ipList.find(x=>!isIp(x));
 const orgT=org.trim();const orgBad=!!orgT&&!UUID.test(orgT);const needOrg=sel.some(s=>s!==GLOBAL_OK)&&!orgT;
 const problem=!sel.length?t('needScope'):orgBad?t('badOrg'):needOrg?t('needOrg'):badIp?t('badIp').replace('{v}',badIp):'';
 const ok=!!name.trim()&&!problem&&typed==='API CLIENT'&&!busy;
 const submit=(e:FormEvent)=>{e.preventDefault();if(ok)void onSubmit({name:name.trim(),description:desc.trim(),organizationId:orgT||null,clientType:type,allowedScopes:sel,allowedIps:[...new Set(ipList)]})};
 return <form className="p-card sc-card sa-danger ac-form" onSubmit={submit} data-testid="form-create-client"><h3>{t('newClient')}</h3>
  <div className="ac-grid">
   <label>{t('name')}<input value={name} maxLength={120} onChange={e=>setName(e.target.value)} data-testid="input-client-name"/></label>
   <label>{t('type')}<select value={type} onChange={e=>setType(e.target.value as CreateApiClientBodyClientType)} data-testid="select-client-type">{TYPES.map(x=><option key={x} value={x}>{t(x)}</option>)}</select></label>
   <label className="wide">{t('description')}<textarea rows={2} maxLength={500} value={desc} onChange={e=>setDesc(e.target.value)} data-testid="input-client-description"/></label>
   <label className="wide">{t('org')}<input className="sc-mono" value={org} onChange={e=>setOrg(e.target.value)} spellCheck={false} placeholder="00000000-0000-0000-0000-000000000000" data-testid="input-client-org"/><small className="sc-note">{t('orgHint')}</small></label>
  </div>
  <fieldset className="ac-scopes"><legend>{t('scopes')}</legend>{scopes.map(s=><label key={s}><input type="checkbox" checked={sel.includes(s)} onChange={e=>setSel(v=>e.target.checked?[...v,s]:v.filter(x=>x!==s))} data-testid={'check-client-scope-'+s}/> <code className="sc-mono">{s}</code></label>)}</fieldset>
  <label>{t('ips')}<textarea className="sc-mono" rows={2} value={ips} onChange={e=>setIps(e.target.value)} spellCheck={false} data-testid="input-client-ips"/><small className="sc-note">{t('ipsHint')}</small></label>
  {problem&&<p className="p-error" data-testid="text-client-problem">{problem}</p>}
  <label>{t('typeConfirm')} <code className="sc-mono">API CLIENT</code><input value={typed} onChange={e=>setTyped(e.target.value)} autoComplete="off" spellCheck={false} maxLength={20} data-testid="input-confirm-client"/></label>
  <div className="cx-row"><button className="p-button orange" disabled={!ok} data-testid="button-create-client">{busy?t('loading'):t('create')}</button><button type="button" className="p-button" onClick={onCancel} data-testid="button-cancel-client">{t('cancel')}</button></div>
 </form>;
}

type KeyBody={name:string;scopes:string[];expiresAt:string;requestsPerMinute:number};
function ActionForm({a,t,l,busy,onCancel,onSubmit}:{a:{kind:'status'|'rotate'|'revoke'|'newKey';client:ManagedApiClient;key?:ManagedApiKey};t:(k:string)=>string;l:Language;busy:boolean;onCancel:()=>void;onSubmit:(b?:KeyBody)=>void}){
 const phrase=a.kind==='status'?'API CLIENT':'API KEY';
 const [typed,setTyped]=useState('');const [name,setName]=useState('');const [sel,setSel]=useState<string[]>([]);
 const [exp,setExp]=useState(()=>localInput(new Date(Date.now()+90*864e5)));const [rpm,setRpm]=useState('60');
 const isKey=a.kind==='newKey';const expMs=Date.parse(exp);const expBad=!Number.isFinite(expMs)||expMs<=Date.now()||expMs>Date.now()+366*864e5;
 const rpmN=Number(rpm);const rpmBad=!Number.isInteger(rpmN)||rpmN<1||rpmN>300;
 const ok=typed===phrase&&!busy&&(!isKey||(!!name.trim()&&sel.length>0&&!expBad&&!rpmBad));
 const title=a.kind==='status'?t(a.client.status==='active'?'disable':'enable')+' · '+a.client.name:a.kind==='newKey'?t('newKey')+' · '+a.client.name:t(a.kind)+' · '+(a.key?.name??'');
 return <form className="p-card sc-card sa-danger ac-form" onSubmit={e=>{e.preventDefault();if(ok)onSubmit(isKey?{name:name.trim(),scopes:sel,expiresAt:new Date(expMs).toISOString(),requestsPerMinute:rpmN}:undefined)}} data-testid={'form-api-'+a.kind}>
  <h3>{title}</h3>
  {a.kind==='status'&&a.client.status==='active'&&<p className="p-error">{t('statusWarn')}</p>}
  {a.kind==='rotate'&&<p className="p-error">{t('rotateWarn')}</p>}
  {a.kind==='revoke'&&<p className="p-error">{t('revokeWarn')}</p>}
  {a.key&&<p className="sc-mono">{a.key.prefix}… · {fmtDate(a.key.expiresAt,l)}</p>}
  {isKey&&<>
   <div className="ac-grid">
    <label>{t('name')}<input value={name} maxLength={120} onChange={e=>setName(e.target.value)} data-testid="input-key-name"/></label>
    <label>{t('rpm')}<input type="number" min={1} max={300} step={1} value={rpm} onChange={e=>setRpm(e.target.value)} data-testid="input-key-rpm"/>{rpmBad&&<small className="p-error">{t('badRpm')}</small>}</label>
    <label className="wide">{t('expires')}<input type="datetime-local" value={exp} min={localInput(new Date())} max={localInput(new Date(Date.now()+366*864e5))} onChange={e=>setExp(e.target.value)} data-testid="input-key-expires"/>{expBad&&<small className="p-error">{t('badExp')}</small>}</label>
   </div>
   <fieldset className="ac-scopes"><legend>{t('scopes')}</legend>{a.client.allowedScopes.map(s=><label key={s}><input type="checkbox" checked={sel.includes(s)} onChange={e=>setSel(v=>e.target.checked?[...v,s]:v.filter(x=>x!==s))} data-testid={'check-key-scope-'+s}/> <code className="sc-mono">{s}</code></label>)}</fieldset>
   {!sel.length&&<p className="sc-note">{t('needScope')}</p>}
  </>}
  <label>{t('typeConfirm')} <code className="sc-mono">{phrase}</code><input value={typed} onChange={e=>setTyped(e.target.value)} autoComplete="off" spellCheck={false} maxLength={20} data-testid="input-confirm-api"/></label>
  <div className="cx-row"><button className="p-button orange" disabled={!ok} data-testid="button-confirm-api">{busy?t('loading'):isKey?t('create'):a.kind==='status'?t(a.client.status==='active'?'disable':'enable'):t(a.kind)}</button><button type="button" className="p-button" onClick={onCancel} data-testid="button-cancel-api">{t('cancel')}</button></div>
 </form>;
}
export const apiLabel=(l:Language)=>S.title[L(l)];
