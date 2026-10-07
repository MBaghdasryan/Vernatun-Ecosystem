import {useEffect,useState,type ComponentType,type ReactNode} from 'react';
import {request,ApiClientError} from './client';
import {roleName,index,type Language} from './i18n';
import EmployeeAssignment from './EmployeeAssignment';
import './iam.css';

type Props={language:Language;platform:boolean;view:string;brand:ReactNode;onSwitch:()=>void;onLogout:()=>void;
 Modal:ComponentType<{title:string;onClose:()=>void;children:ReactNode}>;ErrorNotice:ComponentType<{error:unknown}>};
export default function IAMWorkspace({language,platform,view,brand,onSwitch,onLogout,Modal,ErrorNotice}:Props){
 const L=index(language),tr=(hy:string,ru:string,en:string)=>[hy,ru,en][L],base=platform?'/console':'/os';
 const [catalog,setCatalog]=useState<any>(),[profiles,setProfiles]=useState<any[]>([]),[rows,setRows]=useState<any[]>([]),[total,setTotal]=useState(0);
 const [q,setQ]=useState(''),[search,setSearch]=useState(''),[offset,setOffset]=useState(0),[revision,setRevision]=useState(0);
 const [loading,setLoading]=useState(true),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false);
 const [card,setCard]=useState<any>(),[userId,setUserId]=useState<string>(),[scopeId,setScopeId]=useState<string>();
 const [draft,setDraft]=useState<any>(),[matrixRole,setMatrixRole]=useState('manager'),[policy,setPolicy]=useState<any>();
 const [access,setAccess]=useState<any>(),[accessId,setAccessId]=useState<string>(),[method,setMethod]=useState('GET');
 const [action,setAction]=useState<{kind:string;id:string;status?:string;sessionId?:string;version?:string}>(),[reason,setReason]=useState('');
 const refresh=()=>setRevision(v=>v+1);
 useEffect(()=>{let live=true;setLoading(true);setError(undefined);
  Promise.all([request<any>('/iam/catalog'),request<any[]>('/iam/profiles'),request<any>('/iam/users?q='+encodeURIComponent(search)+'&offset='+offset)])
   .then(([c,p,u])=>{if(live){setCatalog(c);setProfiles(p);setRows(u.rows);setTotal(u.total)}})
   .catch(e=>{if(live)setError(e)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false};
 },[revision,search,offset]);
 useEffect(()=>{if(!userId)return;let live=true;setCard(undefined);
  request('/iam/users/'+userId).then(d=>{if(live)setCard(d)}).catch(setError);return()=>{live=false};
 },[userId,revision]);
 useEffect(()=>{if(!accessId)return;let live=true;setAccess(undefined);
  request('/iam/assignments/'+accessId+'/access','POST',{method}).then(d=>{if(live)setAccess(d)}).catch(setError);
  return()=>{live=false};
 },[accessId,method,revision]);
 async function run(fn:()=>Promise<unknown>,done:()=>void){
  if(busy)return;setBusy(true);setError(undefined);
  try{await fn();done();refresh()}catch(e){setError(e)}finally{setBusy(false)}
 }
 const button=(text:string,onClick:()=>void,disabled=false)=><button type="button" className="p-button small" disabled={busy||disabled} onClick={onClick}>{text}</button>;
 const save=tr('Պահպանել','Сохранить','Save'),cancel=tr('Չեղարկել','Отмена','Cancel'),reload=tr('Թարմացնել','Обновить','Reload');
 const users=tr('Օգտատերեր','Пользователи','Users'),roles=tr('Դերեր','Роли','Roles'),permissions=tr('Թույլտվություններ','Разрешения','Permissions');
 const statusLabel=(v:string)=>({active:tr('Ակտիվ','Активен','Active'),locked:tr('Արգելափակված','Заблокирован','Locked'),disabled:tr('Անջատված','Отключён','Disabled'),suspended:tr('Կասեցված','Приостановлен','Suspended'),revoked:tr('Հետ կանչված','Отозван','Revoked')}[v]??v);
 const errorBox=error?<div><ErrorNotice error={error}/>{error instanceof ApiClientError&&error.code==='concurrent_change'&&<p>{tr('Տվյալները փոխվել են։ Բացեք քարտը նորից։','Данные изменились. Откройте карточку заново, прежде чем сохранять.','Data changed. Reopen the card before saving.')}</p>}{button(reload,refresh)}</div>:null;
 return <div className="iam-workspace">
  <header className="iam-header">{brand}<nav aria-label="IAM"><a href={base+'/'+(platform?'overview':'organization')}>{tr('Վերադառնալ','К обзору','Overview')}</a><a href={base+'/'+(platform?'users':'people')}>{users}</a><a href={base+'/roles'}>{roles}</a><a href={base+'/'+(platform?'permissions':'roles')+'?matrix=1'}>{permissions}</a><a href={base+'/invitations'}>{tr('Հրավերներ','Приглашения','Invitations')}</a></nav>{button(tr('Փոխել համատեքստը','Сменить контекст','Switch context'),onSwitch)}{button(tr('Ելք','Выйти','Sign out'),onLogout)}</header>
  <main className="iam-main"><h1>{view==='roles'?roles:view==='permissions'?permissions:users}</h1><p>{platform?tr('Հարթակի հասանելիություն․ առանց կազմակերպության բիզնես տվյալների','Доступ платформы — без доступа к бизнес-данным организаций','Platform access — no tenant business-data access'):tr('Կազմակերպության աշխատակիցներ և հասանելիություն','Сотрудники и доступ организации','Organization employees and access')}</p>
   {errorBox}{loading?<p role="status">{tr('Բեռնվում է…','Загрузка…','Loading…')}</p>:catalog&&<>
   {(view==='users'||view==='people')&&<section className="p-card">
    <form className="iam-row" onSubmit={e=>{e.preventDefault();setOffset(0);setSearch(q)}}><label>{tr('Որոնում','Поиск','Search')}<input value={q} onChange={e=>setQ(e.target.value)} maxLength={100}/></label><button className="p-button">{tr('Գտնել','Найти','Search')}</button></form>
    <div className="iam-table"><table><thead><tr><th>{tr('Անուն','Имя','Name')}</th><th>Email</th><th>{tr('Հաշվի վիճակ','Статус аккаунта','Account status')}</th><th>MFA</th></tr></thead><tbody>{rows.map(u=><tr key={u.id}><td>{button(u.name,()=>setUserId(u.id))}</td><td>{u.email}</td><td>{statusLabel(u.account_status)}</td><td>{u.mfa_enabled?tr('Միացված','Включена','Enabled'):tr('Անջատված','Выключена','Disabled')}</td></tr>)}</tbody></table></div>
    {!rows.length&&<p>{tr('Գրառումներ չկան','Записей нет','No records')}</p>}<div className="iam-row">{button('←',()=>setOffset(Math.max(0,offset-50)),offset===0)}<span>{offset+1}–{offset+rows.length} / {total}</span>{button('→',()=>setOffset(offset+50),offset+rows.length>=total)}</div>
   </section>}
   {(view==='roles'||view==='permissions')&&<>
    <section className="p-card"><h2>{tr('Համակարգային դերեր · անփոփոխ','Системные роли · неизменяемые','System roles · immutable')}</h2><label>{roles}<select value={matrixRole} onChange={e=>setMatrixRole(e.target.value)}>{Object.keys(catalog.roles).map(r=><option key={r} value={r}>{roleName(language,r)}</option>)}</select></label><div className="iam-permissions">{catalog.permissions.map((p:string)=><div key={p}><input type="checkbox" aria-label={p} checked={catalog.roles[matrixRole].permissions.includes(p)} readOnly disabled/> <code>{p}</code></div>)}</div></section>
    {view==='roles'&&<section className="p-card"><h2>{tr('Հասանելիության պրոֆիլներ','Профили доступа','Access profiles')}</h2>{button(tr('Նոր պրոֆիլ','Новый профиль','New profile'),()=>setDraft({name:'',description:'',baseRole:'manager',permissions:[...catalog.roles.manager.permissions],tenantAllowed:false,active:true}))}
     {profiles.map(p=><div className="iam-record" key={p.id}><strong>{p.name}</strong><span>{roleName(language,p.base_role)} · {p.permissions.length} · {statusLabel(p.active?'active':'disabled')}</span>{(platform?!p.organization_id:!!p.organization_id)&&button(tr('Խմբագրել','Редактировать','Edit'),()=>setDraft({id:p.id,name:p.name,description:p.description,baseRole:p.base_role,permissions:p.permissions,active:p.active,tenantAllowed:p.tenant_allowed,version:p.version}))}</div>)}
     {!profiles.length&&<p>{tr('Պրոֆիլներ չկան','Профилей пока нет','No profiles yet')}</p>}
    </section>}
   </>}
   </>}
  </main>
  {userId&&<Modal title={users} onClose={()=>setUserId(undefined)}>{errorBox}{!card?<p role="status">{tr('Բեռնվում է…','Загрузка…','Loading…')}</p>:<>
   <h2>{card.user.name}</h2><p>{card.user.email} · {statusLabel(card.user.account_status)} · MFA: {card.user.mfa_enabled?'✓':'—'}</p>
   {platform&&<div className="iam-row">{['active','locked','disabled'].map(status=>button(statusLabel(status),()=>{setReason('');setAction({kind:'account',id:card.user.id,status})},status===card.user.account_status))}{button(tr('Ավարտել բոլոր սեանսները','Завершить все сессии','Force logout'),()=>{setReason('');setAction({kind:'logout',id:card.user.id})})}</div>}
   <h3>{tr('Նշանակումներ','Назначения','Assignments')}</h3>{card.assignments.map((a:any)=><section className="iam-record" key={a.id}><strong>{roleName(language,a.role_key)} · {a.organization_name??'Vernatun Console'}</strong><span>{statusLabel(a.assignment_status)} · {a.building_id??tr('Ամբողջ կազմակերպությունը','Вся организация','Organization-wide')} · {a.expires_at?new Date(a.expires_at).toLocaleString():tr('Անժամկետ','Бессрочно','No expiration')}</span><div className="iam-row">
    {!platform&&button(tr('Դեր և սահմաններ','Роль и границы','Role and scope'),()=>setScopeId(a.id))}
    {button(tr('Փաստացի հասանելիություն','Эффективный доступ','Effective access'),()=>setAccessId(a.id))}
    {!['org_admin','platform_admin','support','unit_owner','renter','family'].includes(a.role_key)&&<>
     {button(tr('Սահմանափակումներ','Ограничения','Restrictions'),async()=>{try{const d=await request<any>('/iam/assignments/'+a.id+'/access');setPolicy({id:a.id,version:a.version,baseRole:a.role_key,profileId:a.profile_id??'',denies:d.rules.filter((r:any)=>r.effect==='deny').map((r:any)=>r.permission_key),grants:d.rules.filter((r:any)=>r.effect==='grant').map((r:any)=>r.permission_key),reason:'',expiresAt:''})}catch(e){setError(e)}})}
     {a.assignment_status!=='revoked'&&['active','suspended','revoked'].filter(s=>s!==a.assignment_status).map(status=>button(statusLabel(status),()=>{setReason('');setAction({kind:'assignment',id:a.id,status,version:a.version})}))}
    </>}
   </div></section>)}
   {platform&&<><h3>{tr('Սեանսներ','Сессии','Sessions')}</h3>{card.sessions.length?card.sessions.map((s:any)=><div className="iam-record" key={s.id}><span>{s.created_at??'—'} → {new Date(s.expire).toLocaleString()}</span>{button(tr('Ավարտել','Завершить','Revoke'),()=>{setReason('');setAction({kind:'logout',id:card.user.id,sessionId:s.id})})}</div>):<p>{tr('Ակտիվ սեանսներ չկան','Активных сессий нет','No active sessions')}</p>}</>}
   <h3>{tr('Վերջին փոփոխություններ','Последние изменения','Recent changes')}</h3>{card.history.map((h:any,i:number)=><details key={i}><summary>{new Date(h.created_at).toLocaleString()} · {h.action}</summary><pre>{JSON.stringify(h.details,null,2)}</pre></details>)}
  </>}</Modal>}
  {scopeId&&<EmployeeAssignment id={scopeId} language={language} onClose={()=>setScopeId(undefined)} onSaved={refresh} Modal={Modal} ErrorNotice={ErrorNotice}/>}
  {draft&&<Modal title={roles} onClose={()=>setDraft(undefined)}>{errorBox}<form onSubmit={e=>{e.preventDefault();const {id,...body}=draft;void run(()=>request('/iam/profiles'+(id?'/'+id:''),id?'PATCH':'POST',body),()=>setDraft(undefined))}}>
   <label>{tr('Անվանում','Название','Name')}<input required minLength={2} maxLength={100} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
   <label>{tr('Նկարագրություն','Описание','Description')}<textarea maxLength={1000} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
   <label>{tr('Բազային դեր','Базовая роль','Base role')}<select disabled={!!draft.id} value={draft.baseRole} onChange={e=>setDraft({...draft,baseRole:e.target.value,permissions:[...catalog.roles[e.target.value].permissions]})}>{Object.keys(catalog.roles).filter(r=>!['platform_admin','support'].includes(r)).map(r=><option key={r} value={r}>{roleName(language,r)}</option>)}</select></label>
   <label><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/>{statusLabel('active')}</label>
   {platform&&<label><input type="checkbox" checked={draft.tenantAllowed} onChange={e=>setDraft({...draft,tenantAllowed:e.target.checked})}/>{tr('Հասանելի է կազմակերպություններին','Доступен организациям','Available to organizations')}</label>}
   <div className="iam-permissions">{catalog.roles[draft.baseRole].permissions.map((p:string)=><label key={p}><input type="checkbox" checked={draft.permissions.includes(p)} onChange={e=>setDraft({...draft,permissions:e.target.checked?[...draft.permissions,p]:draft.permissions.filter((x:string)=>x!==p)})}/><code>{p}</code></label>)}</div><button className="p-button orange" disabled={busy}>{save}</button>
  </form></Modal>}
  {policy&&<Modal title={tr('Սահմանափակումներ','Ограничения назначения','Assignment restrictions')} onClose={()=>setPolicy(undefined)}>{errorBox}<form onSubmit={e=>{e.preventDefault();const {id,baseRole,...b}=policy;void run(()=>request('/iam/assignments/'+id+'/policy','POST',{...b,grants:platform?b.grants:[],profileId:b.profileId||null,expiresAt:b.expiresAt?new Date(b.expiresAt).toISOString():null}),()=>setPolicy(undefined))}}>
   <label>{tr('Պրոֆիլ','Профиль','Profile')}<select value={policy.profileId} onChange={e=>setPolicy({...policy,profileId:e.target.value})}><option value="">{tr('Համակարգային դեր','Системная роль','System role')}</option>{profiles.filter(p=>p.active&&p.base_role===policy.baseRole).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   <h3>{tr('Արգելքներ՝ առաջնահերթ','Запреты — имеют приоритет','Denies take precedence')}</h3><div className="iam-permissions">{catalog.roles[policy.baseRole].permissions.map((p:string)=><label key={p}><input type="checkbox" checked={policy.denies.includes(p)} onChange={e=>setPolicy({...policy,denies:e.target.checked?[...policy.denies,p]:policy.denies.filter((x:string)=>x!==p)})}/><code>{p}</code></label>)}</div>
   {platform&&<><h3>{tr('Ժամանակավոր բացառություններ','Временные исключения','Temporary exceptions')}</h3><p>{tr('Միայն բազային դերի թույլատրված ընթերցման իրավունքներ','Только разрешённые права чтения базовой роли','Only allowlisted read permissions from the base role')}</p>{catalog.exceptionalGrantAllowlist.filter((p:string)=>catalog.roles[policy.baseRole].permissions.includes(p)).map((p:string)=><label key={p}><input type="checkbox" checked={policy.grants.includes(p)} onChange={e=>setPolicy({...policy,grants:e.target.checked?[...policy.grants,p]:policy.grants.filter((x:string)=>x!==p)})}/>{p}</label>)}</>}
   <label>{tr('Մինչև','До','Expires')}<input type="datetime-local" required={platform&&policy.grants.length>0} value={policy.expiresAt} onChange={e=>setPolicy({...policy,expiresAt:e.target.value})}/></label>
   <label>{tr('Պատճառ','Причина','Reason')}<textarea required minLength={5} maxLength={1000} value={policy.reason} onChange={e=>setPolicy({...policy,reason:e.target.value})}/></label><button className="p-button orange" disabled={busy}>{save}</button>
  </form></Modal>}
  {accessId&&<Modal title={tr('Հասանելիության բացատրություն','Объяснение доступа','Access explanation')} onClose={()=>setAccessId(undefined)}>{errorBox}<label>{tr('Գործողություն','Метод запроса','Request method')}<select value={method} onChange={e=>setMethod(e.target.value)}>{['GET','POST','PATCH','DELETE'].map(m=><option key={m}>{m}</option>)}</select></label><p>{tr('Սա թույլտվությունների, մոդուլների և բաժանորդագրության ստուգում է։ Օբյեկտի իրավունքը, գործարքի վիճակը և ընթացիկ սեանսի MFA-ը ստուգվում են առանձին։','Проверка прав, модулей и подписки. Доступ к конкретному объекту, состояние операции и MFA текущей сессии проверяются дополнительно в API.','Checks permissions, modules and subscription. Resource ownership, workflow state and current-session MFA are separately enforced by the endpoint.')}</p>{access?<><pre>{JSON.stringify(access.scope,null,2)}</pre><div className="iam-table"><table><tbody>{access.evaluations.map((p:any)=><tr key={p.permission}><td><code>{p.permission}</code></td><td>{p.allowed?'✓':'—'} {p.reason}</td></tr>)}</tbody></table></div></>:<p role="status">{tr('Բեռնվում է…','Загрузка…','Loading…')}</p>}</Modal>}
  {action&&<Modal title={tr('Հաստատել փոփոխությունը','Подтвердить изменение','Confirm change')} onClose={()=>setAction(undefined)}>{errorBox}<form onSubmit={e=>{e.preventDefault();void run(()=>action.kind==='assignment'?request('/iam/assignments/'+action.id+'/status','POST',{version:action.version,status:action.status,reason}):request('/iam/users/'+action.id+(action.kind==='account'?'/status':'/logout'),'POST',{reason,...(action.status?{status:action.status}:{}),...(action.sessionId?{sessionId:action.sessionId}:{})}),()=>setAction(undefined))}}><p>{action.status?statusLabel(action.status):tr('Սեանսները կավարտվեն','Сессии будут завершены','Sessions will be ended')}</p><label>{tr('Պատճառ','Причина','Reason')}<textarea required minLength={5} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="iam-row">{button(cancel,()=>setAction(undefined))}<button className="p-button orange" disabled={busy}>{save}</button></div></form></Modal>}
 </div>;
}
