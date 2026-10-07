import {useEffect,useState} from 'react';
import type {Language} from './i18n';
import {installPrompt,listenInstall,clearInstallPrompt} from '../pwa-state';
import {prepareOfflineShell} from '../hayat/offline-shell';
import {request} from './client';
import type {RoleContext} from './types';
export default function PwaInstall({language:l,c}:{language:Language;c:RoleContext}){
 const [prompt,setPrompt]=useState<any>(installPrompt);const [message,setMessage]=useState('');
 const [storage,setStorage]=useState<{mode:string;explicit:boolean;productionReady:boolean}>();
 const brand=c.branding;
 const tx=(ru:string,en:string,hy:string)=>l==='ru'?ru:l==='en'?en:hy;
 useEffect(()=>{let live=true;const stop=listenInstall(setPrompt);if('serviceWorker' in navigator)void prepareOfflineShell().catch(e=>{if(live)setMessage(String(e.message??e))});return()=>{live=false;stop()}},[]);
 useEffect(()=>{let live=true;request<typeof storage>('/storage/status').then(s=>{if(live)setStorage(s)}).catch(e=>{if(live)setMessage(String(e.message??e))});return()=>{live=false}},[]);
 const https=(value:string|null|undefined)=>{try{return value&&new URL(value).protocol==='https:'?value:undefined}catch{return undefined}};
 return <><section className="p-card"><h2>{tx('Установка web-приложения','Install web app','Տեղադրել web հավելվածը')}</h2><p>{tx('Ограниченный PWA: оболочка и статические ресурсы. Финансы, документы и приватные API не кешируются. Синхронизация черновиков техника только вручную.','Limited PWA: shell and static assets only. Financial data, documents and private APIs are not cached. Technician drafts sync only manually.','Սահմանափակ PWA՝ միայն պատյան և ստատիկ ռեսուրսներ։ Ֆինանսները, փաստաթղթերն ու մասնավոր API-ն չեն քեշավորվում։ Սևագրերը համաժամացվում են միայն ձեռքով։')}</p>
 {prompt?<button className="p-button" onClick={async()=>{try{await prompt.prompt();const r=await prompt.userChoice;setMessage(r.outcome==='accepted'?tx('Запрос установки принят','Install request accepted','Տեղադրման հարցումն ընդունված է'):tx('Установка отменена','Install cancelled','Տեղադրումը չեղարկված է'));clearInstallPrompt();setPrompt(undefined)}catch(e:any){setMessage(String(e.message??e))}}}>{tx('Установить','Install','Տեղադրել')}</button>:<p>{tx('Если браузер не предлагает установку, используйте «Добавить на главный экран». В preview установка может быть недоступна.','If not offered by your browser, use Add to Home Screen. Preview may not support installation.','Եթե զննարկիչը չի առաջարկում տեղադրում, օգտագործեք «Ավելացնել գլխավոր էկրանին»։ Preview-ում տեղադրումը կարող է չաշխատել։')}</p>}
 {storage&&<p>{tx('Приватное хранилище: ','Private storage: ','Մասնավոր պահոց՝ ')}<strong>{storage.mode}</strong> · {storage.explicit?tx('режим выбран явно','explicitly selected','ռեժիմը ընտրված է'):tx('сохранён режим по умолчанию; production-настройка ещё не подтверждена','retained default; production selection not confirmed','լռելյայն ռեժիմը՝ production-ը չհաստատված')}</p>}
 {message&&<p role="status">{message}</p>}</section>
 {brand&&Object.values(brand).some(Boolean)&&<section className="p-card">
  <h2>{brand.brand_name||tx('Контакты организации','Organization contacts','Կազմակերպության կոնտակտներ')}</h2>
  {brand.support_email&&<p><a href={'mailto:'+brand.support_email}>{brand.support_email}</a></p>}
  {brand.support_phone&&<p><a href={'tel:'+brand.support_phone}>{brand.support_phone}</a></p>}
  {([['website_url',tx('Сайт','Website','Կայք')],['privacy_url',tx('Конфиденциальность','Privacy','Գաղտնիություն')],['terms_url',tx('Условия','Terms','Պայմաններ')]] as const).map(([key,label])=>https(brand[key])&&<p key={key}><a href={https(brand[key])} target="_blank" rel="noopener noreferrer">{label}</a></p>)}
 </section>}</>
}
