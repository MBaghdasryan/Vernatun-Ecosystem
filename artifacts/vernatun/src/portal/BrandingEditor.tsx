import {useEffect,useState,type FormEvent} from 'react';
import {request,uploadBrandingLogo} from './client';
import type {RoleContext} from './types';
import type {Language} from './i18n';
import PortfolioObjects from './PortfolioObjects';
type Brand={version:number;branding:Record<string,string|null>;canManage:boolean};
const keys=['brand_name','primary_color','accent_color','support_email','support_phone','website_url','privacy_url','terms_url'] as const;
const names:Record<string,[string,string,string]>={brand_name:['Название бренда','Brand name','Բրենդի անուն'],primary_color:['Основной цвет','Primary color','Հիմնական գույն'],accent_color:['Акцентный цвет','Accent color','Շեշտադրող գույն'],support_email:['Email поддержки','Support email','Աջակցության email'],support_phone:['Телефон поддержки','Support phone','Աջակցության հեռախոս'],website_url:['Сайт HTTPS','Website HTTPS','Կայք HTTPS'],privacy_url:['Конфиденциальность HTTPS','Privacy HTTPS','Գաղտնիություն HTTPS'],terms_url:['Условия HTTPS','Terms HTTPS','Պայմաններ HTTPS']};
export default function BrandingEditor({c,language:l}:{c:RoleContext;language:Language}){
 const tx=(ru:string,en:string,hy:string)=>l==='ru'?ru:l==='en'?en:hy;
 const [d,setD]=useState<Brand>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[file,setFile]=useState<File>(),[maintenance,setMaintenance]=useState<string>();
 useEffect(()=>{let alive=true;request<Brand>('/organization/branding').then(v=>{if(alive)setD(v)}).catch(e=>{if(alive)setError(String(e.message??e))});return()=>{alive=false}},[c.id]);
 async function action(fn:()=>Promise<Brand>){if(busy)return;setBusy(true);setError('');try{setD(await fn());location.reload()}catch(e:any){setError(String(e.message??e))}finally{setBusy(false)}}
 function save(e:FormEvent){e.preventDefault();if(!d)return;const branding=Object.fromEntries(keys.map(k=>[k,d.branding[k]||null]));void action(()=>request<Brand>('/organization/branding','PUT',{version:d.version,branding}))}
 return <><section className="p-card"><h2>{tx('Брендинг организации','Organization branding','Կազմակերպության բրենդինգ')}</h2>
 <p>{tx('Пустые поля сохраняют исходный бренд продукта. После сохранения интерфейс перезагрузится. Изменения не меняют права доступа.','Empty fields retain the original product brand. Saving reloads the interface and does not change access rights.','Դատարկ դաշտերը պահպանում են սկզբնական բրենդը։ Պահպանումից հետո էջը վերբեռնվում է՝ առանց իրավունքները փոխելու։')}</p>
 {error&&<p className="p-error" role="alert">{error}</p>}{!d&&!error?<p role="status">{tx('Загрузка…','Loading…','Բեռնվում է…')}</p>:d&&d.canManage&&<>
 <form className="p-edit-form" onSubmit={save}><fieldset disabled={busy} style={{border:0,padding:0}}>{keys.map(k=><label key={k}>{names[k][l==='ru'?0:l==='en'?1:2]}<input value={d.branding[k]??''} maxLength={k==='brand_name'?80:500} type={k.endsWith('_url')?'url':k==='support_email'?'email':'text'} placeholder={k.endsWith('_color')?'#FF6B0A':''} onChange={e=>setD({...d,branding:{...d.branding,[k]:e.target.value}})}/></label>)}<button className="p-button orange">{tx('Сохранить и перезагрузить','Save and reload','Պահպանել և վերբեռնել')}</button></fieldset></form>
 <hr/><p>{tx('Логотип: PNG/JPEG/WebP, до 2 МБ. SVG/HTML запрещены. Удаление снимает ссылку, не удаляя байты из хранилища.','Logo: PNG/JPEG/WebP, up to 2 MB. No SVG/HTML. Removing clears the reference, not stored bytes.','Լոգոտիպ՝ PNG/JPEG/WebP, մինչև 2 ՄԲ։ SVG/HTML չի թույլատրվում։ Հեռացնելը չի ջնջում պահված ֆայլը։')}</p>
 <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{setError('');const f=e.target.files?.[0];if(f&&f.size>2*1024*1024){setError(tx('Файл больше 2 МБ','File exceeds 2 MB','Ֆայլը գերազանցում է 2 ՄԲ'));return}setFile(f)}}/>
 <button className="p-button" disabled={!file||busy} onClick={()=>{if(file)void action(()=>uploadBrandingLogo(d.version,file))}}>{tx('Загрузить и перезагрузить','Upload and reload','Վերբեռնել ֆայլը և էջը')}</button>
 {d.branding.logo_key&&<button className="p-button" disabled={busy} onClick={()=>{if(confirm(tx('Снять логотип организации? Исходные файлы останутся в хранилище.','Remove organization logo reference? Stored bytes remain.','Հեռացնե՞լ լոգոտիպի հղումը։ Ֆայլը պահպանվում է։')))void action(()=>request<Brand>('/organization/branding/logo?version='+d.version,'DELETE'))}}>{tx('Снять логотип','Remove logo','Հեռացնել լոգոտիպը')}</button>}
 </>}</section>
 <section className="p-card">
  <h2>{tx('Напоминания по срокам','Due reminders','Ժամկետների հիշեցումներ')}</h2>
  <p>{tx('Ручная, повторяемая проверка пропусков, аренды, голосований и задач внедрения. Письма не отправляются. Производственный планировщик не настроен.','Manual idempotent examination of passes, leases, votes and onboarding deadlines. No email sends. Production scheduling is not configured.','Ձեռքով ստուգում՝ անցագրերի, վարձակալության, քվեարկության և ներդրման ժամկետների համար։ Նամակներ չեն ուղարկվում։')}</p>
  <button className="p-button" disabled={busy} onClick={async()=>{
   setBusy(true);setError('');
   try{
    const r=await request<{examinedDueRecords:number}>('/notifications/due','POST',{});
    setMaintenance(tx('Проверено записей: ','Records examined: ','Ստուգված գրառումներ՝ ')+r.examinedDueRecords);
   }catch(e:any){setError(String(e.message??e))}
   finally{setBusy(false)}
  }}>{tx('Проверить сроки','Examine deadlines','Ստուգել ժամկետները')}</button>
  {maintenance&&<p role="status">{maintenance}</p>}
 </section>
 {c.permissions.includes('properties.read')&&<PortfolioObjects c={c} language={l}/>}
 </>
}
