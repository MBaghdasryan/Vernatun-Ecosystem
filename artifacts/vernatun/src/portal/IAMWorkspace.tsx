import {useEffect,useState,type ComponentType,type FormEvent,type ReactNode} from 'react';
import {request,downloadFile,ApiClientError} from './client';
import {roleName,index,type Language} from './i18n';
import type {RoleContext} from './types';
import EmployeeAssignment from './EmployeeAssignment';
import OwnerAccessQueue from './OwnerAccessQueue';
import PlatformUsersConsole from './PlatformUsersConsole';
import './iam.css';

type Props={language:Language;platform:boolean;view:string;brand:ReactNode;headerTools?:ReactNode;context:RoleContext;onSwitch:()=>void;onLogout:()=>void;
 Modal:ComponentType<{title:string;onClose:()=>void;children:ReactNode}>;ErrorNotice:ComponentType<{error:unknown}>};
export default function IAMWorkspace({language,platform,view,brand,headerTools,context,onSwitch,onLogout,Modal,ErrorNotice}:Props){
 const L=index(language),tr=(hy:string,ru:string,en:string)=>[hy,ru,en][L],base=platform?'/console':'/os';
 const canExportUsers=platform&&context.role_key==='platform_admin'&&!context.organization_id;
  const canInviteUsers=platform&&view==='users'&&context.permissions.includes('platform.invite');
 const [catalog,setCatalog]=useState<any>(),[profiles,setProfiles]=useState<any[]>([]),[rows,setRows]=useState<any[]>([]),[total,setTotal]=useState(0);
 const [q,setQ]=useState(''),[search,setSearch]=useState(''),[offset,setOffset]=useState(0),[revision,setRevision]=useState(0);
 const [createdFromInput,setCreatedFromInput]=useState(''),[createdToInput,setCreatedToInput]=useState('');
 const [createdFrom,setCreatedFrom]=useState(''),[createdTo,setCreatedTo]=useState('');
 const [exporting,setExporting]=useState(false),[exportError,setExportError]=useState<unknown>();
 const [loading,setLoading]=useState(true),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false);
 const [card,setCard]=useState<any>(),[userId,setUserId]=useState<string>(),[scopeId,setScopeId]=useState<string>();
  const [draft,setDraft]=useState<any>(),[matrixRole,setMatrixRole]=useState('manager'),[roleDraft,setRoleDraft]=useState<any>(),[policy,setPolicy]=useState<any>();
 const [access,setAccess]=useState<any>(),[accessId,setAccessId]=useState<string>(),[method,setMethod]=useState('GET');
 const [unitDraft,setUnitDraft]=useState(''),[unitId,setUnitId]=useState(''),[sessionId,setSessionId]=useState('');
 const [action,setAction]=useState<{kind:string;id:string;status?:string;sessionId?:string;version?:string}>(),[reason,setReason]=useState('');
 const refresh=()=>setRevision(v=>v+1);
  useEffect(()=>{if(canInviteUsers){setLoading(false);return}
   let live=true;setLoading(true);setError(undefined);
   const params=new URLSearchParams({q:search,offset:String(offset)});
   if(createdFrom)params.set('createdFrom',createdFrom);if(createdTo)params.set('createdTo',createdTo);
   Promise.all([request<any>('/iam/catalog'),request<any[]>('/iam/profiles'),request<any>('/iam/users?'+params)])
   .then(([c,p,u])=>{if(live){setCatalog(c);setProfiles(p);setRows(u.rows);setTotal(u.total)}})
   .catch(e=>{if(live)setError(e)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false};
   },[canInviteUsers,platform,view,revision,search,createdFrom,createdTo,offset]);
 useEffect(()=>{if(!userId)return;let live=true;setCard(undefined);
  request('/iam/users/'+userId).then(d=>{if(live)setCard(d)}).catch(setError);return()=>{live=false};
 },[userId,revision]);
 useEffect(()=>{if(!accessId)return;let live=true;setAccess(undefined);
  request('/iam/assignments/'+accessId+'/access','POST',{method,...(unitId?{unitId}:{}),...(sessionId?{sessionId}:{})}).then(d=>{if(live)setAccess(d)}).catch(setError);
  return()=>{live=false};
 },[accessId,method,revision,unitId,sessionId]);
 async function run(fn:()=>Promise<unknown>,done:()=>void){
  if(busy)return;setBusy(true);setError(undefined);
  try{await fn();done();refresh()}catch(e){setError(e)}finally{setBusy(false)}
 }
 const button=(text:string,onClick:()=>void,disabled=false)=><button key={text} type="button" className="p-button small" disabled={busy||disabled} onClick={onClick}>{text}</button>;
 const save=tr('Պահպանել','Сохранить','Save'),cancel=tr('Չեղարկել','Отмена','Cancel'),reload=tr('Թարմացնել','Обновить','Reload');
  const dateRangeInvalid=!!createdFromInput&&!!createdToInput&&createdFromInput>createdToInput;
  function applyUserFilters(event:FormEvent){
   event.preventDefault();if(dateRangeInvalid)return;
   setOffset(0);setSearch(q.trim());setCreatedFrom(createdFromInput);setCreatedTo(createdToInput);setExportError(undefined);
  }
  function resetUserFilters(){
   setQ('');setSearch('');setCreatedFromInput('');setCreatedToInput('');setCreatedFrom('');setCreatedTo('');
   setOffset(0);setExportError(undefined);
  }
  async function exportUsers(){
   if(exporting||!total)return;
   setExporting(true);setExportError(undefined);
   const params=new URLSearchParams({q:search});
   if(createdFrom)params.set('createdFrom',createdFrom);if(createdTo)params.set('createdTo',createdTo);
   try{
    const blob=await downloadFile(`/iam/users/export.csv?${params}`),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='vernatun-users.csv';link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
   }catch(error){setExportError(error)}finally{setExporting(false)}
  }
  const createdDate=(value:string)=>new Date(value).toLocaleDateString(language==='hy'?'hy-AM':language==='ru'?'ru-RU':'en-US',{timeZone:'Asia/Yerevan'});
 const users=tr('Օգտատերեր','Пользователи','Users'),roles=tr('Դերեր','Роли','Roles'),permissions=tr('Թույլտվություններ','Разрешения','Permissions');
 const statusLabel=(v:string)=>({active:tr('Ակտիվ','Активен','Active'),locked:tr('Արգելափակված','Заблокирован','Locked'),disabled:tr('Անջատված','Отключён','Disabled'),suspended:tr('Կասեցված','Приостановлен','Suspended'),revoked:tr('Հետ կանչված','Отозван','Revoked')}[v]??v);
 const errorBox=error?<div><ErrorNotice error={error}/>{error instanceof ApiClientError&&error.code==='concurrent_change'&&<p>{tr('Տվյալները փոխվել են։ Բացեք քարտը նորից։','Данные изменились. Откройте карточку заново, прежде чем сохранять.','Data changed. Reopen the card before saving.')}</p>}{button(reload,refresh)}</div>:null;
  return <div className="iam-workspace">
  <header className="iam-header">{brand}<nav aria-label="IAM"><a href={base+'/'+(platform?'overview':'organization')}>{tr('Վերադառնալ','К обзору','Overview')}</a><a href={base+'/'+(platform?'users':'people')}>{users}</a><a href={base+'/roles'}>{roles}</a><a href={base+'/'+(platform?'permissions':'roles')+'?matrix=1'}>{permissions}</a><a href={base+'/invitations'}>{tr('Հրավերներ','Приглашения','Invitations')}</a></nav>{headerTools}{button(tr('Փոխել համատեքստը','Сменить контекст','Switch context'),onSwitch)}{button(tr('Ելք','Выйти','Sign out'),onLogout)}</header>
  <main className="iam-main"><h1>{view==='roles'?roles:view==='permissions'?permissions:users}</h1><p>{platform?tr('Հարթակի հասանելիություն․ առանց կազմակերպության բիզնես տվյալների','Доступ платформы — без доступа к бизнес-данным организаций','Platform access — no tenant business-data access'):tr('Կազմակերպության աշխատակիցներ և հասանելիություն','Сотрудники и доступ организации','Organization employees and access')}</p>
    {errorBox}{canInviteUsers
     ?<PlatformUsersConsole c={context} language={language} Modal={Modal} ErrorNotice={ErrorNotice}/>
     :loading?<p role="status">{tr('Բեռնվում է…','Загрузка…','Loading…')}</p>:catalog&&<>
   {(view==='users'||view==='people')&&<section className="p-card">
     {platform?<form className="p-user-search" onSubmit={applyUserFilters}>
      <label><span>{tr('Անուն կամ email','Имя или email','Name or email')}</span><input value={q} onChange={e=>setQ(e.target.value)} maxLength={100}/></label>
      <label className="p-user-date"><span>{tr('Ստեղծվել է՝ սկսած','Дата создания с','Created from')}</span><input aria-label={tr('Ստեղծվել է՝ սկսած','Дата создания с','Created from')} type="date" value={createdFromInput} onChange={e=>setCreatedFromInput(e.target.value)}/></label>
      <label className="p-user-date"><span>{tr('Ստեղծվել է՝ մինչև','Дата создания по','Created through')}</span><input aria-label={tr('Ստեղծվել է՝ մինչև','Дата создания по','Created through')} type="date" value={createdToInput} onChange={e=>setCreatedToInput(e.target.value)}/></label>
      <button className="p-button" type="submit">{tr('Փնտրել','Найти','Search')}</button>
      {(search||createdFrom||createdTo||q||createdFromInput||createdToInput)&&<button className="p-button" type="button" onClick={resetUserFilters}>{tr('Մաքրել','Сбросить','Reset')}</button>}
      {canExportUsers&&<button className="p-button" type="button" disabled={!total||exporting} onClick={()=>void exportUsers()}>{exporting?tr('Արտահանվում է…','Экспортируем…','Exporting…'):tr('Արտահանել','Экспортировать','Export users')}</button>}
     </form>:<form className="iam-row" onSubmit={e=>{e.preventDefault();setOffset(0);setSearch(q)}}><label>{tr('Որոնում','Поиск','Search')}<input value={q} onChange={e=>setQ(e.target.value)} maxLength={100}/></label><button className="p-button">{tr('Գտնել','Найти','Search')}</button></form>}
     {platform&&dateRangeInvalid&&<p className="p-user-date-error" role="alert">{tr('Սկզբի օրը պետք է լինի ավարտից շուտ կամ նույն օրը։','Начальная дата должна быть не позже конечной.','Start date must be on or before end date.')}</p>}
     {!!exportError&&<ErrorNotice error={exportError}/>}
     <div className="iam-table"><table><thead><tr><th>{tr('Անուն','Имя','Name')}</th><th>Email</th>{platform&&<th>{tr('Ստեղծվել է','Создан','Created')}</th>}<th>{tr('Հաշվի վիճակ','Статус аккаунта','Account status')}</th><th>MFA</th></tr></thead><tbody>{rows.map(u=><tr key={u.id}><td>{button(u.name,()=>setUserId(u.id))}</td><td>{u.email}</td>{platform&&<td>{createdDate(u.created_at)}</td>}<td>{statusLabel(u.account_status)}</td><td>{u.mfa_enabled?tr('Միացված','Включена','Enabled'):tr('Անջատված','Выключена','Disabled')}</td></tr>)}</tbody></table></div>
     {!rows.length&&<p>{tr('Գրառումներ չկան','Записей нет','No records')}</p>}<div className="iam-row"><button type="button" className="p-button small" aria-label={tr('Նախորդ','Назад','Previous')} disabled={busy||offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>←</button><span>{offset+1}–{offset+rows.length} / {total}</span><button type="button" className="p-button small" aria-label={tr('Հաջորդ','Далее','Next')} disabled={busy||offset+rows.length>=total} onClick={()=>setOffset(offset+50)}>→</button></div>
     {!platform&&view==='people'&&<OwnerAccessQueue language={language} context={context} ErrorNotice={ErrorNotice} Modal={Modal}/>}
    </section>}
   {(view==='roles'||view==='permissions')&&<>
     <section className="p-card"><h2>{tr('Թույլտվություններ ըստ դերի','Разрешения ролей','Role permissions')}</h2><p>{tr('Փոփոխությունները անմիջապես կիրառվում են այս դերով բոլոր օգտատերերի համար։ Պահպանման համար նշեք պատճառը. փոփոխությունը կգրանցվի աուդիտի մատյանում։','Изменения сразу применяются ко всем пользователям с этой ролью. Для сохранения укажите причину; изменение будет записано в журнал аудита.','Changes apply immediately to everyone with this role. Enter a reason to save; the change is recorded in the audit log.')}</p><label>{roles}<select value={matrixRole} onChange={e=>{setMatrixRole(e.target.value);setRoleDraft(undefined)}}>{Object.keys(catalog.roles).map(r=><option key={r} value={r}>{roleName(language,r)}</option>)}</select></label>
     {!roleDraft&&catalog.roles[matrixRole].editable&&platform&&button(tr('Խմբագրել թույլտվությունները','Редактировать права','Edit permissions'),()=>setRoleDraft({version:catalog.roles[matrixRole].version,permissions:[...catalog.roles[matrixRole].permissions],reason:''}))}
     {!catalog.roles[matrixRole].editable&&<p className="p-muted-note">{tr('Այս հատուկ համակարգային դերը պաշտպանված է փոփոխություններից։','Эта специальная системная роль защищена от изменений.','This special system role is protected from changes.')}</p>}
     <form onSubmit={e=>{e.preventDefault();if(!roleDraft)return;void run(()=>request('/iam/roles/'+matrixRole,'PATCH',{version:roleDraft.version,permissions:roleDraft.permissions,reason:roleDraft.reason}),()=>setRoleDraft(undefined))}}>
      <div className="iam-permissions">{catalog.permissions.map((p:string)=><label key={p}><input type="checkbox" aria-label={p} checked={(roleDraft?.permissions??catalog.roles[matrixRole].permissions).includes(p)} disabled={!roleDraft||!platform} onChange={e=>roleDraft&&setRoleDraft({...roleDraft,permissions:e.target.checked?[...roleDraft.permissions,p]:roleDraft.permissions.filter((x:string)=>x!==p)})}/> <code>{p}</code></label>)}</div>
      {roleDraft&&<><label>{tr('Փոփոխության պատճառը','Причина изменения','Reason for change')}<textarea required minLength={5} maxLength={1000} value={roleDraft.reason} onChange={e=>setRoleDraft({...roleDraft,reason:e.target.value})}/></label><div className="iam-row">{button(cancel,()=>setRoleDraft(undefined))}<button className="p-button orange" disabled={busy}>{save}</button></div></>}
     </form></section>
      <section className="p-card"><h2>{tr('Հասանելիության պրոֆիլներ','Профили доступа','Access profiles')}</h2><p>{tr('Խմբագրեք թույլտվությունները պրոֆիլի պատուհանում։ Փոփոխությունները վերաբերում են միայն այդ պրոֆիլով օգտվողներին։','В редакторе профиля можно выбрать разрешения. Изменения затронут только пользователей, которым назначен этот профиль.','Edit permissions in the profile editor. Changes affect only users assigned to that profile.')}</p>{button(tr('Նոր պրոֆիլ','Новый профиль','New profile'),()=>setDraft({name:'',description:'',baseRole:'manager',permissions:[...catalog.roles.manager.permissions],tenantAllowed:false,active:true}))}
     {profiles.map(p=><div className="iam-record" key={p.id}><strong>{p.name}</strong><span>{roleName(language,p.base_role)} · {p.permissions.length} · {statusLabel(p.active?'active':'disabled')}</span>{(platform?!p.organization_id:!!p.organization_id)&&button(tr('Խմբագրել','Редактировать','Edit'),()=>setDraft({id:p.id,name:p.name,description:p.description,baseRole:p.base_role,permissions:p.permissions,active:p.active,tenantAllowed:p.tenant_allowed,version:p.version}))}</div>)}
      {!profiles.length&&<p>{tr('Պրոֆիլներ չկան','Профилей пока нет','No profiles yet')}</p>}
     </section>
   </>}
   </>}
  </main>
  {userId&&<Modal title={users} onClose={()=>setUserId(undefined)}>{errorBox}{!card?<p role="status">{tr('Բեռնվում է…','Загрузка…','Loading…')}</p>:<>
   <h2>{card.user.name}</h2><p>{card.user.email} · {statusLabel(card.user.account_status)} · MFA: {card.user.mfa_enabled?'✓':'—'}</p>
   {card.canManageAccount&&<div className="iam-row">{['active','locked','disabled'].map(status=>button(statusLabel(status),()=>{setReason('');setAction({kind:'account',id:card.user.id,status})},status===card.user.account_status))}{button(tr('Ավարտել բոլոր սեանսները','Завершить все сессии','Force logout'),()=>{setReason('');setAction({kind:'logout',id:card.user.id})})}</div>}
   <h3>{tr('Նշանակումներ','Назначения','Assignments')}</h3>{card.assignments.map((a:any)=><section className="iam-record" key={a.id}><strong>{roleName(language,a.role_key)} · {a.organization_name??'Vernatun Console'}</strong><span>{statusLabel(a.assignment_status)} · {a.building_id??tr('Ամբողջ կազմակերպությունը','Вся организация','Organization-wide')} · {a.expires_at?new Date(a.expires_at).toLocaleString():tr('Անժամկետ','Бессрочно','No expiration')}</span><div className="iam-row">
    {a.canEditScope&&button(tr('Դեր և սահմաններ','Роль и границы','Role and scope'),()=>setScopeId(a.id))}
    {button(tr('Փաստացի հասանելիություն','Эффективный доступ','Effective access'),()=>setAccessId(a.id))}
     {a.canChangePolicy&&<>
      {button(tr('Իրավունքներ','Индивидуальные права','Individual permissions'),async()=>{try{const d=await request<any>('/iam/assignments/'+a.id+'/access');const activeExpiry=d.rules.find((r:any)=>r.expires_at)?.expires_at;const expiryLocal=activeExpiry?new Date(new Date(activeExpiry).getTime()-new Date(activeExpiry).getTimezoneOffset()*60000).toISOString().slice(0,16):'';setPolicy({id:a.id,version:a.version,baseRole:a.role_key,profileId:a.profile_id??'',profileName:d.profile?.name??'',selectedPermissions:d.permissions??catalog.roles[a.role_key].permissions,reason:'',expiresAt:expiryLocal})}catch(e){setError(e)}})}
    </>}
    {a.canChangeStatus&&['active','suspended','revoked'].filter(s=>s!==a.assignment_status).map(status=>button(statusLabel(status),()=>{setReason('');setAction({kind:'assignment',id:a.id,status,version:a.version})}))}
   </div></section>)}
   {platform&&<><h3>{tr('Սեանսներ','Сессии','Sessions')}</h3>{card.sessions.length?card.sessions.map((s:any)=><div className="iam-record" key={s.id}><span>{s.created_at??'—'} → {new Date(s.expire).toLocaleString()}</span>{card.canManageAccount&&button(tr('Ավարտել','Завершить','Revoke'),()=>{setReason('');setAction({kind:'logout',id:card.user.id,sessionId:s.id})})}</div>):<p>{tr('Ակտիվ սեանսներ չկան','Активных сессий нет','No active sessions')}</p>}</>}
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
  {policy&&<Modal title={tr('Օգտատիրոջ իրավունքներ','Права пользователя','User permissions')} onClose={()=>setPolicy(undefined)}>{errorBox}<form onSubmit={e=>{e.preventDefault();const {id,baseRole,selectedPermissions,...b}=policy;const allowed:string[]=catalog.roles[baseRole].permissions;const selected=new Set(selectedPermissions as string[]);const profilePermissions:string[]=b.profileId?(profiles.find(p=>p.id===b.profileId)?.permissions??[]):allowed;const grants=allowed.filter(p=>selected.has(p)&&!profilePermissions.includes(p));const denies=allowed.filter(p=>!selected.has(p)&&profilePermissions.includes(p));void run(()=>request('/iam/assignments/'+id+'/policy','POST',{...b,grants,denies,profileId:b.profileId||null,expiresAt:b.expiresAt?new Date(b.expiresAt).toISOString():null}),()=>setPolicy(undefined))}}>
   <label>{tr('Պրոֆիլ','Профиль','Profile')}<select value={policy.profileId} onChange={e=>{const next=profiles.find(p=>p.id===e.target.value);setPolicy({...policy,profileId:e.target.value,profileName:next?.name??'',selectedPermissions:next?[...next.permissions]:[...catalog.roles[policy.baseRole].permissions]})}}><option value="">{tr('Համակարգային դեր','Системная роль','System role')}</option>{policy.profileId&&!profiles.some(p=>p.id===policy.profileId)&&<option value={policy.profileId}>{policy.profileName||tr('Ընթացիկ պրոֆիլ','Текущий профиль','Current profile')}</option>}{profiles.filter(p=>p.active&&p.base_role===policy.baseRole).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   <h3>{tr('Այս օգտատիրոջ թույլտվությունները','Разрешения этого пользователя','Permissions for this user')}</h3><p>{tr('Կարող եք փոխել միայն տվյալ դերի թույլտվությունները։ Մոդուլի, բաժանորդագրության, MFA-ի և տվյալների սահմանները շարունակում են կիրառվել։ Դատարկ ժամկետը նշանակում է մշտական փոփոխություն։','Можно менять только права, предусмотренные назначенной ролью. Ограничения модулей, подписки, MFA и доступа к данным продолжают действовать. Без срока изменения постоянные.','Only permissions in the assigned role can be changed. Module, subscription, MFA and data-scope checks still apply. Leave expiry blank for a permanent change.')}</p><div className="iam-permissions">{catalog.roles[policy.baseRole].permissions.map((p:string)=><label key={p}><input type="checkbox" checked={policy.selectedPermissions.includes(p)} onChange={e=>setPolicy({...policy,selectedPermissions:e.target.checked?[...policy.selectedPermissions,p]:policy.selectedPermissions.filter((x:string)=>x!==p)})}/><code>{p}</code></label>)}</div>
   <label>{tr('Ժամկետ (ըստ ցանկության)','Срок действия (необязательно)','Expiry (optional)')}<input type="datetime-local" value={policy.expiresAt} onChange={e=>setPolicy({...policy,expiresAt:e.target.value})}/></label>
   <label>{tr('Պատճառ','Причина','Reason')}<textarea required minLength={5} maxLength={1000} value={policy.reason} onChange={e=>setPolicy({...policy,reason:e.target.value})}/></label><button className="p-button orange" disabled={busy}>{save}</button>
  </form></Modal>}
  {accessId&&<Modal title={tr('Հասանելիության բացատրություն','Объяснение доступа','Access explanation')} onClose={()=>{setAccessId(undefined);setUnitId('');setUnitDraft('');setSessionId('')}}>
   {errorBox}<label>{tr('Գործողություն','Метод запроса','Request method')}<select value={method} onChange={e=>setMethod(e.target.value)}>{['GET','POST','PATCH','DELETE'].map(m=><option key={m}>{m}</option>)}</select></label>
   <form onSubmit={e=>{e.preventDefault();setUnitId(unitDraft.trim());refresh()}}><label>{tr('Տարածքի ID · GET /units/:id','ID помещения · GET /units/:id','Unit ID · GET /units/:id')}<input value={unitDraft} onChange={e=>setUnitDraft(e.target.value)} placeholder="UUID" pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"/></label>
    {platform&&<label>{tr('Օգտատիրոջ սեանս · MFA','Сессия пользователя · MFA','Target session · MFA')}<select value={sessionId} onChange={e=>setSessionId(e.target.value)}><option value="">{tr('Չի ընտրված','Не выбрана','Not selected')}</option>{card?.sessions.map((s:any)=><option key={s.id} value={s.id}>{new Date(s.expire).toLocaleString()} · {s.id.slice(0,8)}</option>)}</select></label>}
    <button className="p-button">{tr('Ստուգել','Проверить','Check')}</button>
   </form>
   <p>{tr('Մատրիցան ստուգում է իրավունքները, մոդուլները և բաժանորդագրությունը։ Տարածքի ընթերցումը օգտագործում է API-ի նույն ստուգումը։ Այլ գործարքների վիճակը ստուգվում է դրանց endpoint-ում։','Матрица проверяет права, модули и подписку. Чтение помещения использует тот же серверный расчёт, что GET /units/:id. Без подтверждённой сессии обязательная MFA даёт условный результат. Проверки состояния других бизнес-операций выполняются их endpoint.','The matrix checks permissions, modules and subscription. Unit read uses the same evaluator as GET /units/:id. Enforced MFA is conditional without a verified target session. Other workflow state checks remain in their endpoints.')}</p>
   {access?<><pre>{JSON.stringify(access.scope,null,2)}</pre>{access.resource&&<p role="status"><strong>{access.resource.conditional?tr('Պայմանական','Условно','Conditional'):access.resource.allowed?tr('Թույլատրված է','Разрешено','Allowed'):tr('Արգելված է','Запрещено','Denied')}</strong> · {access.resource.reason} · {access.resource.operation}</p>}<div className="iam-table"><table><tbody>{access.evaluations.map((p:any)=><tr key={p.permission}><td><code>{p.permission}</code></td><td>{p.allowed?'✓':'—'} {p.reason}</td></tr>)}</tbody></table></div></>:!error&&<p role="status">{tr('Բեռնվում է…','Загрузка…','Loading…')}</p>}
  </Modal>}
  {action&&<Modal title={tr('Հաստատել փոփոխությունը','Подтвердить изменение','Confirm change')} onClose={()=>setAction(undefined)}>{errorBox}<form onSubmit={e=>{e.preventDefault();void run(()=>action.kind==='assignment'?request('/iam/assignments/'+action.id+'/status','POST',{version:action.version,status:action.status,reason}):request('/iam/users/'+action.id+(action.kind==='account'?'/status':'/logout'),'POST',{reason,...(action.status?{status:action.status}:{}),...(action.sessionId?{sessionId:action.sessionId}:{})}),()=>setAction(undefined))}}><p>{action.status?statusLabel(action.status):tr('Սեանսները կավարտվեն','Сессии будут завершены','Sessions will be ended')}</p><label>{tr('Պատճառ','Причина','Reason')}<textarea required minLength={5} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="iam-row">{button(cancel,()=>setAction(undefined))}<button className="p-button orange" disabled={busy}>{save}</button></div></form></Modal>}
 </div>;
}
