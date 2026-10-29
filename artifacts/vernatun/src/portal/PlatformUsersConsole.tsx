import {useEffect,useMemo,useState,type ComponentType,type FormEvent,type ReactNode} from 'react';
import {ArrowLeft,ArrowRight,Building2,KeyRound,Plus,Search,Users} from 'lucide-react';
import {request} from './client';
import EmployeeAssignment from './EmployeeAssignment';
import {roleName,type Language} from './i18n';
import type {RoleContext} from './types';
import './platform-users.css';

type Row=Record<string,any>;
type ModalComponent=ComponentType<{title:string;onClose:()=>void;children:ReactNode}>;
type ErrorComponent=ComponentType<{error:unknown}>;
type Props={c:RoleContext;language:Language;Modal:ModalComponent;ErrorNotice:ErrorComponent};
type Catalog={roles:Record<string,{permissions:string[]}>};
type Assignment={role_key:string;organization_name:string|null;building_name:string|null;unit_number:string|null;active:boolean};
type UserRow={id:string;name:string;email:string;account_status:string;mfa_enabled:boolean;assignments:Assignment[]};
type Organization={id:string;name:string};
type ScopeOption={id:string;name:string;address?:string;number?:string;building_id?:string};
type UserList={rows:UserRow[];total:number;offset:number;limit:number};

const copy={
 title:['Օգտատերեր','Пользователи','Users'],
 add:['Ավելացնել օգտատեր','Добавить пользователя','Add user'],
 invite:['Ուղարկել հրավեր','Отправить приглашение','Send invitation'],
 accountType:['Հաշվի տեսակ','Тип аккаунта','Account type'],
 companyAccount:['Կազմակերպության աշխատակից','Сотрудник организации','Organization user'],
 internalAccount:['Vernatun-ի աշխատակից','Сотрудник Vernatun','Vernatun employee'],
 email:['Էլեկտրոնային փոստ','Email','Email'],
 organization:['Կազմակերպություն','Компания','Organization'],
 selectOrganization:['Ընտրեք կազմակերպություն','Выберите компанию','Select an organization'],
 role:['Դեր','Роль','Role'],
 building:['Շենք','Здание','Building'],
 unit:['Բնակարան / տարածք','Квартира / помещение','Apartment / unit'],
 wholeOrganization:['Ամբողջ կազմակերպությունը','Вся организация','Entire organization'],
 wholeBuilding:['Ամբողջ շենքը','Всё здание','Entire building'],
 selectBuilding:['Ընտրեք շենքը','Выберите здание','Select a building'],
 selectUnit:['Ընտրեք տարածքը','Выберите квартиру / помещение','Select a unit'],
 accessHint:['Դերը սահմանում է թույլտվությունները, իսկ կազմակերպությունը, շենքը և տարածքը սահմանափակում են տվյալների հասանելիությունը։','Роль задаёт разрешения, а компания, здание и квартира ограничивают доступ к данным.','The role defines permissions; organization, building and unit limit data access.'],
 internalHint:['Ներքին աշխատակիցը ստանում է միայն Support դերը։ platform_admin դերը հրավերով նշանակել հնարավոր չէ։','Внутреннему сотруднику назначается только роль поддержки. Выдать platform_admin через приглашение нельзя.','Internal staff receive only the Support role. platform_admin cannot be assigned through invitations.'],
 rolePermissions:['Թույլտվություններ՝ ըստ դերի','Разрешения выбранной роли','Permissions included in this role'],
 roleCount:['թույլտվություն','разрешений','permissions'],
 accounts:['Հաշիվներ','Аккаунты','Accounts'],
 assignments:['Դեր և հասանելիություն','Роли и доступ','Roles and access'],
 status:['Կարգավիճակ','Статус аккаунта','Account status'],
 mfa:['MFA','MFA','MFA'],
 manageAccess:['Կառավարել հասանելիությունը','Управлять доступом','Manage access'],
 active:['Ակտիվ','Активен','Active'],
 locked:['Կողպված','Заблокирован','Locked'],
 disabled:['Անջատված','Отключён','Disabled'],
 enabled:['Միացված','Включена','Enabled'],
 notEnabled:['Անջատված','Выключена','Off'],
 search:['Անուն կամ email','Имя или email','Name or email'],
 noUsers:['Օգտատերեր չկան','Пользователей нет','No users found'],
 acceptedHint:['Հրավերը ստեղծված է։ Հաշիվը կհայտնվի ցուցակում, երբ օգտատերը ընդունի հրավերը։','Приглашение создано. Аккаунт появится в списке после его принятия.','Invitation created. The account will appear after the invite is accepted.'],
 inviteLink:['Հղում','Ссылка','Invitation link'],
 close:['Փակել','Закрыть','Close'],
 previous:['Նախորդ','Назад','Previous'],
 next:['Հաջորդ','Далее','Next'],
 count:['Ցուցադրված է','Показано','Showing'],
 companyScope:['ամբողջ ընկերություն','вся компания','organization-wide'],
 buildingScope:['շենք','здание','building'],
 unitScope:['բնակարան','квартира','unit'],
 supportOnly:['Support — սահմանափակ և աուդիտավորվող ներքին հասանելիություն','Support — ограниченный внутренний доступ с аудитом','Support — limited internal access with audit logging'],
};
const text=(language:Language,key:keyof typeof copy)=>copy[key][language==='hy'?0:language==='ru'?1:2];
const residentRoles=new Set(['unit_owner','renter','family']);

export default function PlatformUsersConsole({c,language,Modal,ErrorNotice}:Props){
 const [list,setList]=useState<UserList>();const [listError,setListError]=useState<unknown>();const [revision,setRevision]=useState(0);
 const [searchText,setSearchText]=useState('');const [query,setQuery]=useState('');const [offset,setOffset]=useState(0);
 const [catalog,setCatalog]=useState<Catalog>();const [organizations,setOrganizations]=useState<Organization[]>([]);
 const [referencesError,setReferencesError]=useState<unknown>();const [showInvite,setShowInvite]=useState(false);const [accessUser,setAccessUser]=useState<string>();
 const [accountType,setAccountType]=useState<'organization'|'internal'>('organization');
 const [email,setEmail]=useState('');const [organizationId,setOrganizationId]=useState('');const [role,setRole]=useState('org_admin');
 const [buildingId,setBuildingId]=useState('');const [unitId,setUnitId]=useState('');
 const [buildings,setBuildings]=useState<ScopeOption[]>([]);const [units,setUnits]=useState<ScopeOption[]>([]);
 const [busy,setBusy]=useState(false);const [submitError,setSubmitError]=useState<unknown>();const [success,setSuccess]=useState<Row>();
 const [revisionDetails,setRevisionDetails]=useState(0);

 useEffect(()=>{let live=true;setList(undefined);setListError(undefined);
  request<UserList>(`/iam/users?q=${encodeURIComponent(query)}&offset=${offset}`).then(data=>{if(live)setList(data)}).catch(error=>{if(live)setListError(error)});
  return()=>{live=false};
 },[c.id,query,offset,revision]);
 useEffect(()=>{let live=true;Promise.all([request<Catalog>('/iam/catalog'),request<Organization[]>('/organizations')])
  .then(([roles,orgs])=>{if(live){setCatalog(roles);setOrganizations(orgs)}}).catch(error=>{if(live)setReferencesError(error)});
  return()=>{live=false};
 },[c.id]);
 useEffect(()=>{let live=true;setBuildings([]);setUnits([]);setBuildingId('');setUnitId('');
  if(accountType==='organization'&&organizationId){
   request<Row>(`/platform/organizations/${encodeURIComponent(organizationId)}`).then(detail=>{
    if(live){setBuildings(detail.buildings??[]);setUnits(detail.units??[])};
   }).catch(error=>{if(live)setReferencesError(error)});
  }
  return()=>{live=false};
 },[accountType,organizationId]);

 const roles=useMemo(()=>Object.keys(catalog?.roles??{}).filter(key=>key!=='platform_admin'&&key!=='support'),[catalog]);
 const permissions=catalog?.roles[accountType==='internal'?'support':role]?.permissions??[];
 const visibleAssignments=(assignments:Assignment[]|undefined)=>!assignments?.length?'—':assignments.map((a,i)=>{
  const scope=a.unit_number?`${a.building_name??text(language,'building')} · ${text(language,'unit')} ${a.unit_number}`:
   a.building_name??(a.organization_name??text(language,'supportOnly'));
  return <span className="p-user-assignment" key={`${a.role_key}-${i}`}><strong>{roleName(language,a.role_key)}</strong><small>{scope}</small></span>;
 });
 const reload=()=>setRevision(value=>value+1);
 function openInvite(){setSubmitError(undefined);setSuccess(undefined);setAccountType('organization');setEmail('');setOrganizationId('');setRole('org_admin');setBuildingId('');setUnitId('');setShowInvite(true)}
 function changeAccountType(value:'organization'|'internal'){setAccountType(value);setOrganizationId('');setBuildingId('');setUnitId('');setRole(value==='internal'?'support':'org_admin');setReferencesError(undefined)}
 async function submitInvite(event:FormEvent){
  event.preventDefault();if(busy)return;setBusy(true);setSubmitError(undefined);
  const body=accountType==='internal'?{email,role:'support'}:{
   email,role,organizationId,...(buildingId?{buildingId}:{}),...(unitId?{unitId}:{})
  };
  try{
   const result=await request<Row>('/invitations','POST',body);
   setSuccess(result);reload();
  }catch(error){setSubmitError(error)}finally{setBusy(false)}
 }
 const pageCount=Math.max(1,Math.ceil((list?.total??0)/50));
 const page=Math.floor(offset/50)+1;

 return <>
  <section className="p-card p-platform-users">
   <header><div className="p-platform-users-title"><Users size={21}/><div><h2>{text(language,'accounts')}</h2><p>{text(language,'accessHint')}</p></div></div>
    <button className="p-button orange" type="button" onClick={openInvite}><Plus size={17}/>{text(language,'add')}</button>
   </header>
   <form className="p-user-search" onSubmit={event=>{event.preventDefault();setOffset(0);setQuery(searchText.trim())}}>
    <label><Search size={17}/><span className="sr-only">{text(language,'search')}</span><input value={searchText} onChange={event=>setSearchText(event.target.value)} placeholder={text(language,'search')}/></label>
    <button className="p-button" type="submit">{language==='ru'?'Найти':language==='hy'?'Փնտրել':'Search'}</button>
   </form>
   {listError?<><ErrorNotice error={listError}/><button className="p-button" onClick={reload}>{language==='ru'?'Повторить':language==='hy'?'Կրկնել':'Retry'}</button></>:
    !list?<p role="status">{language==='ru'?'Загрузка…':language==='hy'?'Բեռնվում է…':'Loading…'}</p>:
    list.rows.length===0?<div className="p-empty"><Users size={25}/><h3>{text(language,'noUsers')}</h3></div>:
    <div className="p-table-wrap"><table><thead><tr>
     <th>{language==='ru'?'Имя':language==='hy'?'Անուն':'Name'}</th><th>{text(language,'email')}</th><th>{text(language,'assignments')}</th>
     <th>{text(language,'status')}</th><th>{text(language,'mfa')}</th><th>{text(language,'manageAccess')}</th>
    </tr></thead><tbody>{list.rows.map(user=><tr key={user.id}>
     <td data-label={language==='ru'?'Имя':language==='hy'?'Անուն':'Name'}>{user.name||'—'}</td>
     <td data-label={text(language,'email')}>{user.email}</td>
     <td data-label={text(language,'assignments')}><div className="p-user-assignment-list">{visibleAssignments(user.assignments)}</div></td>
     <td data-label={text(language,'status')}><span className={'p-badge '+(user.account_status==='active'?'green':user.account_status==='locked'?'amber':'red')}>{text(language,user.account_status==='active'?'active':user.account_status==='locked'?'locked':'disabled')}</span></td>
     <td data-label={text(language,'mfa')}>{text(language,user.mfa_enabled?'enabled':'notEnabled')}</td>
     <td data-label={text(language,'manageAccess')}><button className="p-button small" type="button" onClick={()=>{setAccessUser(user.id);setRevisionDetails(value=>value+1)}}><KeyRound size={15}/>{text(language,'manageAccess')}</button></td>
    </tr>)}</tbody></table></div>}
   {list&&list.total>50&&<div className="p-pagination"><span>{text(language,'count')} {offset+1}–{Math.min(offset+list.rows.length,list.total)} / {list.total}</span>
    <button className="p-button small" type="button" disabled={offset===0} onClick={()=>setOffset(value=>Math.max(0,value-50))}><ArrowLeft size={15}/>{text(language,'previous')}</button>
    <span>{page} / {pageCount}</span>
    <button className="p-button small" type="button" disabled={offset+50>=list.total} onClick={()=>setOffset(value=>value+50)}>{text(language,'next')}<ArrowRight size={15}/></button>
   </div>}
  </section>
  {showInvite&&<Modal title={text(language,'add')} onClose={()=>{setShowInvite(false);setSuccess(undefined)}}>
   {success?<div className="p-user-invite-success">
    <div className="p-badge green">{text(language,'invite')}</div><p>{text(language,'acceptedHint')}</p>
    {success.url&&<><strong>{text(language,'inviteLink')}</strong><a className="p-invite-url" href={success.url}>{success.url}</a></>}
    <button className="p-button orange" type="button" onClick={()=>{setShowInvite(false);setSuccess(undefined)}}>{text(language,'close')}</button>
   </div>:<form className="p-edit-form" onSubmit={submitInvite}>
    <label>{text(language,'accountType')}<select value={accountType} onChange={event=>changeAccountType(event.target.value as 'organization'|'internal')}>
     <option value="organization">{text(language,'companyAccount')}</option><option value="internal">{text(language,'internalAccount')}</option>
    </select></label>
    <label>{text(language,'email')}<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={event=>setEmail(event.target.value)}/></label>
    {accountType==='organization'?<>
     <label>{text(language,'organization')}<select required value={organizationId} onChange={event=>setOrganizationId(event.target.value)}><option value="">{text(language,'selectOrganization')}</option>{organizations.map(org=><option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
     <label>{text(language,'role')}<select required value={role} onChange={event=>setRole(event.target.value)}><option value="">{language==='ru'?'Выберите роль':language==='hy'?'Ընտրեք դերը':'Select a role'}</option>{roles.map(key=><option key={key} value={key}>{roleName(language,key)}</option>)}</select></label>
     {organizationId&&<label>{text(language,'building')}<select required={residentRoles.has(role)} value={buildingId} onChange={event=>{setBuildingId(event.target.value);setUnitId('')}}><option value="">{text(language,'wholeOrganization')}</option>{buildings.map(building=><option key={building.id} value={building.id}>{building.name}</option>)}</select></label>}
     {buildingId&&<label>{text(language,'unit')}<select required={residentRoles.has(role)} value={unitId} onChange={event=>setUnitId(event.target.value)}><option value="">{residentRoles.has(role)?text(language,'selectUnit'):text(language,'wholeBuilding')}</option>{units.filter(unit=>unit.building_id===buildingId).map(unit=><option key={unit.id} value={unit.id}>{unit.number}</option>)}</select></label>}
     <p className="p-muted-note">{text(language,'accessHint')}</p>
    </>:<><label>{text(language,'role')}<input value={roleName(language,'support')} readOnly/></label><p className="p-info"><Building2 size={17}/>{text(language,'internalHint')}</p><p className="p-muted-note">{text(language,'supportOnly')}</p></>}
    {permissions.length>0&&<details className="p-user-permissions"><summary>{text(language,'rolePermissions')} · {permissions.length} {text(language,'roleCount')}</summary><div className="p-permissions">{permissions.map(permission=><code key={permission}>{permission}</code>)}</div></details>}
    {!!referencesError&&<ErrorNotice error={referencesError}/>}
    {!!submitError&&<ErrorNotice error={submitError}/>}
    <button className="p-button orange" disabled={busy||!catalog||!!referencesError}>{busy?(language==='ru'?'Отправляем…':language==='hy'?'Ուղարկվում է…':'Sending…'):text(language,'invite')}<ArrowRight size={17}/></button>
   </form>}
  </Modal>}
  {accessUser&&<EmployeeAssignment key={`${accessUser}-${revisionDetails}`} id={accessUser} language={language} Modal={Modal} ErrorNotice={ErrorNotice} onClose={()=>setAccessUser(undefined)} onSaved={reload}/>}
 </>;
}
