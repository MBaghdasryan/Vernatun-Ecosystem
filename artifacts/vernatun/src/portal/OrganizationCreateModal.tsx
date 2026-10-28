import {useState,type FormEvent} from 'react';
import {request} from './client';
import type {Language} from './i18n';
import {Dlg,Fail,Frozen,p5,useFrozen,type Row} from './phase5-ui';

const MODULES=[
 ['requests',['Հայտեր և աշխատանքներ','Заявки и работы','Requests & work orders']],
 ['finance',['Ֆինանսներ','Финансы','Finance']],
 ['handover',['Հանձնում և թերություններ','Передача и дефекты','Handover & defects']],
 ['access',['Մուտքի վերահսկում','Контроль доступа','Access control']],
 ['community',['Համայնք','Сообщество','Community']],
 ['maintenance',['Սպասարկում','Обслуживание','Maintenance']],
 ['meters',['Հաշվիչներ','Счётчики','Meters']],
 ['documents',['Փաստաթղթեր','Документы','Documents']],
 ['smart_building',['Խելացի շենք','Умный дом','Smart building']],
] as const;
const TEXT={
 companyType:['Կազմակերպության տեսակ','Тип организации','Organization type'],
 developer:['Կառուցապատող','Застройщик','Property developer'],
 managementCompany:['Կառավարող ընկերություն','Управляющая компания','Management company'],
 chooseModules:['Հասանելի մոդուլներ','Доступные модули','Available modules'],
 moduleHint:['Նշեք առնվազն մեկ մոդուլ։ Ընտրությունը կգրանցվի որպես սկզբնական հասանելիություն այս կազմակերպության համար։','Выберите хотя бы один модуль. Выбор задаёт первоначально доступные модули этой организации.','Select at least one module. This sets the organization’s initial module access.'],
 createTitle:['Ավելացնել կազմակերպություն','Добавить организацию','Add organization'],
} as const;
const text=(language:Language,key:keyof typeof TEXT)=>TEXT[key][language==='hy'?0:language==='ru'?1:2];

type Draft={companyType:string;name:string;legalName:string;taxId:string;contactEmail:string;contactPhone:string;address:string;timezone:string;currency:string;defaultLanguage:string};
export default function OrganizationCreateModal({language,onClose,onCreated}:{language:Language;onClose:()=>void;onCreated:(row:Row)=>void}){
 const [draft,setDraft]=useState<Draft>({companyType:'management_company',name:'',legalName:'',taxId:'',contactEmail:'',contactPhone:'',address:'',timezone:'Asia/Yerevan',currency:'AMD',defaultLanguage:'hy'});
 const [modules,setModules]=useState<string[]>([]);
 const [error,setError]=useState<unknown>();
 const saver=useFrozen(),tx=(key:string)=>p5(language,key),locked=saver.pending||saver.uncertain;
 const update=(key:keyof Draft,value:string)=>setDraft(old=>({...old,[key]:value}));
 async function submit(e:FormEvent){
  e.preventDefault();if(locked||modules.length===0)return;setError(undefined);
  try{
   const row=await saver.send<Row>('POST','/organizations',key=>({...draft,key,modules}),()=>true);
   if(row)onCreated(row);
  }catch(e){setError(e)}
 }
 async function retry(){try{const row=await saver.retry<Row>(()=>true);if(row)onCreated(row)}catch(e){setError(e)}}
 return <Dlg l={language} title={text(language,'createTitle')} onClose={()=>{if(!saver.pending)onClose()}}>
  <form className="p-edit-form" onSubmit={e=>void submit(e)}>
   <label>{text(language,'companyType')}<select value={draft.companyType} disabled={locked} onChange={e=>update('companyType',e.target.value)}>
    <option value="management_company">{text(language,'managementCompany')}</option><option value="developer">{text(language,'developer')}</option>
   </select></label>
   <div className="p5-grid2">
    <label>{tx('name')}<input required minLength={2} maxLength={200} value={draft.name} disabled={locked} onChange={e=>update('name',e.target.value)}/></label>
    <label>{tx('legalName')}<input maxLength={200} value={draft.legalName} disabled={locked} onChange={e=>update('legalName',e.target.value)}/></label>
    <label>{tx('taxId')}<input maxLength={80} value={draft.taxId} disabled={locked} onChange={e=>update('taxId',e.target.value)}/></label>
    <label>{tx('contactEmail')}<input type="email" maxLength={200} value={draft.contactEmail} disabled={locked} onChange={e=>update('contactEmail',e.target.value)}/></label>
    <label>{tx('contactPhone')}<input type="tel" maxLength={80} value={draft.contactPhone} disabled={locked} onChange={e=>update('contactPhone',e.target.value)}/></label>
    <label>{tx('address')}<input maxLength={500} value={draft.address} disabled={locked} onChange={e=>update('address',e.target.value)}/></label>
    <label>{tx('timezone')}<input required maxLength={100} value={draft.timezone} disabled={locked} onChange={e=>update('timezone',e.target.value)}/></label>
    <label>{tx('currency')}<select value={draft.currency} disabled={locked} onChange={e=>update('currency',e.target.value)}>{['AMD','RUB','USD'].map(x=><option key={x}>{x}</option>)}</select></label>
    <label>{tx('defaultLanguage')}<select value={draft.defaultLanguage} disabled={locked} onChange={e=>update('defaultLanguage',e.target.value)}>{[['hy','Հայերեն'],['ru','Русский'],['en','English']].map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label>
   </div>
   <fieldset style={{border:'1px solid var(--p-border)',borderRadius:12,padding:14}}>
    <legend>{text(language,'chooseModules')}</legend><p className="p5-muted">{text(language,'moduleHint')}</p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:10}}>
     {MODULES.map(([key,labels])=><label key={key} style={{display:'flex',alignItems:'center',gap:9,padding:10,border:'1px solid var(--p-border)',borderRadius:10}}>
      <input type="checkbox" checked={modules.includes(key)} disabled={locked} onChange={e=>setModules(old=>e.target.checked?[...old,key]:old.filter(x=>x!==key))}/>
      <span>{labels[language==='hy'?0:language==='ru'?1:2]}</span>
     </label>)}
    </div>
   </fieldset>
   <Frozen l={language} h={saver} onRetry={()=>void retry()} onAbandon={()=>{saver.abandon();onClose()}}/>
   <Fail l={language} error={error}/>
   <div className="p-modal-actions"><button type="button" className="p-button" disabled={saver.pending} onClick={onClose}>{tx('cancel')}</button><button className="p-button orange" disabled={locked||modules.length===0}>{saver.pending?tx('saving'):tx('create')}</button></div>
  </form>
 </Dlg>;
}
