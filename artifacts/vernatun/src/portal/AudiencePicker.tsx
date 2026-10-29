import {useEffect,useState} from 'react';
import {request} from './client';
import type {Language} from './i18n';

export type AudienceTarget={type:'user'|'organization'|'building'|'all';id?:string;organizationId?:string};
type Row={id:string;name:string;email?:string;address?:string;company_type?:string};
const words={
 en:{type:'Audience',all:'All active users',org:'Organization',building:'Building residents',user:'One user',
  orgPick:'Choose an organization',buildingPick:'Choose a building',userPick:'Choose a user',search:'Search',query:'Search by name or email'},
 ru:{type:'Получатели',all:'Все активные пользователи',org:'Компания',building:'Жители здания',user:'Один пользователь',
  orgPick:'Выберите компанию',buildingPick:'Выберите здание',userPick:'Выберите пользователя',search:'Найти',query:'Поиск по имени или email'},
 hy:{type:'Ստացողներ',all:'Բոլոր ակտիվ օգտատերերը',org:'Կազմակերպություն',building:'Շենքի բնակիչներ',user:'Մեկ օգտատեր',
  orgPick:'Ընտրեք կազմակերպություն',buildingPick:'Ընտրեք շենք',userPick:'Ընտրեք օգտատեր',search:'Որոնել',query:'Որոնել անունով կամ email-ով'},
} as const;

export default function AudiencePicker({language,value,onChange}:{language:Language;value:AudienceTarget;onChange:(target:AudienceTarget)=>void}){
 const t=words[language];const [query,setQuery]=useState(''),[rows,setRows]=useState<Row[]>([]),[organizations,setOrganizations]=useState<Row[]>([]),[error,setError]=useState('');
 const [organizationId,setOrganizationId]=useState(value.type==='building'?value.organizationId??'':'');
 useEffect(()=>{setOrganizationId(value.type==='building'?value.organizationId??'':'')},[value.type,value.type==='building'?value.organizationId:'']);
 useEffect(()=>{let active=true;setError('');
  const kind=value.type==='organization'?'organizations':value.type==='building'?'buildings':value.type==='user'?'users':null;
  if(value.type==='building'){
   request<Row[]>(`/platform/communications/targets/organizations?q=${encodeURIComponent(query)}`)
    .then(r=>{if(active)setOrganizations(r)}).catch(()=>{if(active)setError('Could not load organizations')});
  }else setOrganizations([]);
  if(!kind){setRows([]);return}
  const params=new URLSearchParams({q:query});
  if(kind==='buildings'){if(!organizationId){setRows([]);return}params.set('organizationId',organizationId)}
  request<Row[]>(`/platform/communications/targets/${kind}?${params}`).then(r=>{if(active)setRows(r)}).catch(()=>{if(active){setRows([]);setError('Could not load recipients')}})
  return()=>{active=false}
 },[value.type,organizationId,query]);
 const selected=rows.find(r=>r.id===value.id);
 return <div className="cx-filters">
  <label>{t.type}<select value={value.type} onChange={e=>onChange(e.target.value==='all'?{type:'all'}:{type:e.target.value as AudienceTarget['type']})}>
   <option value="all">{t.all}</option><option value="organization">{t.org}</option><option value="building">{t.building}</option><option value="user">{t.user}</option>
  </select></label>
  {value.type==='building'&&<label>{t.org}<select value={organizationId} onChange={e=>{setOrganizationId(e.target.value);onChange({type:'building',organizationId:e.target.value})}}>
   <option value="">{t.orgPick}</option>{organizations.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
  </select></label>}
  {value.type!=='all'&&<label>{value.type==='organization'?t.orgPick:value.type==='building'?t.buildingPick:t.userPick}
   <select value={value.id??''} onChange={e=>onChange(value.type==='building'?{type:'building',organizationId,id:e.target.value}:{type:value.type,id:e.target.value})}>
    <option value="">{value.type==='organization'?t.orgPick:value.type==='building'?t.buildingPick:t.userPick}</option>
    {rows.map(r=><option key={r.id} value={r.id}>{r.name}{r.email?` · ${r.email}`:''}{r.address?` · ${r.address}`:''}</option>)}
   </select>
  </label>}
  {value.type!=='all'&&<label>{t.query}<input value={query} onChange={e=>setQuery(e.target.value)} maxLength={100}/></label>}
  {error&&<span role="alert" className="p-error">{error}</span>}
  {value.type==='user'&&selected&&<span>{selected.name} · {selected.email}</span>}
 </div>
}
