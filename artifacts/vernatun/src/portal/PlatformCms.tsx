import {useEffect,useMemo,useState} from 'react';
import {ArrowUpRight,Globe,Palette,Plus,RefreshCw,Save,Send} from 'lucide-react';
import type {Language} from './i18n';
import {request,ApiClientError} from './client';
import './platform-cms.css';

type Translation={title:string;summary:string;body:string};
type LocalizedContent={hy:Translation;ru:Translation;en:Translation};
type Branding={brandName:string;primaryColor:string;accentColor:string;logoUrl:string|null};
type Page={slug:string;draft:LocalizedContent;published:LocalizedContent|null;version:number;publishedVersion:number|null;updatedAt:string;publishedAt:string|null};
type CmsData={brand:{draft:Branding;published:Branding|null;version:number;publishedVersion:number|null;updatedAt:string;publishedAt:string|null};pages:Page[]};
type CmsLanguage='hy'|'ru'|'en';
const cmsLanguages:CmsLanguage[]=['hy','ru','en'];
const emptyTranslation=():Translation=>({title:'',summary:'',body:''});
const emptyContent=():LocalizedContent=>({hy:emptyTranslation(),ru:emptyTranslation(),en:emptyTranslation()});
const copy={
 hy:{title:'CMS և ապրանքանիշ',subtitle:'Հարթակի հրապարակվող բովանդակություն և ընդհանուր ապրանքանիշ։',brand:'Ապրանքանիշ',pages:'Կայքի էջեր',brandName:'Ապրանքանիշի անվանում',primaryColor:'Հիմնական գույն',accentColor:'Շեշտադրման գույն',logoUrl:'HTTPS լոգոյի հղում',save:'Պահպանել նախագիծը',publish:'Հրապարակել',unpublish:'Դադարեցնել հրապարակումը',newPage:'Նոր էջ',slug:'Էջի հասցե',edit:'Խմբագրել',titleField:'Վերնագիր',summary:'Կարճ նկարագրություն',body:'Բովանդակություն',draft:'Նախագիծ',published:'Հրապարակված',notPublished:'Չի հրապարակվել',preview:'Բացել հրապարակված էջը',draftNote:'Նախագծի փոփոխությունները չեն փոխում ընթացիկ հրապարակված էջը։',publishConfirm:'Հրապարակե՞լ փոփոխությունները։ Պահպանեք նախ նախագիծը։',unpublishConfirm:'Դադարեցնե՞լ այս էջի հրապարակումը։',saved:'Նախագիծը պահպանվել է։',done:'Փոփոխությունը կիրառվել է։',empty:'Դեռ էջեր չկան։ Ստեղծեք առաջին էջը։',reload:'Թարմացնել',error:'Չհաջողվեց պահպանել։ Թարմացրեք էջը և փորձեք կրկին։',versionConflict:'Տվյալները փոխվել են։ Թարմացրեք էջը՝ նոր տարբերակը բեռնելու համար։',auth:'Հրապարակելու համար կրկին մուտք գործեք և փորձեք նորից։',language:'Լեզու',publishedBrand:'Հրապարակված բրենդ',notConfigured:'Բրենդը դեռ հրապարակված չէ։'},
 ru:{title:'CMS и бренд',subtitle:'Публикуемый контент сайта и общий бренд платформы.',brand:'Бренд',pages:'Страницы сайта',brandName:'Название бренда',primaryColor:'Основной цвет',accentColor:'Акцентный цвет',logoUrl:'HTTPS-ссылка на логотип',save:'Сохранить черновик',publish:'Опубликовать',unpublish:'Снять с публикации',newPage:'Новая страница',slug:'Адрес страницы',edit:'Редактировать',titleField:'Заголовок',summary:'Краткое описание',body:'Содержание',draft:'Черновик',published:'Опубликовано',notPublished:'Не опубликовано',preview:'Открыть опубликованную страницу',draftNote:'Правки черновика не заменяют текущую опубликованную страницу.',publishConfirm:'Опубликовать изменения? Сначала сохраните черновик.',unpublishConfirm:'Снять эту страницу с публикации?',saved:'Черновик сохранён.',done:'Изменения применены.',empty:'Страниц пока нет. Создайте первую страницу.',reload:'Обновить',error:'Не удалось сохранить. Обновите страницу и попробуйте ещё раз.',versionConflict:'Данные изменились. Обновите страницу, чтобы загрузить актуальную версию.',auth:'Для публикации войдите заново и повторите действие.',language:'Язык',publishedBrand:'Опубликованный бренд',notConfigured:'Бренд ещё не опубликован.'},
 en:{title:'CMS and brand',subtitle:'Published website content and shared platform branding.',brand:'Brand',pages:'Website pages',brandName:'Brand name',primaryColor:'Primary color',accentColor:'Accent color',logoUrl:'HTTPS logo URL',save:'Save draft',publish:'Publish',unpublish:'Unpublish',newPage:'New page',slug:'Page address',edit:'Edit',titleField:'Title',summary:'Short description',body:'Content',draft:'Draft',published:'Published',notPublished:'Not published',preview:'Open published page',draftNote:'Draft edits do not replace the currently published page.',publishConfirm:'Publish these changes? Save the draft first.',unpublishConfirm:'Unpublish this page?',saved:'Draft saved.',done:'Changes applied.',empty:'There are no pages yet. Create the first page.',reload:'Refresh',error:'Could not save. Refresh the page and try again.',versionConflict:'The data changed. Refresh to load the current version.',auth:'Sign in again before publishing, then retry.',language:'Language',publishedBrand:'Published brand',notConfigured:'The brand has not been published yet.'},
} as const;

export default function PlatformCms({language}:{language:Language}){
 const l=(language==='hy'||language==='en'?language:'ru') as keyof typeof copy,t=copy[l];
 const [tab,setTab]=useState<'brand'|'pages'>('brand');
 const [data,setData]=useState<CmsData>();
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [brand,setBrand]=useState<Branding>({brandName:'Vernatun',primaryColor:'#0b2230',accentColor:'#ff6b0a',logoUrl:null});
 const [selectedSlug,setSelectedSlug]=useState('');
 const [slug,setSlug]=useState('');
 const [content,setContent]=useState<LocalizedContent>(emptyContent);
 const [activeLanguage,setActiveLanguage]=useState<CmsLanguage>(l);
 const selected=useMemo(()=>data?.pages.find(page=>page.slug===selectedSlug),[data,selectedSlug]);

 async function load(){
  setError('');
  try{
   const result=await request<CmsData>('/platform/cms');
   setData(result);
   setBrand(result.brand?.draft??{brandName:'Vernatun',primaryColor:'#0b2230',accentColor:'#ff6b0a',logoUrl:null});
   if(selectedSlug){
    const page=result.pages.find(item=>item.slug===selectedSlug);
    if(page)setContent(page.draft);
   }
  }catch(e){setError(e instanceof ApiClientError&&e.code==='forbidden'?t.error:t.error)}
 }
 useEffect(()=>{void load()},[]);

 function choosePage(page:Page){
  setSelectedSlug(page.slug);setSlug(page.slug);setContent(page.draft);setMessage('');setError('');
 }
 function newPage(){
  setSelectedSlug('');setSlug('');setContent(emptyContent());setMessage('');setError('');
 }
 function setField(locale:CmsLanguage,key:keyof Translation,value:string){
  setContent(current=>({...current,[locale]:{...current[locale],[key]:value}}));
 }
 function explainError(e:unknown){
  if(e instanceof ApiClientError&&e.code==='version_conflict')return t.versionConflict;
  if(e instanceof ApiClientError&&['recent_authentication_required','recent_auth_required','reauthentication_required'].includes(e.code))return t.auth;
  return t.error;
 }
 async function saveBrand(){
  if(!data?.brand)return;
  setBusy(true);setError('');setMessage('');
  try{
   const result=await request<CmsData['brand']>('/platform/cms/brand','PUT',{version:data.brand.version,branding:brand});
   setData(current=>current?{...current,brand:result}:current);setMessage(t.saved);
  }catch(e){setError(explainError(e))}finally{setBusy(false)}
 }
 async function publishBrand(){
  if(!data?.brand||!window.confirm(t.publishConfirm))return;
  setBusy(true);setError('');setMessage('');
  try{
   const result=await request<CmsData['brand']>('/platform/cms/brand/publish','POST',{version:data.brand.version,confirmation:'PUBLISH'});
   setData(current=>current?{...current,brand:result}:current);setMessage(t.done);
  }catch(e){setError(explainError(e))}finally{setBusy(false)}
 }
 async function savePage(){
  if(!slug.trim())return;
  setBusy(true);setError('');setMessage('');
  try{
   const result=await request<Page>('/platform/cms/pages/'+encodeURIComponent(slug.trim()),'PUT',{version:selected?.version??0,content});
   setData(current=>current?{...current,pages:[result,...current.pages.filter(page=>page.slug!==result.slug)]}:current);
   setSelectedSlug(result.slug);setSlug(result.slug);setMessage(t.saved);
  }catch(e){setError(explainError(e))}finally{setBusy(false)}
 }
 async function publishPage(){
  if(!selected||!window.confirm(t.publishConfirm))return;
  setBusy(true);setError('');setMessage('');
  try{
   const result=await request<Page>('/platform/cms/pages/'+encodeURIComponent(selected.slug)+'/publish','POST',{version:selected.version,confirmation:'PUBLISH'});
   setData(current=>current?{...current,pages:current.pages.map(page=>page.slug===result.slug?result:page)}:current);setMessage(t.done);
  }catch(e){setError(explainError(e))}finally{setBusy(false)}
 }
 async function unpublishPage(){
  if(!selected?.publishedVersion||!window.confirm(t.unpublishConfirm))return;
  setBusy(true);setError('');setMessage('');
  try{
   await request('/platform/cms/pages/'+encodeURIComponent(selected.slug)+'/unpublish','POST',{publishedVersion:selected.publishedVersion,confirmation:'UNPUBLISH'});
   await load();setMessage(t.done);
  }catch(e){setError(explainError(e))}finally{setBusy(false)}
 }

 return <section className="p-card platform-cms" data-testid="platform-cms">
  <header className="platform-cms-heading"><div><h2>{t.title}</h2><p>{t.subtitle}</p></div><button type="button" className="p-button small" onClick={()=>void load()} disabled={busy}><RefreshCw size={15}/>{t.reload}</button></header>
  <div className="platform-cms-tabs" role="tablist" aria-label={t.title}>
   <button type="button" role="tab" aria-selected={tab==='brand'} onClick={()=>setTab('brand')}><Palette size={16}/>{t.brand}</button>
   <button type="button" role="tab" aria-selected={tab==='pages'} onClick={()=>setTab('pages')}><Globe size={16}/>{t.pages}</button>
  </div>
  {!data&&!error&&<p role="status">…</p>}
  {error&&<p className="p-error" role="alert">{error}</p>}
  {data&&tab==='brand'&&<div className="platform-cms-brand">
   <div className="platform-cms-fields">
    <label>{t.brandName}<input data-testid="input-cms-brand-name" maxLength={80} value={brand.brandName} onChange={e=>setBrand({...brand,brandName:e.target.value})}/></label>
    <label>{t.primaryColor}<input data-testid="input-cms-primary-color" type="color" value={brand.primaryColor} onChange={e=>setBrand({...brand,primaryColor:e.target.value})}/></label>
    <label>{t.accentColor}<input data-testid="input-cms-accent-color" type="color" value={brand.accentColor} onChange={e=>setBrand({...brand,accentColor:e.target.value})}/></label>
    <label>{t.logoUrl}<input data-testid="input-cms-logo-url" type="url" maxLength={500} placeholder="https://…" value={brand.logoUrl??''} onChange={e=>setBrand({...brand,logoUrl:e.target.value||null})}/></label>
   </div>
   <p className="p-muted-note">{t.draftNote}</p>
   <div className="platform-cms-actions"><button type="button" className="p-button" disabled={busy||!data.brand} onClick={()=>void saveBrand()}><Save size={16}/>{t.save}</button><button type="button" className="p-button orange" disabled={busy||!data.brand} onClick={()=>void publishBrand()}><Send size={16}/>{t.publish}</button></div>
   <div className="platform-cms-published"><strong>{t.publishedBrand}</strong>{data.brand?.published?<><span>{data.brand.published.brandName}</span><code>{data.brand.published.primaryColor} · {data.brand.published.accentColor}</code></>:<span>{t.notConfigured}</span>}</div>
  </div>}
  {data&&tab==='pages'&&<div className="platform-cms-pages">
   <aside className="platform-cms-list" aria-label={t.pages}>
    <button type="button" className="p-button orange" onClick={newPage}><Plus size={16}/>{t.newPage}</button>
    {data.pages.map(page=><button type="button" key={page.slug} className={'platform-cms-page-link '+(selectedSlug===page.slug?'selected':'')} onClick={()=>choosePage(page)}>
     <strong>{page.draft?.[l]?.title||page.slug}</strong><small>{page.slug} · {page.publishedVersion?t.published:t.draft}</small>
    </button>)}
    {!data.pages.length&&<p className="p-muted-note">{t.empty}</p>}
   </aside>
   <div className="platform-cms-editor">
    <label>{t.slug}<input data-testid="input-cms-slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} value={slug} disabled={!!selected} onChange={e=>setSlug(e.target.value.toLowerCase())}/></label>
    <div className="platform-cms-language-tabs" role="tablist" aria-label={t.language}>
     {cmsLanguages.map(code=><button key={code} type="button" role="tab" aria-selected={activeLanguage===code} onClick={()=>setActiveLanguage(code)}>{code.toUpperCase()}</button>)}
    </div>
    <label>{t.titleField}<input data-testid="input-cms-page-title" maxLength={160} value={content[activeLanguage].title} onChange={e=>setField(activeLanguage,'title',e.target.value)}/></label>
    <label>{t.summary}<input data-testid="input-cms-page-summary" maxLength={500} value={content[activeLanguage].summary} onChange={e=>setField(activeLanguage,'summary',e.target.value)}/></label>
    <label>{t.body}<textarea data-testid="input-cms-page-body" rows={10} maxLength={30000} value={content[activeLanguage].body} onChange={e=>setField(activeLanguage,'body',e.target.value)}/></label>
    <p className="p-muted-note">{t.draftNote}</p>
    {selected?.publishedVersion&&<a className="p-button small" href={'/'+selected.slug} target="_blank" rel="noreferrer"><ArrowUpRight size={15}/>{t.preview}</a>}
    <div className="platform-cms-actions"><button type="button" className="p-button" disabled={busy||!slug.trim()} onClick={()=>void savePage()}><Save size={16}/>{t.save}</button><button type="button" className="p-button orange" disabled={busy||!selected} onClick={()=>void publishPage()}><Send size={16}/>{t.publish}</button>{selected?.publishedVersion&&<button type="button" className="p-button danger" disabled={busy} onClick={()=>void unpublishPage()}>{t.unpublish}</button>}</div>
   </div>
  </div>}
  {message&&<p className="p-success" role="status">{message}</p>}
 </section>;
}
