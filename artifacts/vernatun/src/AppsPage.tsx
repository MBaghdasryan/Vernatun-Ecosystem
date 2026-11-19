import {useEffect,useState,type CSSProperties} from 'react';
import QRCode from 'qrcode';
import {ArrowDown,Check,Copy,Download,FileCheck2,Home,Link2,Settings,ShieldCheck,Share2,Smartphone,Users} from 'lucide-react';
import {e} from './ecosystem-content';
import {landingLanguage} from './landing-i18n';
import {Logo} from './components/Shared';
import SiteFooter from './components/SiteFooter';
import './apps.css';

const PAGE_URL='https://vernatun.io/apps';

type AppInfo={id:'imtun'|'hayat';name:string;logo:string;subtitle:string;description:string;audience:string;href:string;file:string;bytes:number;sha:string;points:string[]};

const apps:AppInfo[]=[
 {id:'imtun',name:'ImTun',logo:'/assets/imtun-original.png',
  subtitle:e('Приложение для жителей','Բնակչի հավելված','Resident Mobile App'),
  description:e('Ваш дом в кармане. Оставайтесь на связи со своим зданием и его управляющей командой.','Ձեր բնակելի համայնքը՝ գրպանում։ Կապի մեջ մնացեք ձեր շենքի և դրա կառավարման ծառայությունների հետ։','Your residential community in your pocket. Stay connected with your building and its management services.'),
  audience:e('Для жителей и их семей','Բնակիչների և նրանց ընտանիքների համար','For residents and their families'),
  href:'/downloads/ImTun_app_by_Vernatun.apk',file:'ImTun_app_by_Vernatun.apk',bytes:170809631,
  sha:'25cce6fd3c0649878a0a39d4c85fa267f509af787d3f2aefb2d3fd8b02d85f30',
  points:[e('Обращения и их статус','Դիմումներ և դրանց կարգավիճակը','Requests and their status'),e('Новости и объявления дома','Շենքի նորություններ և հայտարարություններ','Building news and notices'),e('Связь с управляющей командой','Կապ կառավարման թիմի հետ','A line to your building team')]},
 {id:'hayat',name:'HAYAT',logo:'/assets/hayat-original.png',
  subtitle:e('Приложение для управления недвижимостью','Գույքի կառավարման հավելված','Property Management App'),
  description:e('Мобильное рабочее пространство для команд управления, поддерживающее ежедневную работу здания.','Շարժական աշխատանքային տարածք գույքի կառավարման թիմերի համար՝ շենքի ամենօրյա աշխատանքի աջակցությամբ։','A mobile workspace for property management teams, supporting day-to-day building operations.'),
  audience:e('Для управляющих, диспетчеров и техников','Կառավարիչների, դիսպետչերների և տեխնիկների համար','For managers, dispatchers and technicians'),
  href:'/downloads/Hayat_app_by_Vernatun.apk',file:'Hayat_app_by_Vernatun.apk',bytes:143326838,
  sha:'d0b2b51f4c657fbfb6fea2b6d3c25a579bdf9390c2bc24f63e9a9e0c0fda54da',
  points:[e('Задачи с ответственным и сроком','Առաջադրանքներ՝ պատասխանատուով և ժամկետով','Tasks with an owner and a deadline'),e('Фотоотчёты прямо с объекта','Լուսանկարային հաշվետվություն՝ տեղից','Photo reports straight from site'),e('Чек-листы обслуживания','Սպասարկման ստուգաթերթեր','Maintenance checklists')]}
];

const formatSize=(b:number)=>{const mb=b/1_000_000;return new Intl.NumberFormat(landingLanguage==='hy'?'hy-AM':landingLanguage,{maximumFractionDigits:1}).format(mb)+' '+e('МБ','ՄԲ','MB')};

function useReveal(){
 useEffect(()=>{
  const els=document.querySelectorAll('.apps-page [data-reveal]');
  if(!('IntersectionObserver' in window)){els.forEach(el=>el.classList.add('is-in'));return}
  const io=new IntersectionObserver(entries=>entries.forEach(en=>{if(en.isIntersecting){en.target.classList.add('is-in');io.unobserve(en.target)}}),{rootMargin:'0px 0px -8% 0px'});
  els.forEach(el=>io.observe(el));return()=>io.disconnect();
 },[]);
}

async function copyText(text:string){
 try{await navigator.clipboard.writeText(text);return true}catch{
  const t=document.createElement('textarea');t.value=text;t.setAttribute('readonly','');t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.select();
  const ok=document.execCommand('copy');t.remove();return ok;
 }
}

function CopyButton({text,label,done}:{text:string;label:string;done:string}){
 const [state,setState]=useState<'idle'|'ok'|'err'>('idle');
 useEffect(()=>{if(state==='idle')return;const t=setTimeout(()=>setState('idle'),2200);return()=>clearTimeout(t)},[state]);
 return <button type="button" className="apps-copy" onClick={async()=>setState(await copyText(text)?'ok':'err')} aria-label={label}>
  {state==='ok'?<Check size={15}/>:<Copy size={15}/>}<span aria-live="polite">{state==='ok'?done:state==='err'?e('Не удалось','Չհաջողվեց','Failed'):e('Копировать','Պատճենել','Copy')}</span>
 </button>;
}

function AndroidGlyph(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M17.6 9.48l1.84-3.18a.38.38 0 0 0-.66-.38l-1.86 3.22a11.4 11.4 0 0 0-9.84 0L5.22 5.92a.38.38 0 0 0-.66.38L6.4 9.48A10.8 10.8 0 0 0 1 18h22a10.8 10.8 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z"/></svg>}

function AppCard({app,index}:{app:AppInfo;index:number}){
 const titleId=`app-${app.id}-title`;
 return <article className={'apps-card apps-card-'+app.id} aria-labelledby={titleId} data-reveal style={{'--d':`${index*120}ms`} as CSSProperties}>
  <div className="apps-card-top">
   <div className="apps-card-logo"><img src={app.logo} width="1774" height="887" alt={app.name+' by Vernatun'}/></div>
   <span className="apps-beta"><AndroidGlyph/>Android Beta</span>
  </div>
  <p className="apps-card-audience">{app.audience}</p>
  <h3 id={titleId}>{app.name}<span>{app.subtitle}</span></h3>
  <p className="apps-card-desc">{app.description}</p>
  <ul className="apps-card-points">{app.points.map(p=><li key={p}><Check size={15} aria-hidden="true"/>{p}</li>)}</ul>
  <a className="apps-download" href={app.href} download={app.file} type="application/vnd.android.package-archive">
   <span className="apps-download-icon"><Download size={20} aria-hidden="true"/></span>
   <span className="apps-download-text"><strong>{e('Скачать для Android','Ներբեռնել Android-ի համար','Download for Android')}</strong><small>APK · {formatSize(app.bytes)}</small></span>
  </a>
  <dl className="apps-meta">
   <div><dt>{e('Платформа','Հարթակ','Platform')}</dt><dd>Android</dd></div>
   <div><dt>{e('Формат','Ձևաչափ','Format')}</dt><dd>APK</dd></div>
   <div><dt>{e('Размер','Չափ','Size')}</dt><dd>{formatSize(app.bytes)}</dd></div>
   <div><dt>{e('Версия','Տարբերակ','Version')}</dt><dd className="apps-muted">{e('Уточняется','Ճշտվում է','Being confirmed')}</dd></div>
  </dl>
  <details className="apps-integrity">
   <summary><FileCheck2 size={16} aria-hidden="true"/>{e('Контрольная сумма SHA-256','SHA-256 ստուգիչ գումար','SHA-256 checksum')}</summary>
   <p className="apps-file">{app.file}</p>
   <code className="apps-hash">{app.sha}</code>
   <CopyButton text={app.sha} label={e('Копировать SHA-256 ','Պատճենել SHA-256 ','Copy SHA-256 for ')+app.name} done={e('Скопировано','Պատճենված է','Copied')}/>
  </details>
 </article>;
}

function QrBlock(){
 const [svg,setSvg]=useState<string|null>(null);const [failed,setFailed]=useState(false);
 useEffect(()=>{let live=true;QRCode.toString(PAGE_URL,{type:'svg',errorCorrectionLevel:'M',margin:0,color:{dark:'#0b2230',light:'#00000000'}}).then(s=>{if(live)setSvg(s)}).catch(()=>{if(live)setFailed(true)});return()=>{live=false}},[]);
 return <div className="apps-qr" role="img" aria-label={e('QR-код страницы vernatun.io/apps','vernatun.io/apps էջի QR կոդ','QR code for vernatun.io/apps')}>
  {svg?<div className="apps-qr-svg" dangerouslySetInnerHTML={{__html:svg}}/>:failed?<p className="apps-qr-fail">vernatun.io/apps</p>:<div className="apps-qr-skeleton" aria-hidden="true"/>}
  <span className="apps-qr-corner tl"/><span className="apps-qr-corner tr"/><span className="apps-qr-corner bl"/><span className="apps-qr-corner br"/>
 </div>;
}

function ShareButton(){
 const [msg,setMsg]=useState('');
 const canShare=typeof navigator!=='undefined'&&'share' in navigator;
 const onShare=async()=>{
  const data={title:'Vernatun Apps',text:e('Приложения Vernatun для нашего дома','Vernatun-ի հավելվածները մեր շենքի համար','Vernatun apps for our building'),url:PAGE_URL};
  if(canShare){try{await navigator.share(data);return}catch(err){if((err as Error).name==='AbortError')return}}
  setMsg(await copyText(PAGE_URL)?e('Ссылка скопирована','Հղումը պատճենված է','Link copied'):e('Скопируйте адрес вручную','Պատճենեք հասցեն ձեռքով','Copy the address manually'));
  setTimeout(()=>setMsg(''),2400);
 };
 return <div className="apps-share-row">
  <button type="button" className="apps-share" onClick={onShare}>{canShare?<Share2 size={17}/>:<Link2 size={17}/>}{e('Поделиться с семьёй','Կիսվել ընտանիքի հետ','Share with family')}</button>
  <span className="apps-share-msg" aria-live="polite">{msg}</span>
 </div>;
}

function LanguageSwitch(){
 const langs:[string,string][]=[['hy','ՀԱՅ'],['en','ENG'],['ru','РУС']];
 return <div className="apps-lang" role="group" aria-label={e('Язык','Լեզու','Language')}>
  {langs.map(([code,label])=><button key={code} type="button" aria-pressed={landingLanguage===code} lang={code} onClick={()=>{if(landingLanguage===code)return;localStorage.setItem('vernatun.language',code);location.reload()}}>{label}</button>)}
 </div>;
}

export default function AppsPage(){
 useReveal();
 useEffect(()=>{
  document.documentElement.lang=landingLanguage;
  const title='Vernatun Apps — Download ImTun & HAYAT';
  const description='Download the official Android applications of the Vernatun Smart Living Ecosystem. ImTun for residents and HAYAT for property management teams.';
  document.title=title;
  const setMeta=(attribute:string,key:string,value:string)=>{
   let node=document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
   if(!node){node=document.createElement('meta');node.setAttribute(attribute,key);document.head.appendChild(node)}
   node.content=value;
  };
  setMeta('name','description',description);
  setMeta('property','og:title',title);
  setMeta('property','og:description',description);
  setMeta('property','og:type','website');
  setMeta('property','og:url',PAGE_URL);
  setMeta('property','og:image','https://vernatun.io/assets/vernatun-original.png');
  let canonical=document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if(!canonical){canonical=document.createElement('link');canonical.rel='canonical';document.head.appendChild(canonical)}
  canonical.href=PAGE_URL;
 },[]);
 const steps=[
  {icon:Download,title:e('Скачайте APK','Ներբեռնեք APK-ն','Download the APK'),text:e('Нажмите «Скачать для Android» на телефоне и дождитесь окончания загрузки.','Հեռախոսով սեղմեք «Ներբեռնել Android-ի համար» և սպասեք ներբեռնման ավարտին։','Tap “Download for Android” on your phone and let the download finish.')},
  {icon:Settings,title:e('Разрешите установку','Թույլատրեք տեղադրումը','Allow installation'),text:e('Если Android спросит, разрешите установку из браузера, через который вы скачали файл.','Եթե Android-ը հարցնի, թույլատրեք տեղադրումը այն դիտարկիչից, որով ներբեռնել եք ֆայլը։','If Android asks, allow installs from the browser you downloaded the file with.')},
  {icon:Smartphone,title:e('Откройте файл','Բացեք ֆայլը','Open the file'),text:e('Откройте загруженный файл из уведомления или папки «Загрузки» и нажмите «Установить».','Բացեք ներբեռնված ֆայլը ծանուցումից կամ «Ներբեռնումներ» թղթապանակից և սեղմեք «Տեղադրել»։','Open the file from the notification or Downloads folder and tap “Install”.')},
  {icon:Home,title:e('Войдите в приложение','Մուտք գործեք հավելված','Sign in'),text:e('Используйте данные доступа, которые выдала ваша управляющая организация.','Օգտագործեք ձեր կառավարման կազմակերպության տրամադրած մուտքի տվյալները։','Use the access details provided by your building’s management organization.')}
 ];
 const faqs=[
  [e('Это официальные приложения?','Սրանք պաշտոնական հավելվածնե՞ր են։','Are these the official apps?'),e('Да. Это единственная официальная страница загрузки приложений Vernatun. Скачивайте APK только с vernatun.io — не из пересланных файлов и сторонних сайтов.','Այո։ Սա Vernatun հավելվածների միակ պաշտոնական ներբեռնման էջն է։ Ներբեռնեք APK-ն միայն vernatun.io-ից՝ ոչ թե փոխանցված ֆայլերից կամ այլ կայքերից։','Yes. This is the only official download page for Vernatun apps. Download APKs only from vernatun.io — not from forwarded files or third-party sites.')],
  [e('Почему Android предупреждает об установке?','Ինչու՞ է Android-ը զգուշացնում տեղադրման մասին։','Why does Android show a warning?'),e('Так Android реагирует на любое приложение, установленное не из Google Play. Пока приложения в бета-версии, мы распространяем их напрямую с этой страницы.','Android-ն այդպես է արձագանքում Google Play-ից դուրս տեղադրվող ցանկացած հավելվածի։ Քանի դեռ հավելվածները բետա փուլում են, մենք դրանք տարածում ենք անմիջապես այս էջից։','Android does this for any app installed outside Google Play. While the apps are in beta, we distribute them directly from this page.')],
  [e('Как проверить, что файл не изменён?','Ինչպե՞ս ստուգել, որ ֆայլը փոփոխված չէ։','How can I check the file is genuine?'),e('Сравните SHA-256 загруженного файла с контрольной суммой в карточке приложения. Если значения совпадают — это тот самый файл, который мы опубликовали.','Համեմատեք ներբեռնված ֆայլի SHA-256-ը հավելվածի քարտում նշված ստուգիչ գումարի հետ։ Եթե արժեքները համընկնում են, դա հենց մեր հրապարակած ֆայլն է։','Compare the downloaded file’s SHA-256 with the checksum on the app card. If they match, it is exactly the file we published.')],
  [e('Есть ли версия для iPhone?','Կա՞ արդյոք տարբերակ iPhone-ի համար։','Is there an iPhone version?'),e('Пока доступны только Android-версии. Когда появятся другие платформы, они будут опубликованы на этой же странице.','Այս պահին հասանելի են միայն Android տարբերակները։ Այլ հարթակների տարբերակները կհրապարակվեն այս նույն էջում։','Only Android versions are available for now. Other platforms will be published on this same page.')],
  [e('Как получить обновления?','Ինչպե՞ս ստանալ թարմացումները։','How do I get updates?'),e('Новые версии всегда публикуются по тем же адресам. Вернитесь на vernatun.io/apps, скачайте файл заново и установите поверх текущей версии.','Նոր տարբերակները միշտ հրապարակվում են նույն հասցեներով։ Վերադարձեք vernatun.io/apps, կրկին ներբեռնեք ֆայլը և տեղադրեք ընթացիկ տարբերակի վրա։','New versions are always published at the same addresses. Return to vernatun.io/apps, download again and install over the current version.')]
 ];
 return <div className="apps-page">
  <a className="skip-link" href="#apps-main">{e('Перейти к загрузке','Անցնել ներբեռնմանը','Skip to downloads')}</a>
  <header className="apps-header">
   <div className="container apps-header-inner">
    <Logo href="/"/>
    <nav aria-label={e('Навигация','Նավիգացիա','Navigation')} className="apps-header-nav">
     <a href="#apps-download">{e('Скачать','Ներբեռնել','Download')}</a>
     <a href="#apps-install">{e('Установка','Տեղադրում','Install')}</a>
     <a href="#apps-faq">{e('Вопросы','Հարցեր','FAQ')}</a>
    </nav>
    <LanguageSwitch/>
   </div>
  </header>
  <main id="apps-main">
   <section className="apps-hero">
    <div className="apps-hero-arches" aria-hidden="true"><span/><span/><span/><span/><span/></div>
    <div className="container apps-hero-layout">
     <div className="apps-hero-copy">
      <p className="apps-pill" data-reveal><span className="apps-pill-dot"/>{e('Android-приложения · Бета-доступ','Android հավելվածներ · Բետա հասանելիություն','Android Apps · Beta Access')}</p>
      <h1 data-reveal style={{'--d':'80ms'} as CSSProperties}>Vernatun Apps</h1>
      <p className="apps-hero-sub" data-reveal style={{'--d':'160ms'} as CSSProperties}>{e('Умная жизнь. Сплочённые сообщества.','Խելացի կյանք։ Կապված համայնքներ։','Smart Living. Connected Communities.')}</p>
      <p className="apps-hero-desc" data-reveal style={{'--d':'240ms'} as CSSProperties}>{e('Мобильные приложения экосистемы Vernatun: ImTun — для жителей, HAYAT — для команд, которые заботятся о доме.','Vernatun էկոհամակարգի շարժական հավելվածները՝ ImTun՝ բնակիչների համար, HAYAT՝ տունը խնամող թիմերի համար։','Mobile apps from the Vernatun Smart Living Ecosystem: ImTun for residents, HAYAT for the teams who look after the building.')}</p>
      <div className="apps-hero-actions" data-reveal style={{'--d':'320ms'} as CSSProperties}>
       <a className="apps-btn-primary" href="#apps-download">{e('Выбрать приложение','Ընտրել հավելվածը','Choose your app')}<ArrowDown size={18} aria-hidden="true"/></a>
       <span className="apps-trust"><ShieldCheck size={17} aria-hidden="true"/>{e('Официальный источник · без регистрации','Պաշտոնական աղբյուր · առանց գրանցման','Official source · no sign-up needed')}</span>
      </div>
     </div>
     <div className="apps-hero-visual" data-reveal style={{'--d':'200ms'} as CSSProperties} aria-hidden="true">
      <div className="apps-orbit">
       <div className="apps-orbit-ring"/>
       <div className="apps-orbit-center"><img src="/assets/vernatun-original.png" alt="" width="1024" height="1024"/></div>
       <div className="apps-chip apps-chip-imtun"><img src="/assets/imtun-original.png" alt="" width="1774" height="887"/><small>{e('Жители','Բնակիչներ','Residents')}</small></div>
       <div className="apps-chip apps-chip-hayat"><img src="/assets/hayat-original.png" alt="" width="1774" height="887"/><small>{e('Команды','Թիմեր','Teams')}</small></div>
      </div>
     </div>
    </div>
   </section>

   <section id="apps-download" className="apps-section apps-download-section" aria-labelledby="apps-download-title">
    <div className="container">
     <div className="apps-section-head" data-reveal>
      <p className="eyebrow">{e('Два приложения — один дом','Երկու հավելված՝ մեկ տուն','Two apps, one home')}</p>
      <h2 id="apps-download-title">{e('Выберите своё приложение','Ընտրեք ձեր հավելվածը','Pick the app that’s yours')}</h2>
     </div>
     <div className="apps-grid">{apps.map((a,i)=><AppCard key={a.id} app={a} index={i}/>)}</div>
     <p className="apps-disclaimer">{e('Бета-версия. Некоторые функции могут измениться.','Բետա տարբերակ։ Որոշ գործառույթներ կարող են փոխվել։','Beta software. Some features may change.')}</p>
     <div className="apps-coming" aria-label={e('Будущие платформы','Ապագա հարթակներ','Coming platforms')}>
      <p className="apps-coming-label">{e('Скоро','Շուտով','Coming soon')}</p>
      <div className="apps-coming-item"><Smartphone size={19} aria-hidden="true"/><span>{e('Версия для iOS','iOS տարբերակ','iOS version')}</span><strong>{e('Скоро','Շուտով','Coming Soon')}</strong></div>
      <span className="apps-coming-divider" aria-hidden="true"/>
      <div className="apps-coming-item"><AndroidGlyph/><span>{e('Публикация в Google Play','Google Play-ում տարածում','Google Play distribution')}</span><strong>{e('Скоро','Շուտով','Coming Soon')}</strong></div>
     </div>
    </div>
   </section>

   <section className="apps-bridge" aria-label={e('Как связаны приложения','Ինչպես են կապված հավելվածները','How the apps connect')}>
    <div className="container apps-bridge-inner" data-reveal>
     <div><Users size={22} aria-hidden="true"/><p><strong>ImTun</strong> {e('— житель сообщает о проблеме','— բնակիչը հայտնում է խնդրի մասին','— a resident reports an issue')}</p></div>
     <span className="apps-bridge-line" aria-hidden="true"/>
     <div><Settings size={22} aria-hidden="true"/><p><strong>HAYAT</strong> {e('— команда берёт её в работу','— թիմը վերցնում է այն աշխատանքի','— the team picks it up')}</p></div>
     <span className="apps-bridge-line" aria-hidden="true"/>
     <div><Check size={22} aria-hidden="true"/><p>{e('Житель видит результат','Բնակիչը տեսնում է արդյունքը','The resident sees it resolved')}</p></div>
    </div>
   </section>

   <section id="apps-install" className="apps-section apps-install" aria-labelledby="apps-install-title">
    <div className="container">
     <div className="apps-section-head" data-reveal>
      <p className="eyebrow">{e('Установка за пару минут','Տեղադրում՝ մի քանի րոպեում','Installed in a couple of minutes')}</p>
      <h2 id="apps-install-title">{e('Четыре простых шага','Չորս պարզ քայլ','Four simple steps')}</h2>
     </div>
     <ol className="apps-steps">{steps.map((s,i)=>{const Icon=s.icon;return <li key={s.title} data-reveal style={{'--d':`${i*90}ms`} as CSSProperties}><span className="apps-step-num">{String(i+1).padStart(2,'0')}</span><Icon size={22} aria-hidden="true"/><h3>{s.title}</h3><p>{s.text}</p></li>})}</ol>
    </div>
   </section>

   <section className="apps-section apps-share-section" aria-labelledby="apps-share-title">
    <div className="container apps-share-card" data-reveal>
     <div className="apps-share-copy">
      <p className="eyebrow">{e('Для родных и соседей','Հարազատների և հարևանների համար','For family and neighbours')}</p>
      <h2 id="apps-share-title">{e('Наведите камеру — и откроется эта страница','Ուղղեք տեսախցիկը, և կբացվի այս էջը','Point a camera, and this page opens')}</h2>
      <p>{e('Покажите код родителям или соседям — им не придётся набирать адрес. Ссылка постоянная: по ней всегда будет актуальная версия.','Ցույց տվեք կոդը ծնողներին կամ հարևաններին՝ նրանք ստիպված չեն լինի հասցե մուտքագրել։ Հղումը մշտական է՝ այստեղ միշտ կլինի ամենաթարմ տարբերակը։','Show the code to parents or neighbours so nobody has to type an address. The link is permanent — it always leads to the latest version.')}</p>
      <div className="apps-url"><code>vernatun.io/apps</code><CopyButton text={PAGE_URL} label={e('Копировать ссылку','Պատճենել հղումը','Copy link')} done={e('Скопировано','Պատճենված է','Copied')}/></div>
      <ShareButton/>
      <p className="apps-security"><ShieldCheck size={18} aria-hidden="true"/><span>{e('Устанавливайте APK-файлы только с официального сайта Vernatun. Android может показывать дополнительные предупреждения безопасности для приложений, распространяемых вне Google Play.','Տեղադրեք APK ֆայլեր միայն Vernatun-ի պաշտոնական կայքից։ Google Play-ից դուրս տարածվող հավելվածների դեպքում Android-ը կարող է ցուցադրել անվտանգության լրացուցիչ նախազգուշացումներ։','Only install APK files downloaded from official Vernatun website. Android may display additional security prompts for applications distributed outside Google Play.')}</span></p>
     </div>
     <QrBlock/>
    </div>
   </section>

   <section id="apps-faq" className="apps-section apps-faq" aria-labelledby="apps-faq-title">
    <div className="container apps-faq-layout">
     <div data-reveal><p className="eyebrow">{e('Спокойствие прежде всего','Հանգստություն՝ ամենից առաջ','Peace of mind first')}</p><h2 id="apps-faq-title">{e('Частые вопросы','Հաճախ տրվող հարցեր','Common questions')}</h2></div>
     <div className="apps-faq-list">{faqs.map(([q,a])=><details key={q} data-reveal><summary>{q}<span aria-hidden="true" className="apps-faq-plus"/></summary><p>{a}</p></details>)}</div>
    </div>
   </section>
  </main>
  <SiteFooter homePrefix="/"/>
 </div>;
}
