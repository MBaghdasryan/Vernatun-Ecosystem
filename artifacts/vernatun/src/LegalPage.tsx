import {useEffect,useState} from 'react';
import {e} from './ecosystem-content';
import {landingLanguage} from './landing-i18n';
import {Logo} from './components/Shared';
import SiteFooter from './components/SiteFooter';
import {apiUrl} from './api-base';
import './legal.css';

type LegalKind='privacy'|'terms';
type LegalSection={title:string;paragraphs:string[];items?:string[]};
type PublishedLegalText={title:string;summary:string;body:string};

function meta(name:string,content:string,property=false){
 const selector=property?`meta[property="${name}"]`:`meta[name="${name}"]`;
 let tag=document.head.querySelector<HTMLMetaElement>(selector);
 if(!tag){tag=document.createElement('meta');if(property)tag.setAttribute('property',name);else tag.name=name;document.head.appendChild(tag)}
 tag.content=content;
}

const documents:Record<LegalKind,{title:string;description:string;intro:string;sections:LegalSection[];notice:string}>={
 privacy:{
  title:e('Политика конфиденциальности','Գաղտնիության քաղաքականություն','Privacy policy'),
  description:e('Черновик политики конфиденциальности Vernatun: какие данные могут обрабатываться для управления домом и предоставления сервисов жителям.','Vernatun-ի գաղտնիության քաղաքականության նախագիծը․ ինչ տվյալներ կարող են մշակվել շենքի կառավարման և բնակիչների ծառայությունների համար։','Draft Vernatun privacy policy explaining the information that may be processed to manage buildings and provide resident services.'),
  intro:e('В этой политике описано, как Vernatun может обрабатывать данные при использовании сайта и связанных сервисов управления недвижимостью. Текст является рабочим черновиком и требует проверки перед официальной публикацией.','Այս քաղաքականությունը նկարագրում է, թե ինչպես Vernatun-ը կարող է մշակել տվյալները կայքից և անշարժ գույքի կառավարման ծառայություններից օգտվելիս։ Տեքստը աշխատանքային նախագիծ է և պաշտոնական հրապարակումից առաջ պետք է վերանայվի։','This draft describes how Vernatun may process information when people use this website and related property-management services. It must be reviewed before official publication.'),
  notice:e('Черновик для согласования. До окончательной публикации необходимо указать юридическое наименование оператора, адрес, контакт для обращений, сроки хранения и применимые правовые основания.','Համաձայնեցման նախագիծ է։ Վերջնական հրապարակումից առաջ պետք է նշել տվյալների օպերատորի իրավաբանական անվանումը, հասցեն, դիմումների կապը, պահպանման ժամկետները և կիրառելի իրավական հիմքերը։','Draft for review. Before final publication, add the data controller’s legal name, address, contact details, retention periods, and applicable legal bases.'),
  sections:[
   {title:e('1. Кто отвечает за данные','1. Ով է պատասխանատու տվյալների համար','1. Who is responsible for data'),paragraphs:[
    e('Оператор сайта и сервисов будет указан в окончательной редакции этой политики. В зависимости от подключённого дома отдельные сведения об объекте и обращениях могут обрабатываться совместно с управляющей организацией, обслуживающей этот дом.','Կայքի և ծառայությունների օպերատորը կնշվի այս քաղաքականության վերջնական տարբերակում։ Կախված միացված շենքից՝ օբյեկտի և դիմումների մասին որոշ տվյալներ կարող են մշակվել այդ շենքը սպասարկող կառավարման կազմակերպության հետ։','The website and service operator will be identified in the final policy. Depending on the connected building, certain property and service-request information may also be handled with the organization managing that building.')
   ]},
   {title:e('2. Какие данные могут обрабатываться','2. Ինչ տվյալներ կարող են մշակվել','2. Information that may be processed'),paragraphs:[
    e('Набор данных зависит от используемого сервиса и настроек дома. Он может включать контактные и учётные данные, сведения о роли и доступе к квартире или зданию, обращения и сообщения, фотографии, гостевые пропуска, настройки уведомлений, а также технические журналы безопасности и работы сервиса.','Տվյալների կազմը կախված է օգտագործվող ծառայությունից և շենքի կարգավորումներից։ Այն կարող է ներառել կապի և հաշվի տվյալներ, բնակարանի կամ շենքի դերի և հասանելիության մասին տեղեկություններ, դիմումներ ու հաղորդագրություններ, լուսանկարներ, հյուրերի անցագրեր, ծանուցումների կարգավորումներ և ծառայության անվտանգության ու աշխատանքի տեխնիկական մատյաններ։','The information depends on the service and building settings. It may include contact and account details, household or building access roles, requests and messages, photos, guest passes, notification preferences, and technical security or service logs.')
   ]},
   {title:e('3. Для чего используются данные','3. Ինչ նպատակով են օգտագործվում տվյալները','3. How information may be used'),paragraphs:[
    e('Данные могут использоваться для создания и защиты учётной записи, подтверждения доступа к дому, предоставления выбранных функций, обработки обращений, связи с жителями и управляющей командой, технической поддержки, предотвращения злоупотреблений и выполнения обязательных требований.','Տվյալները կարող են օգտագործվել հաշիվ ստեղծելու և պաշտպանելու, շենքի հասանելիությունը հաստատելու, ընտրված գործառույթները տրամադրելու, դիմումները մշակելու, բնակիչների և կառավարման թիմի հետ կապվելու, տեխնիկական աջակցություն ցուցաբերելու, չարաշահումները կանխելու և պարտադիր պահանջները կատարելու համար։','Information may be used to create and secure accounts, verify building access, provide selected features, handle requests, communicate with residents and building teams, provide support, prevent misuse, and meet applicable obligations.')
   ]},
   {title:e('4. Доступ и передача','4. Հասանելիություն և փոխանցում','4. Access and sharing'),paragraphs:[
    e('Доступ предоставляется только в объёме, необходимом для соответствующей роли и работы сервиса. Данные могут быть доступны уполномоченным представителям управляющей организации и поставщикам технических услуг, если это требуется для работы выбранной функции. Окончательная редакция должна описать конкретные категории получателей и условия передачи.','Հասանելիությունը տրամադրվում է միայն համապատասխան դերի և ծառայության աշխատանքի համար անհրաժեշտ ծավալով։ Տվյալները կարող են հասանելի լինել կառավարման կազմակերպության լիազորված ներկայացուցիչներին և տեխնիկական ծառայություններ մատուցողներին, եթե դա անհրաժեշտ է ընտրված գործառույթի համար։ Վերջնական տարբերակում պետք է նկարագրվեն ստացողների կատեգորիաներն ու փոխանցման պայմանները։','Access should be limited to what each role and service needs. Information may be available to authorized building-management staff and technical service providers when required for a selected feature. The final policy should specify recipient categories and sharing conditions.')
   ]},
   {title:e('5. Хранение и защита','5. Պահպանում և պաշտպանություն','5. Retention and security'),paragraphs:[
    e('Данные хранятся столько, сколько необходимо для работы сервиса, выполнения обязательных требований и разрешения споров. Сроки для каждой категории будут уточнены в финальной версии. Vernatun применяет технические и организационные меры защиты, однако ни один способ хранения или передачи данных не может гарантировать абсолютную безопасность.','Տվյալները պահվում են այնքան ժամանակ, որքան անհրաժեշտ է ծառայության աշխատանքի, պարտադիր պահանջների կատարման և վեճերի լուծման համար։ Յուրաքանչյուր կատեգորիայի ժամկետները կհստակեցվեն վերջնական տարբերակում։ Vernatun-ը կիրառում է տեխնիկական և կազմակերպական պաշտպանության միջոցներ, սակայն տվյալների պահպանման կամ փոխանցման ոչ մի եղանակ չի կարող երաշխավորել բացարձակ անվտանգություն։','Information is retained as needed to operate the service, meet applicable requirements, and resolve disputes. Retention periods for each category will be specified in the final version. Vernatun uses technical and organizational safeguards, but no storage or transmission method can guarantee absolute security.')
   ]},
   {title:e('6. Ваши запросы и контакты','6. Ձեր հարցումները և կապը','6. Requests and contact'),paragraphs:[
    e('Пользователь сможет обратиться за доступом к своим данным, исправлением неточностей или разъяснением обработки через контакт, который будет опубликован в окончательной редакции. Возможность удаления или ограничения обработки зависит от требований закона и необходимости вести учёт по дому.','Օգտատերը կարող է դիմել իր տվյալներին հասանելիություն ստանալու, սխալները ուղղելու կամ մշակման վերաբերյալ պարզաբանում ստանալու համար՝ վերջնական տարբերակում հրապարակվող կապի միջոցով։ Ջնջման կամ մշակումը սահմանափակելու հնարավորությունը կախված է օրենքի պահանջներից և շենքի հաշվառման անհրաժեշտությունից։','Users may request access to their information, correction of inaccuracies, or an explanation of processing through the contact published in the final version. Erasure or restriction may depend on legal requirements and necessary building records.')
   ]}
  ]
 },
 terms:{
  title:e('Условия использования','Օգտագործման պայմաններ','Terms of use'),
  description:e('Черновик условий использования сайта Vernatun и связанных цифровых сервисов для управления недвижимостью и взаимодействия жителей.','Vernatun կայքի և անշարժ գույքի կառավարման ու բնակիչների փոխգործակցության թվային ծառայությունների օգտագործման պայմանների նախագիծ։','Draft terms for using the Vernatun website and related digital property-management and resident services.'),
  intro:e('Эти условия описывают базовые правила использования сайта Vernatun и связанных цифровых продуктов. Они подготовлены как редактируемый черновик, а не как окончательный юридический документ.','Այս պայմանները նկարագրում են Vernatun կայքի և հարակից թվային արտադրանքների օգտագործման հիմնական կանոնները։ Դրանք պատրաստվել են որպես խմբագրվող նախագիծ, ոչ թե վերջնական իրավական փաստաթուղթ։','These terms outline basic rules for using the Vernatun website and related digital products. They are an editable draft, not a final legal document.'),
  notice:e('Черновик для согласования. Перед публикацией необходимо проверить стороны договора, правила для конкретных организаций, условия оплаты, применимое право и контактные данные.','Համաձայնեցման նախագիծ է։ Հրապարակումից առաջ պետք է ստուգել պայմանագրի կողմերը, կազմակերպությունների կանոնները, վճարման պայմանները, կիրառելի իրավունքը և կապի տվյալները։','Draft for review. Before publication, confirm the contracting parties, organization-specific rules, payment terms, governing law, and contact details.'),
  sections:[
   {title:e('1. Использование сервиса','1. Ծառայությունից օգտվելը','1. Using the service'),paragraphs:[
    e('Vernatun предоставляет цифровые инструменты для управления недвижимостью, работы команд зданий и взаимодействия жителей. Доступные функции зависят от подключения объекта, выбранного продукта и назначенных пользователю прав.','Vernatun-ը տրամադրում է թվային գործիքներ անշարժ գույքի կառավարման, շենքերի թիմերի աշխատանքի և բնակիչների փոխգործակցության համար։ Հասանելի գործառույթները կախված են օբյեկտի միացումից, ընտրված արտադրանքից և օգտատիրոջ իրավունքներից։','Vernatun provides digital tools for property management, building-team operations, and resident services. Available features depend on the building connection, selected product, and permissions assigned to the user.')
   ]},
   {title:e('2. Учётная запись и доступ','2. Հաշիվ և հասանելիություն','2. Accounts and access'),paragraphs:[
    e('Пользователь должен указывать достоверные сведения, хранить данные входа в безопасности и использовать только те объекты и функции, к которым ему предоставлен доступ. Доступ к квартире или зданию может требовать подтверждения управляющей организацией или владельцем объекта.','Օգտատերը պետք է տրամադրի հավաստի տեղեկություններ, անվտանգ պահի մուտքի տվյալները և օգտվի միայն այն օբյեկտներից ու գործառույթներից, որոնց հասանելիություն ունի։ Բնակարանի կամ շենքի հասանելիությունը կարող է պահանջել կառավարման կազմակերպության կամ օբյեկտի սեփականատիրոջ հաստատումը։','Users must provide accurate information, protect their sign-in credentials, and use only the properties and features they are authorized to access. Access to a home or building may require verification by its management organization or owner.')
   ]},
   {title:e('3. Материалы и действия пользователя','3. Օգտատիրոջ նյութերն ու գործողությունները','3. User content and conduct'),paragraphs:[
    e('Пользователь отвечает за законность и точность отправляемых им сообщений, фотографий, заявок и других материалов. Нельзя использовать сервис для незаконного доступа, нарушения чужих прав, распространения вредоносного содержимого или вмешательства в работу систем и устройств.','Օգտատերը պատասխանատու է իր ուղարկած հաղորդագրությունների, լուսանկարների, դիմումների և այլ նյութերի օրինականության ու ճշտության համար։ Արգելվում է ծառայությունն օգտագործել ապօրինի մուտքի, ուրիշների իրավունքների խախտման, վնասակար նյութերի տարածման կամ համակարգերի ու սարքերի աշխատանքին միջամտելու համար։','Users are responsible for the legality and accuracy of their messages, photos, requests, and other submissions. The service must not be used for unauthorized access, rights violations, harmful content, or interference with systems or devices.')
   ]},
   {title:e('4. Платежи и внешние функции','4. Վճարումներ և արտաքին գործառույթներ','4. Payments and connected features'),paragraphs:[
    e('Если для дома включены платёжные функции, сумма, получатель и условия оплаты показываются до подтверждения операции. Обработка платежей может выполняться внешним платёжным поставщиком по правилам соответствующей организации. Функции устройств, камеры и другие интеграции доступны только после отдельного подключения и настройки.','Եթե շենքի համար միացված են վճարման գործառույթներ, գումարը, ստացողը և վճարման պայմանները ցուցադրվում են գործարքը հաստատելուց առաջ։ Վճարումը կարող է մշակվել արտաքին վճարային մատակարարի կողմից՝ համապատասխան կազմակերպության կանոններով։ Սարքերի, տեսախցիկների և այլ ինտեգրացիաների գործառույթները հասանելի են միայն առանձին միացումից և կարգավորումից հետո։','If payment features are enabled for a building, the amount, recipient, and payment terms are shown before confirmation. Payments may be processed by an external provider under the relevant organization’s rules. Device controls, cameras, and other integrations are available only after separate connection and configuration.')
   ]},
   {title:e('5. Доступность и изменения','5. Հասանելիություն և փոփոխություններ','5. Availability and changes'),paragraphs:[
    e('Доступ к отдельным функциям может временно ограничиваться для обслуживания, защиты данных или устранения неполадок. Состав сервиса может меняться при подключении или отключении модулей. В окончательной редакции будут описаны уведомление об изменениях и порядок прекращения доступа.','Առանձին գործառույթների հասանելիությունը կարող է ժամանակավորապես սահմանափակվել սպասարկման, տվյալների պաշտպանության կամ խնդիրների լուծման նպատակով։ Ծառայության կազմը կարող է փոխվել մոդուլների միացման կամ անջատման դեպքում։ Վերջնական տարբերակում կնկարագրվեն փոփոխությունների մասին ծանուցումն ու հասանելիության դադարեցման կարգը։','Access to individual features may be temporarily limited for maintenance, data protection, or troubleshooting. The service may change when modules are enabled or disabled. The final terms will describe notices and how access may end.')
   ]},
   {title:e('6. Ответственность и связь','6. Պատասխանատվություն և կապ','6. Liability and contact'),paragraphs:[
    e('Объём ответственности сторон, применимое право и порядок разрешения споров должны быть определены в окончательной версии с учётом фактического оператора сервиса и заключённых договоров. По вопросам использования сервиса обратитесь в управляющую организацию или по контактам, которые будут опубликованы здесь.','Կողմերի պատասխանատվության ծավալը, կիրառելի իրավունքը և վեճերի լուծման կարգը պետք է սահմանվեն վերջնական տարբերակում՝ հաշվի առնելով ծառայության իրական օպերատորին և կնքված պայմանագրերը։ Ծառայությունից օգտվելու հարցերով դիմեք կառավարման կազմակերպությանը կամ այստեղ հրապարակվող կապի տվյալներով։','The parties’ liability, governing law, and dispute process must be defined in the final version based on the actual service operator and applicable agreements. For service questions, contact the building-management organization or the contact details published here.')
   ]}
  ]
 }
};

export default function LegalPage({kind}:{kind:LegalKind}){
 const page=documents[kind];
 const locale=landingLanguage==='hy'?'hy':landingLanguage==='en'?'en':'ru';
 const [published,setPublished]=useState<PublishedLegalText|null>(null);
 useEffect(()=>{
  let active=true;setPublished(null);
  fetch(apiUrl('/api/public/site/pages/'+kind),{headers:{Accept:'application/json'}})
   .then(async response=>response.ok?response.json():null)
   .then(data=>{if(active&&data?.content?.[locale])setPublished(data.content[locale])})
   .catch(()=>{});
  return()=>{active=false};
 },[kind,locale]);
 const title=published?.title||page.title;
 const description=published?.summary||page.description;
 const home=e('На главную','Գլխավոր էջ','Home');
 const privacy=e('Конфиденциальность','Գաղտնիություն','Privacy');
 const terms=e('Условия использования','Օգտագործման պայմաններ','Terms of use');
 useEffect(()=>{
  document.documentElement.lang=landingLanguage;
   document.title=`${title} | Vernatun`;
   meta('description',description);
  meta('og:type','website',true);
   meta('og:title',`${title} | Vernatun`,true);
   meta('og:description',description,true);
  meta('og:url',`https://vernatun.io/${kind}`,true);
  meta('twitter:card','summary');
   meta('twitter:title',`${title} | Vernatun`);
   meta('twitter:description',description);
  let canonical=document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if(!canonical){canonical=document.createElement('link');canonical.rel='canonical';document.head.appendChild(canonical)}
  canonical.href=`https://vernatun.io/${kind}`;
  },[kind,page,title,description]);
 return <>
  <a className="skip-link" href="#legal-content">{e('Перейти к тексту','Անցնել տեքստին','Skip to content')}</a>
  <header className="legal-header">
   <div className="container legal-header-inner">
    <Logo href="/" />
    <nav aria-label={e('Юридические документы','Իրավական փաստաթղթեր','Legal documents')}>
     <a href="/privacy" aria-current={kind==='privacy'?'page':undefined}>{privacy}</a>
     <a href="/terms" aria-current={kind==='terms'?'page':undefined}>{terms}</a>
    </nav>
    <a className="button secondary legal-home" href="/">{home}</a>
   </div>
  </header>
  <main id="legal-content" className="legal-main">
   <div className="container legal-container">
     <nav className="legal-breadcrumb" aria-label={e('Навигация','Նավիգացիա','Breadcrumb')}><a href="/">{home}</a><span aria-hidden="true">/</span><span>{title}</span></nav>
    <article className="legal-document">
     <p className="eyebrow">{e('Информация Vernatun','Vernatun-ի տեղեկություններ','Vernatun information')}</p>
      <h1>{title}</h1>
      <p className="legal-intro">{published?.summary||page.intro}</p>
      {!published&&<aside className="legal-draft" role="note"><strong>{e('Черновик','Նախագիծ','Draft')}</strong><span>{page.notice}</span></aside>}
      {published?<div className="legal-sections"><section><p className="legal-cms-body">{published.body}</p></section></div>:<div className="legal-sections">{page.sections.map((section,index)=><section key={index}><h2>{section.title}</h2>{section.paragraphs.map((paragraph,i)=><p key={i}>{paragraph}</p>)}{section.items&&<ul>{section.items.map((item,i)=><li key={i}>{item}</li>)}</ul>}</section>)}</div>}
    </article>
   </div>
  </main>
  <SiteFooter homePrefix="/" activeLegal={kind}/>
 </>;
}
