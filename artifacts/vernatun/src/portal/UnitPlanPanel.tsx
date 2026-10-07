import {useEffect,useRef,useState,type MouseEvent} from 'react';
import {getUnitPlan,changeUnitPlan,uploadUnitPlan,getGetUnitPlanImageUrl} from '@workspace/api-client-react';
import type {UnitPlanView} from '@workspace/api-client-react';
import {request,getCsrfHeaders} from './client';
import type {Language} from './i18n';
import type {RoleContext} from './types';
import './unit-plan.css';

const L={
 title:['Բնակարանի հատակագիծ և թերություններ','План помещения и дефекты','Unit plan and defects'],
 unit:['Բնակարան','Помещение','Unit'],
 loading:['Բեռնվում է…','Загрузка…','Loading…'],
 error:['Չհաջողվեց բեռնել։','Не удалось загрузить.','Could not load.'],
 retry:['Կրկնել','Повторить','Retry'],refresh:['Թարմացնել','Обновить','Refresh'],
 noUnits:['Հասանելի բնակարաններ չկան','Нет доступных помещений','No units in your scope'],
 noAccess:['Մուտքը մերժված է կամ բնակարանը չի գտնվել։','Доступ запрещён или помещение не найдено.','Access denied or unit not found.'],
 noPlan:['Հատակագիծ դեռ չկա','План ещё не загружен','No plan uploaded yet'],
 noPlanHint:['Վերբեռնեք PNG, JPEG կամ WebP, մինչև 6 ՄԲ։','Загрузите PNG, JPEG или WebP до 6 МБ.','Upload PNG, JPEG or WebP up to 6 MB.'],
 upload:['Վերբեռնել հատակագիծ','Загрузить план','Upload plan'],
 replace:['Փոխարինել','Заменить','Replace'],remove:['Հեռացնել հատակագիծը','Удалить план','Remove plan'],
 confirmReplace:['Նոր հատակագիծը կստեղծվի առանց նշիչների։ Առկա նշիչները մնում են հին հատակագծի վրա և չեն պատճենվում։','Новый план будет без маркеров. Текущие маркеры остаются на старом плане и не копируются.','The new plan starts without markers. Existing markers stay on the old plan and are not copied.'],
 confirmRemove:['Հատակագիծը կհեռացվի տեսքից։ Ֆայլը և թերությունները չեն ջնջվում, նշիչները մնում են հին հատակագծի վրա։','План будет снят. Файл и дефекты не удаляются; маркеры остаются на старом плане.','The plan will be detached. The file and defects are not deleted; markers stay on the old plan.'],
 confirm:['Հաստատել','Подтвердить','Confirm'],cancel:['Չեղարկել','Отмена','Cancel'],
 badType:['Թույլատրված են միայն PNG, JPEG, WebP։','Допустимы только PNG, JPEG, WebP.','Only PNG, JPEG, WebP allowed.'],
 tooBig:['Ֆայլը 6 ՄԲ-ից մեծ է։','Файл больше 6 МБ.','File exceeds 6 MB.'],
 defects:['Թերություններ','Дефекты','Defects'],placed:['Նշված','Размещён','Placed'],unplaced:['Չնշված','Не размещён','Unplaced'],
 noDefects:['Այս բնակարանում թերություններ չկան','В помещении нет дефектов','No defects for this unit'],
 pick:['Ընտրեք թերություն, ապա սեղմեք հատակագծի վրա կամ մուտքագրեք X/Y։','Выберите дефект, затем щёлкните по плану или введите X/Y.','Select a defect, then click the plan or enter X/Y.'],
 save:['Պահպանել դիրքը','Сохранить положение','Save position'],saving:['Պահպանվում է…','Сохранение…','Saving…'],
 unmark:['Հեռացնել նշիչը','Убрать маркер','Remove marker'],
 saved:['Պահպանված է','Сохранено','Saved'],
 stale:['Հատակագիծը փոխվել է այլ օգտատիրոջ կողմից։ Մուտքագրումը պահպանված է։ Թարմացրեք և ստուգեք նախքան կրկնելը։','План изменён другим пользователем. Ввод сохранён. Обновите и проверьте перед повтором.','The plan was changed elsewhere. Your input is kept. Reload and review before retrying.'],
 reload:['Թարմացնել և ստուգել','Обновить и проверить','Reload and review'],
 net:['Կապը խզվեց։ Կրկնեք — կրկնությունն անվտանգ է։','Связь прервана. Повторите — повтор безопасен.','Connection lost. Retry is safe.'],
 fail:['Չհաջողվեց պահպանել','Не удалось сохранить','Could not save'],
 readOnly:['Միայն դիտում','Только просмотр','Read only'],
 revision:['Տարբերակ','Ревизия','Revision'],range:['0–100 %','0–100 %','0–100 %'],
 st_assigned:['Նշանակված','Назначен','Assigned'],st_in_progress:['Ընթացքում','В работе','In progress'],st_review:['Ստուգման','На проверке','In review'],st_accepted:['Ընդունված','Принят','Accepted'],
 imgErr:['Հատակագծի պատկերը չհաջողվեց բեռնել։ Նշիչների տեղադրումն անջատված է։','Не удалось загрузить изображение плана. Размещение маркеров отключено.','Plan image failed to load. Marker placement is disabled.'],
 retryUpload:['Կրկնել վերբեռնումը','Повторить загрузку','Retry upload'],
 location:['Վայր','Место','Location'],
} as const;
type K=keyof typeof L;
type Unit={id:string;number:string;building_name:string};
const st=(e:unknown)=>(e as {status?:number})?.status;
const ST=['assigned','in_progress','review','accepted'];
const TYPES=['image/png','image/jpeg','image/webp'];

export default function UnitPlanPanel({c,language}:{c:RoleContext;language:Language}){
 const t=(k:K)=>L[k][language==='hy'?0:language==='ru'?1:2];
 const allowed=c.permissions.includes('properties.read');
 const [units,setUnits]=useState<Unit[]>(),[uErr,setUErr]=useState(false),[uRev,setURev]=useState(0),[unit,setUnit]=useState('');
 useEffect(()=>{if(!allowed)return;let live=true;setUnits(undefined);setUErr(false);
  request<Unit[]>('/units').then(u=>{if(!live)return;setUnits(u);setUnit(p=>u.some(x=>x.id===p)?p:u[0]?.id??'')}).catch(()=>{if(live)setUErr(true)});
  return()=>{live=false}},[c.id,uRev,allowed]);
 if(!allowed)return null;
 return <section className="p-card up-root" data-testid="unit-plan-panel">
  <header className="up-head"><h3>{t('title')}</h3>
   {units&&units.length>0&&<label className="up-unit">{t('unit')}<select data-testid="select-plan-unit" value={unit} onChange={e=>setUnit(e.target.value)}>{units.map(u=><option key={u.id} value={u.id}>{u.building_name} · {u.number}</option>)}</select></label>}
  </header>
  {uErr?<p className="p-error" role="alert">{t('error')} <button type="button" className="p-button" onClick={()=>setURev(n=>n+1)}>{t('retry')}</button></p>
  :!units?<div className="up-skel" role="status" aria-label={t('loading')}><i/><i/></div>
  :!units.length?<p className="up-empty">{t('noUnits')}</p>
  :unit&&<Plan key={c.id+':'+unit} unitId={unit} t={t}/>}
 </section>;
}

function Plan({unitId,t}:{unitId:string;t:(k:K)=>string}){
 const [view,setView]=useState<UnitPlanView>(),[loadErr,setLoadErr]=useState<''|'net'|'denied'>(''),[rev,setRev]=useState(0);
 const [sel,setSel]=useState(''),[x,setX]=useState(''),[y,setY]=useState('');
 const [busy,setBusy]=useState(false),[err,setErr]=useState(''),[stale,setStale]=useState(false),[ok,setOk]=useState('');
 const [refreshing,setRefreshing]=useState(true);
 const [pending,setPending]=useState<{kind:'replace';file:File}|{kind:'remove'}|null>(null);
 const attempt=useRef<{p:string;key:string}|undefined>(undefined);
 const keyFor=(p:string)=>{if(attempt.current?.p!==p)attempt.current={p,key:crypto.randomUUID()};return attempt.current.key};
 const fileRef=useRef<HTMLInputElement>(null);
 const [failedFile,setFailedFile]=useState<File|null>(null),[img,setImg]=useState<{id:string;s:'ok'|'err'}>();
 const hold=useRef(false);
 hold.current=busy||stale||!!pending||!!failedFile||(!!sel&&(x!==''||y!==''));
 const sl=(s:string)=>ST.includes(s)?t(('st_'+s) as K):s;

 useEffect(()=>{
  const ab=new AbortController();let seq=0;
  const load=async(force=false)=>{const n=++seq;try{const v=await getUnitPlan(unitId,{signal:ab.signal});if(n===seq&&!ab.signal.aborted&&(force||!hold.current)){setView(v);setLoadErr('');if(force)setStale(false)}}
   catch(e){if(n!==seq||ab.signal.aborted)return;const s=st(e);if(s===401||s===403||s===404){setView(undefined);setSel('');setX('');setY('');setLoadErr('denied')}else setLoadErr('net')}
   finally{if(force&&!ab.signal.aborted)setRefreshing(false)}};
  void load(true);const r=()=>{if(!hold.current&&document.visibilityState==='visible'&&navigator.onLine)void load()};
  const id=setInterval(r,30000);addEventListener('focus',r);addEventListener('online',r);
  return()=>{ab.abort();clearInterval(id);removeEventListener('focus',r);removeEventListener('online',r)};
 },[unitId,rev]);

 const plan=view?.plan??null,can=!!view?.canManage&&!stale&&!refreshing;
 const imgOk=!!plan&&img?.id===plan.id&&img.s==='ok',imgBad=!!plan&&img?.id===plan.id&&img.s==='err';
 const markers=new Map(plan?.markers.map(m=>[m.defectId,m]));
 const pct=(v:number)=>(Math.round(v*1000)/10).toString();
 function choose(id:string){if(busy)return;setSel(id);setErr('');setOk('');const m=markers.get(id);setX(m?pct(m.x):'');setY(m?pct(m.y):'')}
 function onPlanClick(e:MouseEvent<HTMLDivElement>){
  if(!can||!sel||busy||!imgOk)return;const r=e.currentTarget.getBoundingClientRect();
  const nx=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),ny=Math.min(1,Math.max(0,(e.clientY-r.top)/r.height));
  setX(pct(nx));setY(pct(ny));setOk('');
 }
 const nx=Number(x)/100,ny=Number(y)/100;
 const validXY=x!==''&&y!==''&&nx>=0&&nx<=1&&ny>=0&&ny<=1;

 function handleErr(e:unknown){const s=st(e);
  if(s===409){setStale(true);setErr(t('stale'))}
  else if(s===401||s===403||s===404){setView(undefined);setSel('');setX('');setY('');setPending(null);setErr(t('noAccess'));setRev(n=>n+1)}
  else if(!s||s>=500)setErr(t('net'));
  else setErr(t('fail')+' ('+s+')')}
 async function change(action:'mark'|'unmark'|'remove'){
  if(busy||!plan||stale||refreshing)return;if(action==='mark'&&!validXY)return;
  setBusy(true);setErr('');setOk('');
  const body={planId:plan.id,revision:plan.revision,action,...(action!=='remove'?{defectId:sel}:{}),...(action==='mark'?{x:nx,y:ny}:{})};
  try{await changeUnitPlan(unitId,{key:keyFor(unitId+JSON.stringify(body)),...body},{headers:getCsrfHeaders()});
   attempt.current=undefined;setOk(t('saved'));setPending(null);setSel('');setX('');setY('');setRefreshing(true);setRev(n=>n+1)}
  catch(e){handleErr(e)}finally{setBusy(false)}
 }
 async function upload(file:File){
  if(busy||stale||refreshing)return;setBusy(true);setErr('');setOk('');
  const params={revision:plan?.revision??0,...(plan?{planId:plan.id}:{})};
  try{await uploadUnitPlan(unitId,file,{key:keyFor(unitId+JSON.stringify(params)+file.name+file.size+file.lastModified),...params},{headers:getCsrfHeaders()});
   attempt.current=undefined;setOk(t('saved'));setPending(null);setFailedFile(null);setSel('');setX('');setY('');if(fileRef.current)fileRef.current.value='';setRefreshing(true);setRev(n=>n+1)}
  catch(e){if(!pending)setFailedFile(file);handleErr(e)}finally{setBusy(false)}
 }
 function pickFile(f?:File){if(!f)return;setErr('');
  if(!TYPES.includes(f.type)){setErr(t('badType'));return}
  if(f.size>6*1024*1024){setErr(t('tooBig'));return}
  setFailedFile(null);if(plan)setPending({kind:'replace',file:f});else void upload(f)}
 function reloadReview(){setRefreshing(true);setPending(null);setFailedFile(null);setErr('');attempt.current=undefined;setRev(n=>n+1)}

 if(loadErr==='denied')return <p className="p-error" role="alert">{t('noAccess')} <button type="button" className="p-button" onClick={()=>setRev(n=>n+1)}>{t('retry')}</button></p>;
 if(!view)return loadErr?<p className="p-error" role="alert">{t('error')} <button type="button" className="p-button" onClick={()=>setRev(n=>n+1)}>{t('retry')}</button></p>:<div className="up-skel" role="status" aria-label={t('loading')}><i/><i/></div>;

 const selDefect=view.defects.find(d=>d.id===sel);
 const unplaced=view.defects.filter(d=>!markers.has(d.id));
 return <div className="up-body">
  <div className="up-toolbar">
   {plan&&<span className="up-meta" data-testid="text-plan-revision">{t('revision')} {plan.revision} · {new Date(plan.createdAt).toLocaleDateString()}</span>}
   {!can&&<span className="up-badge">{t('readOnly')}</span>}
   {loadErr==='net'&&<span className="up-warn" role="status">{t('error')}</span>}
   <span className="up-spacer"/>
   <button type="button" className="p-button" data-testid="button-plan-refresh" onClick={reloadReview} disabled={busy||refreshing}>{t('refresh')}</button>
   {can&&<>
    <input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" data-testid="input-plan-file" onChange={e=>pickFile(e.target.files?.[0])}/>
    <button type="button" className="p-button orange" data-testid="button-plan-upload" disabled={busy||!!pending||stale} onClick={()=>fileRef.current?.click()}>{plan?t('replace'):t('upload')}</button>
    {plan&&<button type="button" className="p-button up-danger" data-testid="button-plan-remove" disabled={busy||!!pending||stale} onClick={()=>setPending({kind:'remove'})}>{t('remove')}</button>}
   </>}
  </div>
  {pending&&<div className="up-confirm" role="alertdialog" aria-live="assertive">
   <p>{t(pending.kind==='replace'?'confirmReplace':'confirmRemove')}{pending.kind==='replace'&&<><br/><small>{pending.file.name}</small></>}</p>
   <div><button type="button" className="p-button up-danger" data-testid="button-confirm-plan" disabled={busy||stale} onClick={()=>pending.kind==='replace'?void upload(pending.file):void change('remove')}>{busy?t('saving'):t('confirm')}</button>
   <button type="button" className="p-button" disabled={busy} onClick={()=>{setPending(null);if(fileRef.current)fileRef.current.value=''}}>{t('cancel')}</button></div>
  </div>}
  {err&&<p className="p-error" role="alert" data-testid="text-plan-error">{err} {stale&&<button type="button" className="p-button" onClick={reloadReview}>{t('reload')}</button>}</p>}
  {failedFile&&!stale&&<p className="up-confirm">{failedFile.name} <button type="button" className="p-button orange" data-testid="button-retry-upload" disabled={busy} onClick={()=>void upload(failedFile)}>{busy?t('saving'):t('retryUpload')}</button><button type="button" className="p-button" disabled={busy} onClick={()=>setFailedFile(null)}>{t('cancel')}</button></p>}
  {ok&&<p className="up-ok" role="status">{ok}</p>}

  <div className="up-grid">
   <div className="up-stage">
    {!plan?<div className="up-noplan"><strong>{t('noPlan')}</strong>{can&&<span>{t('noPlanHint')}</span>}</div>:
    <div className={'up-frame'+(can&&sel&&imgOk?' up-placing':'')} onClick={onPlanClick} data-testid="area-plan">
     <img src={getGetUnitPlanImageUrl(unitId,plan.id)} alt={t('title')} draggable={false} onLoad={()=>setImg({id:plan.id,s:'ok'})} onError={()=>setImg({id:plan.id,s:'err'})}/>
     {imgBad&&<p className="p-error up-imgerr" role="alert" data-testid="text-plan-image-error">{t('imgErr')}</p>}
     {imgOk&&plan.markers.map((m,i)=>{const d=view.defects.find(z=>z.id===m.defectId);const showDraft=m.defectId===sel&&validXY;return <button key={m.defectId} type="button"
      className={'up-pin up-s-'+(d?.status??'x')+(m.defectId===sel?' up-on':'')}
      style={{left:(showDraft?nx:m.x)*100+'%',top:(showDraft?ny:m.y)*100+'%'}}
      disabled={busy} title={d?d.subject+' · '+sl(d.status):m.defectId} aria-label={d?.subject??m.defectId} data-testid={'marker-'+m.defectId}
      onClick={e=>{e.stopPropagation();choose(m.defectId)}}>{i+1}</button>})}
     {imgOk&&sel&&!markers.has(sel)&&validXY&&<span className="up-pin up-draft" style={{left:nx*100+'%',top:ny*100+'%'}}/>}
    </div>}
   </div>
   <aside className="up-side">
    <h4>{t('defects')} <small>{view.defects.length-unplaced.length}/{view.defects.length}</small></h4>
    {!view.defects.length?<p className="up-empty">{t('noDefects')}</p>:
    <ul className="up-list">{view.defects.map(d=>{const idx=plan?.markers.findIndex(m=>m.defectId===d.id)??-1;return <li key={d.id}>
     <button type="button" className={d.id===sel?'up-on':''} aria-pressed={d.id===sel} disabled={busy} data-testid={'row-defect-'+d.id} onClick={()=>choose(d.id)}>
      <span className="up-num">{idx>=0?idx+1:'–'}</span>
      <span className="up-txt"><strong>{d.subject}</strong><small>{d.location}</small></span>
      <span className={'up-status up-s-'+d.status}>{sl(d.status)}</span>
     </button></li>})}</ul>}
    {plan&&view.canManage&&<div className="up-edit">
     {!selDefect?<p className="up-hint">{t('pick')}</p>:<>
      <p className="up-edit-title"><strong>{selDefect.subject}</strong> · {markers.has(sel)?t('placed'):t('unplaced')}</p>
      <div className="up-xy">
       <label>X %<input data-testid="input-marker-x" type="number" min={0} max={100} step={0.1} value={x} onChange={e=>setX(e.target.value)} disabled={busy}/></label>
       <label>Y %<input data-testid="input-marker-y" type="number" min={0} max={100} step={0.1} value={y} onChange={e=>setY(e.target.value)} disabled={busy}/></label>
      </div>
      <small className="up-hint">{t('range')}</small>
      <div className="up-actions">
       <button type="button" className="p-button orange" data-testid="button-marker-save" disabled={busy||!validXY||!imgOk} onClick={()=>void change('mark')}>{busy?t('saving'):t('save')}</button>
       {markers.has(sel)&&<button type="button" className="p-button up-danger" data-testid="button-marker-remove" disabled={busy} onClick={()=>void change('unmark')}>{t('unmark')}</button>}
      </div></>}
    </div>}
    {unplaced.length>0&&plan&&<p className="up-hint">{t('unplaced')}: {unplaced.length}</p>}
   </aside>
  </div>
 </div>;
}
