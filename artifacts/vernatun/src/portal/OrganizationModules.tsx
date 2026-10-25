import {useCallback,useEffect,useState} from 'react';
import type {Language} from './i18n';
import {request} from './client';

type ModuleKey='requests'|'finance'|'handover'|'access'|'community'|'maintenance'|'meters'|'documents';
type ModuleEntry={module:ModuleKey;enabled:boolean;override_state:string;updatedAt:string};
type ModuleResponse={modules:ModuleEntry[];enforced:boolean;state:string;readOnly:boolean};

const labels:Record<ModuleKey,[string,string,string]>={
 requests:['Հարցումներ և աշխատանքներ','Заявки и работы','Requests & work orders'],
 finance:['Ֆինանսներ','Финансы','Finance'],
 handover:['Հանձնում և թերություններ','Передача и дефекты','Handover & defects'],
 access:['Մուտքի վերահսկում','Контроль доступа','Access control'],
 community:['Համայնք','Сообщество','Community'],
 maintenance:['Սպասարկում','Обслуживание','Maintenance'],
 meters:['Հաշվիչներ','Счётчики','Meters'],
 documents:['Փաստաթղթեր','Документы','Documents'],
};
const text={
 title:['Կազմակերպության մոդուլներ','Модули организации','Organization modules'],
 note:['Ցուցադրվում են միայն ձեր բաժանորդագրությամբ հասանելի մոդուլները։ Փոփոխությունները վերաբերում են միայն այս կազմակերպությանը։','Показаны только модули, доступные по вашей подписке. Изменения относятся только к этой организации.','Only modules allowed by your subscription are shown. Changes apply to this organization only.'],
 noModules:['Այս բաժանորդագրության համար հասանելի մոդուլներ չկան։','Для этой подписки доступных модулей нет.','No modules are available under this subscription.'],
 enabled:['Միացված է','Включён','Enabled'],
 disabled:['Անջատված է','Выключен','Disabled'],
 status:['Վիճակ','Статус','Status'],
 manage:['Փոփոխել','Управление','Manage'],
 readOnly:['Բաժանորդագրության վիճակն այժմ թույլ է տալիս միայն դիտում։','Состояние подписки сейчас допускает только просмотр.','The current subscription state allows viewing only.'],
 legacy:['Գործում է կազմակերպության նախկին հասանելիության քաղաքականությունը։','Действует прежняя политика доступа организации.','The organization retains its existing access policy.'],
 loading:['Բեռնվում է…','Загрузка…','Loading…'],
 error:['Չհաջողվեց բեռնել մոդուլները։','Не удалось загрузить модули.','Could not load modules.'],
 retry:['Կրկնել','Повторить','Retry'],
 forbidden:['Այս բաժնի համար թույլտվություն չկա։','Нет разрешения на этот раздел.','You do not have permission for this section.'],
 noManage:['Մոդուլները կարող եք դիտել, բայց փոփոխելու թույլտվություն չունեք։','Вы можете просматривать модули, но у вас нет права изменять их.','You can view modules but do not have permission to change them.'],
 stale:['Տվյալները փոխվել են մեկ այլ գործողությամբ։ Ցուցակը թարմացվել է, նորից փորձեք։','Данные изменились после загрузки. Список обновлён; повторите попытку.','The module changed after you loaded it. The list was refreshed; try again.'],
 plan:['Այս մոդուլը ներառված չէ գործող բաժանորդագրության մեջ։','Этот модуль не входит в текущую подписку.','This module is not included in the current subscription.'],
 restricted:['Բաժանորդագրության ընթացիկ վիճակը թույլ չի տալիս փոփոխություններ կատարել։','Текущее состояние подписки запрещает изменения.','The current subscription state does not allow changes.'],
 generic:['Չհաջողվեց պահպանել փոփոխությունը։','Не удалось сохранить изменение.','Could not save the change.'],
 extension:['Այս գործողությունը չի տեղադրում ընդլայնումներ կամ կամայական փաթեթային կոդ։','Это действие не устанавливает расширения или произвольный пакетный код.','This does not install extensions or execute arbitrary package code.'],
 refresh:['Թարմացնել','Обновить','Refresh'],
} as Record<string,[string,string,string]>;
const languageIndex=(language:Language)=>language==='hy'?0:language==='ru'?1:2;

export default function OrganizationModules({language,canRead,canManage}:{language:Language;canRead:boolean;canManage:boolean}){
 const index=languageIndex(language);
 const [data,setData]=useState<ModuleResponse>();
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState<unknown>();
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState<string>();
 const load=useCallback(async()=>{
  setLoading(true);setError(undefined);
  try{setData(await request<ModuleResponse>('/modules'))}
  catch(e){setError(e)}
  finally{setLoading(false)}
 },[]);
 useEffect(()=>{
  void load();
  const timer=window.setInterval(()=>void load(),30000);
  const focus=()=>{void load();window.dispatchEvent(new Event('popstate'))};
  window.addEventListener('focus',focus);
  return()=>{window.clearInterval(timer);window.removeEventListener('focus',focus)};
 },[load]);
 const toggle=async(entry:ModuleEntry)=>{
  if(busy)return;
  setBusy(entry.module);setMessage('');setError(undefined);
  try{
   await request('/modules/'+entry.module,'PATCH',{enabled:!entry.enabled,expectedUpdatedAt:entry.updatedAt});
   window.dispatchEvent(new Event('popstate'));
   await load();
  }catch(e){
   const code=typeof e==='object'&&e&&'code'in e?String((e as {code:unknown}).code):'';
   setMessage(code==='stale_module_state'?text.stale[index]:code==='plan_module_not_available'?text.plan[index]:code==='subscription_restricted'?text.restricted[index]:text.generic[index]);
   if(code==='stale_module_state')await load();
  }finally{setBusy(undefined)}
 };
 if(!canRead)return <section className="p-card"><p className="p-error" role="alert">{text.forbidden[index]}</p></section>;
 if(error&&!data)return <section className="p-card"><p role="alert">{text.error[index]}</p><button className="p-button" onClick={()=>void load()}>{text.retry[index]}</button></section>;
 if(!data)return <section className="p-card" role="status" aria-busy="true">{text.loading[index]}</section>;
 return <section className="p-card sc-card" aria-busy={loading}>
  <header><h2>{text.title[index]}</h2><button className="p-button small" disabled={loading} onClick={()=>void load()}>{text.refresh[index]}</button></header>
  <p className="p-muted-note">{text.note[index]}</p>
  {!canManage&&<p className="p-info" role="status">{text.noManage[index]}</p>}
  {!data.enforced&&<p className="p-info">{text.legacy[index]}</p>}
  {data.readOnly&&<p className="p-info" role="status">{text.readOnly[index]}</p>}
  {!!error&&<p role="alert">{text.error[index]}</p>}
  {message&&<p className="p-error" role="alert">{message}</p>}
  <p className="sc-note">{text.extension[index]}</p>
  {data.modules.length===0?<p role="status">{text.noModules[index]}</p>:<div className="cx-scroll"><table className="cx-table sc-table">
   <thead><tr><th>{text.title[index]}</th><th>{text.status[index]}</th><th>{text.manage[index]}</th></tr></thead>
   <tbody>{data.modules.map(entry=><tr key={entry.module} data-testid={'row-organization-module-'+entry.module}>
    <td><strong>{labels[entry.module][index]}</strong><br/><small className="sc-mono">{entry.module}</small></td>
    <td>{entry.enabled?text.enabled[index]:text.disabled[index]}</td>
    <td><button type="button" className={'p-switch '+(entry.enabled?'on':'')} role="switch" aria-checked={entry.enabled}
     aria-label={labels[entry.module][index]} disabled={!canManage||loading||!!busy||data.readOnly}
     onClick={()=>void toggle(entry)} data-testid={'switch-organization-module-'+entry.module}><span/></button></td>
   </tr>)}</tbody>
  </table></div>}
 </section>;
}
