import {useEffect,useRef,useState,type ComponentType,type FormEvent,type ReactNode} from 'react';
import {ArrowRight,RotateCcw} from 'lucide-react';
import {request,ApiClientError} from './client';
import {roleName,date,index,type Language} from './i18n';
import type {EmployeeAssignmentDetail as Detail} from '@workspace/api-client-react';

type Building={id:string;name:string;address?:string};
type UnitRow={id:string;number:string;building_id:string;building_name?:string};

const S={
 title:['Աշխատակցի նշանակում','Назначение сотрудника','Employee assignment'],
 open:['Մանրամասներ','Подробнее','Details'],
 starts:['Սկիզբ','Начало','Starts'],
 expires:['Ավարտ','Окончание','Expires'],
 noExpiry:['Առանց ժամկետի','Бессрочно','No expiration'],
 clearExpiry:['Հեռացնել ժամկետը','Убрать срок','Clear expiration'],
 building:['Շենք','Здание','Building'],unit:['Տարածք','Помещение','Unit'],
 orgWide:['Ամբողջ կազմակերպությունը','Вся организация','Entire organization'],
 wholeBuilding:['Ամբողջ շենքը','Всё здание','Entire building'],
 role:['Դեր','Роль','Role'],status:['Կարգավիճակ','Статус','Status'],
 active:['Ակտիվ','Активно','Active'],inactive:['Ոչ ակտիվ','Неактивно','Inactive'],
 basePerms:['Դերի բազային թույլտվություններ','Базовые разрешения роли','Base role permissions'],
 basePermsHint:['Սա դերի ստանդարտ հավաքածուն է, ոչ թե օգտատիրոջ փաստացի հասանելիությունը։','Это стандартный набор роли, а не фактический доступ пользователя.','This is the role\'s standard set, not the user\'s effective access.'],
 noPerms:['Թույլտվություններ չկան','Разрешений нет','No permissions'],
 readOnly:['Այս նշանակումը հնարավոր չէ խմբագրել այստեղ։ Սեփական, ոչ ակտիվ և բնակիչների նշանակումները փոփոխման ենթակա չեն այս էկրանից․ բնակիչների կյանքի ցիկլը կառավարվում է առանձին բաժնում։','Это назначение нельзя изменить здесь. Собственные, неактивные и жительские назначения не редактируются на этом экране; жизненный цикл жителей управляется в отдельном разделе.','This assignment cannot be edited here. Your own, inactive and resident assignments are not editable from this screen; resident lifecycle is managed elsewhere.'],
 orgAdminScope:['Կազմակերպության ադմինիստրատորը պետք է ունենա ամբողջ կազմակերպության հասանելիություն։ Շենքը և տարածքը կհեռացվեն։','Администратор организации должен иметь доступ ко всей организации. Здание и помещение будут сняты.','Organization administrator must be organization-wide. Building and unit will be cleared.'],
 expiryOrder:['Ավարտը պետք է լինի սկզբից հետո։','Окончание должно быть позже начала.','Expiration must be after the start.'],
 conflict:['Նշանակումը փոխվել է մեկ այլ օգտատիրոջ կողմից։ Վերաբեռնեք՝ թարմ տվյալները տեսնելու համար։ Ձեր փոփոխությունները չեն պահպանվել։','Назначение изменено другим пользователем. Перезагрузите, чтобы увидеть актуальные данные. Ваши изменения не сохранены.','This assignment was changed by someone else. Reload to see the latest data. Your changes were not saved.'],
 lastAdmin:['Պետք է մնա առնվազն մեկ ակտիվ, անժամկետ ադմինիստրատոր՝ ամբողջ կազմակերպության հասանելիությամբ։','Должен остаться хотя бы один действующий бессрочный администратор с доступом ко всей организации.','At least one active, non-expiring organization-wide administrator must remain.'],
 reload:['Վերաբեռնել','Перезагрузить','Reload'],
 noBuildings:['Շենքեր չկան','Зданий нет','No buildings'],noUnits:['Այս շենքում տարածքներ չկան','В этом здании нет помещений','No units in this building'],
 timeHint:['Ժամը՝ ձեր սարքի ժամային գոտով։','Время в часовом поясе вашего устройства.','Time in your device time zone.'],
} as const;

const pad=(n:number)=>String(n).padStart(2,'0');
function toLocalInput(iso:string|null){if(!iso)return '';const d=new Date(iso);if(isNaN(d.getTime()))return '';return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes())}
function fromLocalInput(v:string){return v.length===16?v+':00':v}
function withOffset(v:string){const d=new Date(v);if(isNaN(d.getTime()))return null;const o=-d.getTimezoneOffset(),a=Math.abs(o);return fromLocalInput(v)+(o>=0?'+':'-')+pad(Math.floor(a/60))+':'+pad(a%60)}

export default function EmployeeAssignment({id,language,onClose,onSaved,Modal,ErrorNotice}:{id:string;language:Language;onClose:()=>void;onSaved:()=>void;Modal:ComponentType<{title:string;onClose:()=>void;children:ReactNode}>;ErrorNotice:ComponentType<{error:unknown}>}){
 const L=index(language);const s=(k:keyof typeof S)=>S[k][L];
 const [detail,setDetail]=useState<Detail>();const [loadError,setLoadError]=useState<unknown>();const [loadRev,setLoadRev]=useState(0);
 const [buildings,setBuildings]=useState<Building[]>();const [units,setUnits]=useState<UnitRow[]>();const [refError,setRefError]=useState<unknown>();
 const [role,setRole]=useState('');const [buildingId,setBuildingId]=useState('');const [unitId,setUnitId]=useState('');
 const [starts,setStarts]=useState('');const [expires,setExpires]=useState('');
 const [startsEdited,setStartsEdited]=useState(false);const [expiresEdited,setExpiresEdited]=useState(false);
 const [busy,setBusy]=useState(false);const busyRef=useRef(false);const [error,setError]=useState<unknown>();const [conflict,setConflict]=useState(false);const [formError,setFormError]=useState('');
 useEffect(()=>{let live=true;setDetail(undefined);setLoadError(undefined);request<Detail>('/roles/'+id).then(d=>{if(!live)return;const a=d.assignment;setDetail(d);setRole(a.role_key);setBuildingId(a.building_id??'');setUnitId(a.unit_id??'');setStarts(toLocalInput(a.starts_at));setExpires(toLocalInput(a.expires_at));setStartsEdited(false);setExpiresEdited(false);setConflict(false);setError(undefined);setFormError('')}).catch(e=>{if(live)setLoadError(e)});return()=>{live=false}},[id,loadRev]);
 const editable=!!detail?.editable;
 useEffect(()=>{if(!editable)return;let live=true;setRefError(undefined);Promise.all([request<Building[]>('/properties'),request<UnitRow[]>('/units')]).then(([b,u])=>{if(live){setBuildings(Array.isArray(b)?b:[]);setUnits(Array.isArray(u)?u:[])}}).catch(e=>{if(live)setRefError(e)});return()=>{live=false}},[editable]);
  function changeRole(r:string){setRole(r)}
 async function submit(e:FormEvent){e.preventDefault();if(busyRef.current||!detail)return;setFormError('');setError(undefined);
  const a=detail.assignment;
  const startsAt=startsEdited?withOffset(starts):a.starts_at;
  const expiresAt=expiresEdited?(expires?withOffset(expires):null):a.expires_at;
  if(!startsAt){setFormError(S.expiryOrder[L]);return}
  if(expiresAt&&new Date(expiresAt)<=new Date(startsAt)){setFormError(s('expiryOrder'));return}
  if(unitId&&!buildingId)return;
  busyRef.current=true;setBusy(true);
  try{await request('/roles/'+id,'PATCH',{version:a.version,roleKey:role,buildingId:buildingId||null,unitId:buildingId&&unitId?unitId:null,startsAt,expiresAt});onSaved();onClose()}
   catch(err){if(err instanceof ApiClientError&&err.code==='concurrent_change')setConflict(true);else if(err instanceof ApiClientError&&err.code==='last_administrator')setFormError(s('lastAdmin'));else setError(err)}
  finally{busyRef.current=false;setBusy(false)}}
 const a=detail?.assignment;
 const bName=(bid:string|null)=>bid?(buildings?.find(b=>b.id===bid)?.name??bid):s('orgWide');
 const shownUnits=(units??[]).filter(u=>u.building_id===buildingId);
 return <Modal title={s('title')} onClose={onClose}>
  {loadError?<><ErrorNotice error={loadError}/><div className="p-modal-actions"><button type="button" className="p-button" onClick={()=>setLoadRev(x=>x+1)}><RotateCcw size={16}/>{s('reload')}</button></div></>
  :!a||!detail?<p role="status">{index(language)===0?'Բեռնվում է…':index(language)===1?'Загрузка…':'Loading…'}</p>
  :<>
    <div className="p-scope"><span className="p-avatar">{(a.name||a.email||'').slice(0,1).toUpperCase()}</span><div><strong>{a.name}</strong><p>{a.email}</p></div></div>
   <div className="p-scope-line"><span>{s('status')}</span><strong><span className={'p-badge '+(a.active?'green':'red')}>{s(a.active?'active':'inactive')}</span></strong></div>
   {!editable&&<>
    <div className="p-scope-line"><span>{s('role')}</span><strong>{roleName(language,a.role_key)}</strong></div>
    <div className="p-scope-line"><span>{s('building')}</span><strong>{a.building_id?(a.unit_id?s('unit')+' · ':'')+bName(a.building_id):s('orgWide')}</strong></div>
    <div className="p-scope-line"><span>{s('starts')}</span><strong>{date(a.starts_at,language)}</strong></div>
    <div className="p-scope-line"><span>{s('expires')}</span><strong>{a.expires_at?date(a.expires_at,language):s('noExpiry')}</strong></div>
    <div className="p-info" role="note">{s('readOnly')}</div>
   </>}
   {editable&&<form className="p-edit-form" onSubmit={submit}>
    <label>{s('role')}<select value={role} onChange={e=>changeRole(e.target.value)} required>{!detail.editableRoles.includes(role)&&<option value={role}>{roleName(language,role)}</option>}{detail.editableRoles.map(r=><option key={r} value={r}>{roleName(language,r)}</option>)}</select></label>
    {refError?<><ErrorNotice error={refError}/></>:!buildings||!units?<p role="status">{index(language)===0?'Բեռնվում է…':index(language)===1?'Загрузка…':'Loading…'}</p>:<>
      <label>{s('building')}<select value={buildingId} onChange={e=>{setBuildingId(e.target.value);setUnitId('')}}><option value="">{s('orgWide')}</option>{buildings.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>{buildings.length===0&&<small>{s('noBuildings')}</small>}</label>
      {buildingId&&<label>{s('unit')}<select value={unitId} onChange={e=>setUnitId(e.target.value)}><option value="">{s('wholeBuilding')}</option>{shownUnits.map(u=><option key={u.id} value={u.id}>{u.number}</option>)}</select>{shownUnits.length===0&&<small>{s('noUnits')}</small>}</label>}
    </>}
    <label>{s('starts')}<input type="datetime-local" required value={starts} onChange={e=>{setStarts(e.target.value);setStartsEdited(true)}}/><small>{s('timeHint')}</small></label>
    <label>{s('expires')}<input type="datetime-local" value={expires} onChange={e=>{setExpires(e.target.value);setExpiresEdited(true)}}/>{expires?<button type="button" className="p-button small" onClick={()=>{setExpires('');setExpiresEdited(true)}}>{s('clearExpiry')}</button>:<small>{s('noExpiry')}</small>}</label>
     <section><strong>{s('basePerms')} · {roleName(language,a.role_key)}</strong><p className="p-muted-note">{s('basePermsHint')}</p>{detail.permissions.length?<div className="p-permissions">{detail.permissions.map(p=><span className="p-permission-label" key={p}>{p}</span>)}</div>:<p>{s('noPerms')}</p>}</section>
    {formError&&<div className="p-error" role="alert">{formError}</div>}
    {conflict&&<div className="p-error" role="alert">{s('conflict')} <button type="button" className="p-button small" onClick={()=>setLoadRev(x=>x+1)}><RotateCcw size={14}/>{s('reload')}</button></div>}
    {!!error&&<ErrorNotice error={error}/>}
    <button className="p-button orange" disabled={busy||conflict||!!refError||!buildings}>{busy?(['Պահպանվում է…','Сохраняем…','Saving…'][L]):(['Պահպանել','Сохранить','Save'][L])}<ArrowRight size={17}/></button>
   </form>}
   {!editable&&detail.permissions.length>0&&<section><strong>{s('basePerms')}</strong><p className="p-muted-note">{s('basePermsHint')}</p><div className="p-permissions">{detail.permissions.map(p=><span className="p-permission-label" key={p}>{p}</span>)}</div></section>}
  </>}
 </Modal>;
}
export const assignmentDetailsLabel=(l:Language)=>S.open[index(l)];
