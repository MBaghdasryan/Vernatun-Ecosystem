import {useEffect,useRef,useState} from 'react';
import {request} from './client';
import type {Language} from './i18n';
type Diagnostics={checkedAt:string;database:string;schema:string;pendingStages:number;overdueStages:number;scope:string};
type Article={slug:string;title:string;body:string};
const S={
 diagnostics:['Ներդրման ախտորոշում','Диагностика внедрения','Implementation diagnostics'],
 scope:['Ստուգվում են կապը, ներդրման կառուցվածքը և ձեզ հասանելի փուլերը։ Սա արտաքին ծառայությունների, արտադրողականության կամ պահուստային վերականգնման ստուգում չէ։','Проверяются соединение, структура внедрения и доступные вам этапы. Это не проверка внешних сервисов, производительности или восстановления резервных копий.','Checks connection, implementation schema and your authorized stages. This is not external-service, performance or backup-recovery certification.'],
 run:['Ստուգել հիմա','Проверить сейчас','Check now'],loading:['Բեռնվում է…','Загрузка…','Loading…'],
 error:['Չհաջողվեց բեռնել։ Կրկնեք։','Не удалось загрузить. Повторите.','Could not load. Retry.'],
 ready:['Հասանելի','Доступно','Available'],incomplete:['Կառուցվածքը թերի է','Структура неполная','Schema incomplete'],
 pending:['Բաց փուլեր','Незавершённые этапы','Pending stages'],overdue:['Ժամկետանց','Просроченные','Overdue'],
 knowledge:['Գիտելիքների բազա','База знаний','Knowledge base'],search:['Որոնել հրահանգներում','Поиск по инструкциям','Search instructions'],
 empty:['Հրահանգներ չեն գտնվել','Инструкции не найдены','No instructions found'],
 note:['Հրահանգները թարմացվում են հավելվածի թողարկումներով։','Инструкции обновляются вместе с приложением.','Instructions are maintained with application releases.']
} as const;
export default function ImplementationTools({language}:{language:Language}){
 const i=language==='hy'?0:language==='ru'?1:2,t=(k:keyof typeof S)=>S[k][i];
 const [articles,setArticles]=useState<Article[]>(),[failed,setFailed]=useState(false),[revision,setRevision]=useState(0),[q,setQ]=useState('');
 const [diagnostic,setDiagnostic]=useState<Diagnostics>(),[checking,setChecking]=useState(false),[checkError,setCheckError]=useState(false);
 const live=useRef(true),sequence=useRef(0);
 useEffect(()=>{live.current=true;return()=>{live.current=false;sequence.current++}},[]);
 useEffect(()=>{let stale=false;setArticles(undefined);setFailed(false);
  void request<Article[]>('/platform/knowledge-base?language='+language).then(r=>{if(!stale)setArticles(r)}).catch(()=>{if(!stale)setFailed(true)});
  return()=>{stale=true};
 },[language,revision]);
 async function run(){
  if(checking)return;
  const seq=++sequence.current;setChecking(true);setCheckError(false);
  try{const r=await request<Diagnostics>('/platform/implementation-diagnostics');if(live.current&&seq===sequence.current)setDiagnostic(r)}
  catch{if(live.current&&seq===sequence.current)setCheckError(true)}
  finally{if(live.current&&seq===sequence.current)setChecking(false)}
 }
 const shown=articles?.filter(a=>(a.title+' '+a.body).toLocaleLowerCase(language).includes(q.toLocaleLowerCase(language)));
 return <div className="p-business-grid">
  <section className="p-card" id="diagnostics"><h2>{t('diagnostics')}</h2><p>{t('scope')}</p>
   <button className="p-button" type="button" disabled={checking} onClick={()=>void run()}>{t(checking?'loading':'run')}</button>
   {checkError&&<p role="alert" className="p-error">{t('error')}</p>}
   {diagnostic&&<div aria-live="polite"><p><time dateTime={diagnostic.checkedAt}>{new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Yerevan'}).format(new Date(diagnostic.checkedAt))}</time> · Asia/Yerevan</p>
    <p>{t(diagnostic.schema==='ready'?'ready':'incomplete')}</p><dl><dt>{t('pending')}</dt><dd>{diagnostic.pendingStages}</dd><dt>{t('overdue')}</dt><dd>{diagnostic.overdueStages}</dd></dl>
   </div>}
  </section>
  <section className="p-card" id="knowledge"><h2>{t('knowledge')}</h2><p>{t('note')}</p>
   <label>{t('search')}<input type="search" value={q} maxLength={120} onChange={e=>setQ(e.target.value)}/></label>
   {failed?<><p role="alert" className="p-error">{t('error')}</p><button type="button" className="p-button" onClick={()=>setRevision(v=>v+1)}>{t('run')}</button></>:!articles?<p role="status">{t('loading')}</p>:shown?.length?shown.map(a=><details key={a.slug}><summary style={{cursor:'pointer',padding:'12px 0',fontWeight:600}}>{a.title}</summary><p style={{whiteSpace:'pre-wrap',lineHeight:1.7}}>{a.body}</p></details>):<p role="status">{t('empty')}</p>}
  </section>
 </div>;
}
