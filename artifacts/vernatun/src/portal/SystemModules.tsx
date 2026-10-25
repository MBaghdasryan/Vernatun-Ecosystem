import {useCallback,useEffect,useState} from 'react';
import {getSystemModuleRegistry} from '@workspace/api-client-react';
import type {Language} from './i18n';
import './system-console.css';

const L=(l:Language)=>l==='hy'?0:l==='ru'?1:2;
const T:Record<string,[string,string,string]>={
 title:['Մոդուլներ և ընդլայնումներ','Модули и расширения','Modules & Extensions'],
 core:['Հիմնական մոդուլ','Основной модуль','Core module'],installed:['Տեղադրված կոդում','Включён в сборку','Installed in code'],
 enabled:['Միացված կազմակերպություններ','Включено организаций','Enabled organizations'],forcedOn:['Հարկադիր միացված','Принудительно включено','Forced on'],
 forcedOff:['Հարկադիր անջատված','Принудительно отключено','Forced off'],plans:['Ներառված է պլաններում','Включён в тарифы','Included in plans'],
 dependencies:['Կախվածություններ','Зависимости','Dependencies'],capabilities:['Իրավասություններ','Разрешения','Capabilities'],
 noPlans:['Ոչ մի պլանում նշված չէ','Не включён ни в один тариф','Not included in a plan'],
 noCapabilities:['Գործառնական թույլտվություններ չեն գրանցվել','Рабочие разрешения не зарегистрированы','No mapped permissions registered'],
 extTitle:['Ընդլայնումներ','Расширения','Extensions'],none:['Գրանցված ընդլայնումներ չկան։','Зарегистрированных расширений нет.','No registered extensions.'],
 policy:['Ընդլայնման փաթեթների վերբեռնումն ու կատարումը միացված չեն։ Ցուցադրվում են միայն կոդում գրանցված հիմնական մոդուլները։','Загрузка и выполнение пакетов расширений отключены. Отображаются только основные модули, зарегистрированные в коде.','Extension package uploads and execution are disabled. Only core modules registered in source are listed.'],
 manage:['Սա գրանցված մոդուլների ընդհանուր, միայն դիտման ցանկն է։ Կազմակերպության ադմինիստրատորը կարող է կառավարել իր պլանով թույլատրված մոդուլները կազմակերպության «Մոդուլներ» բաժնում։','Это общий список зарегистрированных модулей только для просмотра. Администратор организации управляет разрешёнными тарифом модулями в разделе «Модули» своей организации.','This is a read-only catalog of registered modules. Organization admins manage plan-allowed modules in their organization’s Modules section.'],
 version:['Տարբերակը չի գրանցվել','Версия не указана','Version not registered'],
 loading:['Բեռնվում է…','Загрузка…','Loading…'],error:['Չհաջողվեց բեռնել գրանցամատյանը։','Не удалось загрузить реестр.','Could not load registry.'],
 refresh:['Թարմացնել','Обновить','Refresh'],forbidden:['Այս բաժնի համար թույլտվություն չկա։','Нет разрешения на этот раздел.','You do not have permission for this section.'],
};
type ModuleItem={moduleId:string;name:string;version:string|null;type:string;status:string;category:string;dependencies:string[];
 capabilities:string[];enabledOrganizations:number;forcedEnabled:number;forcedDisabled:number;planIncludedBy:{id:string;name:string}[]};
type Registry={modules:ModuleItem[];extensions:unknown[];extensionPolicy:{installationSupported:boolean;message:string};management:{dependencyConflicts:number}};
const tx=(l:Language,k:string)=>T[k]?.[L(l)]??k;

export default function SystemModules({language,canRead}:{language:Language;canRead:boolean}){
 const [data,setData]=useState<Registry>();const [busy,setBusy]=useState(false);const [error,setError]=useState(false);
 const load=useCallback(async()=>{setBusy(true);setError(false);try{setData(await getSystemModuleRegistry({credentials:'include'}) as Registry)}catch{setData(undefined);setError(true)}finally{setBusy(false)}},[]);
 useEffect(()=>{void load()},[load]);
 if(!canRead)return <p className="p-error" role="alert">{tx(language,'forbidden')}</p>;
 if(error)return <section className="p-card sc-card" role="alert"><p>{tx(language,'error')}</p><button className="p-button" onClick={()=>void load()}>{tx(language,'refresh')}</button></section>;
 if(!data)return <div className="sc-skeleton" role="status" aria-busy="true"><span/><span/><span/></div>;
 return <div className="sc-stack" aria-busy={busy}>
  <section className="p-card sc-card">
   <div className="sc-head"><div><h2>{tx(language,'title')}</h2><p className="sc-note">{tx(language,'manage')}</p></div><button className="p-button small" disabled={busy} onClick={()=>void load()}>{tx(language,'refresh')}</button></div>
   <div className="cx-scroll"><table className="cx-table sc-table">
    <thead><tr><th>{tx(language,'core')}</th><th>{tx(language,'status')}</th><th>{tx(language,'enabled')}</th><th>{tx(language,'forcedOn')} / {tx(language,'forcedOff')}</th><th>{tx(language,'plans')}</th><th>{tx(language,'dependencies')}</th><th>{tx(language,'capabilities')}</th></tr></thead>
    <tbody>{data.modules.map(m=><tr key={m.moduleId} data-testid={'row-module-'+m.moduleId}>
     <td><strong>{m.name}</strong><br/><small className="sc-mono">{m.moduleId} · {m.category}</small><br/><small>{m.version??tx(language,'version')}</small></td>
     <td><span className="p-badge sc-pill green">{tx(language,'installed')}</span></td>
     <td>{m.enabledOrganizations}</td><td>{m.forcedEnabled} / {m.forcedDisabled}</td>
     <td>{m.planIncludedBy.length?m.planIncludedBy.map(p=>p.name).join(', '):tx(language,'noPlans')}</td>
     <td>{m.dependencies.length?m.dependencies.join(', '):'—'}</td>
     <td><details><summary>{m.capabilities.length}</summary><ul>{m.capabilities.map(p=><li key={p} className="sc-mono">{p}</li>)}</ul></details></td>
    </tr>)}</tbody>
   </table></div>
   <p className="sc-note">{tx(language,'manage')} {data.management.dependencyConflicts===0?' · '+tx(language,'dependencies')+': 0':''}</p>
  </section>
  <section className="p-card sc-card">
   <h3>{tx(language,'extTitle')}</h3>
   <p>{data.extensions.length?`${data.extensions.length}`:tx(language,'none')}</p>
   <p className="p-info sc-readonly">{tx(language,'policy')}</p>
  </section>
 </div>;
}
