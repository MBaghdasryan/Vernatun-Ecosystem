import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {getHandoverReadiness,createHandoverFloor,assignHandoverFloor} from '@workspace/api-client-react';
import type {HandoverReadiness,HandoverReadinessUnit,HandoverFloor} from '@workspace/api-client-react';
import {getCsrfHeaders} from './client';
import type {Language} from './i18n';
import './floor-readiness.css';

const L={
 title:['Հարկային պատրաստվածություն','Готовность по этажам','Floor readiness'],
 building:['Շենք','Здание','Building'],all:['Բոլոր շենքերը','Все здания','All buildings'],
 entrance:['Մուտք','Подъезд','Entrance'],floor:['Հարկ','Этаж','Floor'],
 unassigned:['Առանց հարկի','Без этажа','No floor assigned'],
 unassignedHint:['Հարկը չի որոշվում բնակարանի համարով։','Этаж не определяется по номеру помещения.','Floor is never inferred from the unit number.'],
 loading:['Բեռնվում է…','Загрузка…','Loading…'],error:['Չհաջողվեց բեռնել։','Не удалось загрузить.','Could not load.'],
 retry:['Կրկնել','Повторить','Retry'],refresh:['Թարմացնել','Обновить','Refresh'],
 empty:['Հասանելի բնակարաններ չկան','Нет доступных помещений','No units in your scope'],
 tooUnits:['Չափազանց շատ բնակարաններ ցուցադրման համար։ Նեղացրեք հասանելիության շրջանակը։','Слишком много помещений для отображения. Сузьте область доступа.','Too many units to display. Narrow your access scope.'],
 tooFloors:['Չափազանց շատ հարկեր ցուցադրման համար։','Слишком много этажей для отображения.','Too many floors to display.'],
 denied:['Մուտքը մերժված է։','Доступ запрещён.','Access denied.'],
 legend:['Նշանակում','Обозначения','Legend'],
 s_unknown:['Անհայտ','Неизвестно','Unknown'],s_defects:['Թերություններ','Дефекты','Defects'],s_inspection:['Ստուգում','Осмотр','Inspection'],
 s_awaiting_confirmation:['Սպասում է հաստատման','Ждёт подтверждения','Awaiting confirmation'],s_ready:['Պատրաստ','Готово','Ready'],s_operational:['Շահագործման մեջ','В эксплуатации','Operational'],
 unit:['Բնակարան','Помещение','Unit'],openDefects:['Բաց թերություններ','Открытые дефекты','Open defects'],
 pending:['Սպասվող ստուգումներ','Ожидающие осмотры','Pending inspections'],done:['Ավարտված ստուգումներ','Завершённые осмотры','Completed inspections'],
 handover:['Հանձնման կարգավիճակ','Статус передачи','Handover status'],none:['Չկա','Нет','None'],
 noAuto:['Կարգավիճակը ավտոմատ չի փոխվում։','Статус не меняется автоматически.','Status never changes automatically.'],
 openPlan:['Բացել հատակագիծն ու թերությունները','Открыть план и дефекты','Open plan and defects'],
 mapping:['Հարկի կապում','Привязка к этажу','Floor mapping'],unlink:['Առանց հարկի (անջատել)','Без этажа (отвязать)','No floor (unlink)'],
 save:['Պահպանել','Сохранить','Save'],saving:['Պահպանվում է…','Сохранение…','Saving…'],saved:['Պահպանված է','Сохранено','Saved'],
 stale:['Տվյալները փոխվել են այլ տեղում։ Ընտրությունը պահպանված է։ Թարմացրեք և ստուգեք նախքան կրկնելը։','Данные изменены в другом месте. Выбор сохранён. Обновите и проверьте перед повтором.','Changed elsewhere. Your choice is kept. Reload and review before retrying.'],
 reload:['Թարմացնել և ստուգել','Обновить и проверить','Reload and review'],
 net:['Կապը խզվեց։ Կրկնեք — կրկնությունն անվտանգ է։','Связь прервана. Повторите — повтор безопасен.','Connection lost. Retry is safe.'],
 fail:['Չհաջողվեց պահպանել','Не удалось сохранить','Could not save'],
 newFloor:['Նոր մուտք / հարկ','Новый подъезд / этаж','New entrance / floor'],create:['Ստեղծել','Создать','Create'],
 pickBuilding:['Ընտրեք շենք հարկ ստեղծելու համար։','Выберите здание, чтобы создать этаж.','Select a building to create a floor.'],
 range:['Մուտք՝ մինչև 100 նիշ, հարկ −20…300','Название подъезда до 100 символов, этаж −20…300','Entrance name up to 100 characters, floor −20…300'],
 unsaved:['Պահպանեք կամ փակեք ընթացիկ փոփոխությունը։','Сохраните или закройте текущую правку.','Save or close the current edit first.'],
 readOnly:['Միայն դիտում','Только просмотр','Read only'],revision:['Տարբերակ','Ревизия','Revision'],
 close:['Փակել','Закрыть','Close'],units:['բն.','пом.','units'],
} as const;
type K=keyof typeof L;
const STATUSES=['unknown','defects','inspection','awaiting_confirmation','ready','operational'] as const;
const st=(e:unknown)=>(e as {status?:number})?.status;
const code=(e:unknown)=>{const d=(e as {data?:{error?:string}})?.data;return typeof d?.error==='string'?d.error:''};
type Draft={unitId:string;revision:number;floorId:string|null};

export default function FloorReadiness({language,onOpenUnit}:{language:Language;onOpenUnit:(unitId:string)=>void}){
 const t=(k:K)=>L[k][language==='hy'?0:language==='ru'?1:2];
 const [data,setData]=useState<HandoverReadiness>(),[loadErr,setLoadErr]=useState<''|'net'|'denied'|'too_many_units'|'too_many_floors'>('');
 const [rev,setRev]=useState(0),[building,setBuilding]=useState(''),[sel,setSel]=useState('');
 const [draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[err,setErr]=useState(''),[ok,setOk]=useState(''),[stale,setStale]=useState(false);
 const [ent,setEnt]=useState(''),[num,setNum]=useState(''),[fErr,setFErr]=useState(''),[fOk,setFOk]=useState('');
 const attempt=useRef<{p:string;key:string}|undefined>(undefined);
 const floorAttempt=useRef<{p:string;key:string}|undefined>(undefined);
 const keyFor=(p:string)=>{if(attempt.current?.p!==p)attempt.current={p,key:crypto.randomUUID()};return attempt.current.key};
 const floorKeyFor=(p:string)=>{if(floorAttempt.current?.p!==p)floorAttempt.current={p,key:crypto.randomUUID()};return floorAttempt.current.key};

 useEffect(()=>{
  const ab=new AbortController();let seq=0;
  const load=async(force:boolean)=>{const n=++seq;try{const v=await getHandoverReadiness({signal:ab.signal});if(n!==seq||ab.signal.aborted)return;setData(v);setLoadErr('')}
   catch(e){if(n!==seq||ab.signal.aborted)return;const s=st(e),c=code(e);
    if(c==='too_many_units'||c==='too_many_floors'){setData(undefined);setLoadErr(c)}
    else if(s===401||s===403||s===404){setData(undefined);setDraft(null);setSel('');setLoadErr('denied')}
    else setLoadErr('net')}};
  void load(true);const r=()=>{if(document.visibilityState==='visible'&&navigator.onLine)void load(false)};
  const id=setInterval(r,30000);addEventListener('focus',r);addEventListener('online',r);
  return()=>{ab.abort();clearInterval(id);removeEventListener('focus',r);removeEventListener('online',r)};
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[rev]);

 const buildings=useMemo(()=>{const m=new Map<string,string>();data?.units.forEach(u=>m.set(u.buildingId,u.buildingName));return [...m].sort((a,b)=>a[1].localeCompare(b[1]))},[data]);
 const floorsById=useMemo(()=>new Map((data?.floors??[]).map(f=>[f.id,f])),[data]);
 const shown=useMemo(()=>(data?.units??[]).filter(u=>!building||u.buildingId===building),[data,building]);
 const groups=useMemo(()=>{
  const by=new Map<string,{name:string;entrances:Map<string,{floor:HandoverFloor;units:HandoverReadinessUnit[]}[]>;loose:HandoverReadinessUnit[]}>();
  const g=(id:string,name:string)=>{let x=by.get(id);if(!x){x={name,entrances:new Map(),loose:[]};by.set(id,x)}return x};
  for(const [id,name] of buildings)if(!building||id===building)g(id,name);
  for(const f of data?.floors??[]){if(building&&f.buildingId!==building)continue;const b=by.get(f.buildingId);if(!b)continue;const arr=b.entrances.get(f.entrance)??[];arr.push({floor:f,units:[]});b.entrances.set(f.entrance,arr)}
  for(const u of shown){const b=g(u.buildingId,u.buildingName);const f=u.floorId?floorsById.get(u.floorId):undefined;
   const slot=f?b.entrances.get(f.entrance)?.find(s=>s.floor.id===f.id):undefined;if(slot)slot.units.push(u);else b.loose.push(u)}
  for(const b of by.values())for(const arr of b.entrances.values()){arr.sort((a,c)=>c.floor.number-a.floor.number);arr.forEach(s=>s.units.sort((a,c)=>a.number.localeCompare(c.number,undefined,{numeric:true})))}
  return [...by].map(([id,b])=>({id,name:b.name,loose:b.loose.sort((a,c)=>a.number.localeCompare(c.number,undefined,{numeric:true})),entrances:[...b.entrances].sort((a,c)=>a[0].localeCompare(c[0],undefined,{numeric:true}))}));
 },[data,shown,buildings,building,floorsById]);
 const counts=useMemo(()=>{const c:Record<string,number>={};shown.forEach(u=>{c[u.status]=(c[u.status]??0)+1});return c},[shown]);

 const unit=data?.units.find(u=>u.id===sel);
 const canMap=!!data?.canManage;
 function choose(u:HandoverReadinessUnit){if(busy)return;if(draft&&draft.unitId!==u.id&&(stale||draft.floorId!==(data?.units.find(x=>x.id===draft.unitId)?.floorId??null)))return void setErr(t('unsaved'));
  setSel(u.id);setOk('');if(!stale){setErr('');setDraft({unitId:u.id,revision:u.revision,floorId:u.floorId});attempt.current=undefined}}
 function handle(e:unknown,set:(s:string)=>void){const s=st(e);
  if(s===409){setStale(true);set(t('stale'))}else if(s===401||s===403||s===404){setData(undefined);setDraft(null);setSel('');setLoadErr('denied');set(t('denied'))}else if(!s||s>=500)set(t('net'));else set(t('fail')+' ('+(code(e)||s)+')')}
 async function save(){if(!draft||busy||stale)return;setBusy(true);setErr('');setOk('');
  const body={revision:draft.revision,floorId:draft.floorId};
  try{await assignHandoverFloor(draft.unitId,{key:keyFor('a'+draft.unitId+JSON.stringify(body)),...body},{headers:getCsrfHeaders()});
   attempt.current=undefined;setOk(t('saved'));setDraft(null);setSel('');setRev(n=>n+1)}
  catch(e){handle(e,setErr)}finally{setBusy(false)}}
 function reloadReview(){setStale(false);setErr('');setDraft(null);setSel('');attempt.current=undefined;setRev(n=>n+1)}
 const entOk=ent.trim().length>0&&ent.trim().length<=100,numOk=/^-?\d+$/.test(num)&&+num>=-20&&+num<=300;
 async function createFloor(e:FormEvent){e.preventDefault();if(!building||!entOk||!numOk||busy)return;setBusy(true);setFErr('');setFOk('');
  const body={buildingId:building,entrance:ent.trim(),number:+num};
  try{await createHandoverFloor({key:floorKeyFor(JSON.stringify(body)),...body},{headers:getCsrfHeaders()});floorAttempt.current=undefined;setFOk(t('saved'));setNum('');setRev(n=>n+1)}
  catch(x){handle(x,setFErr)}finally{setBusy(false)}}

 const head=<header className="fr-head"><h3>{t('title')}</h3>
  {data&&buildings.length>0&&<label className="fr-field">{t('building')}<select disabled={busy||!!draft} data-testid="select-readiness-building" value={building} onChange={e=>{setBuilding(e.target.value);setFErr('');setFOk('')}}><option value="">{t('all')}</option>{buildings.map(([id,n])=><option key={id} value={id}>{n}</option>)}</select></label>}
  <button type="button" className="p-button" data-testid="button-readiness-refresh" disabled={busy} onClick={reloadReview}>{t('refresh')}</button></header>;
 if(loadErr&&loadErr!=='net'||(!data&&loadErr))return <section className="p-card fr-root" data-testid="floor-readiness">{head}
  <p className="p-error" role="alert" data-testid="text-readiness-error">{loadErr==='too_many_units'?t('tooUnits'):loadErr==='too_many_floors'?t('tooFloors'):loadErr==='denied'?t('denied'):t('error')} <button type="button" className="p-button" data-testid="button-readiness-retry" onClick={()=>setRev(n=>n+1)}>{t('retry')}</button></p></section>;
 if(!data)return <section className="p-card fr-root" data-testid="floor-readiness">{head}<div className="fr-skel" role="status" aria-label={t('loading')}><i/><i/><i/></div></section>;

 const cell=(u:HandoverReadinessUnit)=><li key={u.id}><button type="button" className={'fr-unit fr-s-'+u.status+(u.id===sel?' fr-on':'')} aria-pressed={u.id===sel}
  aria-label={t('unit')+' '+u.number+': '+t(('s_'+u.status) as K)} title={t(('s_'+u.status) as K)} data-testid={'button-readiness-unit-'+u.id} onClick={()=>choose(u)}>
  <span className="fr-num">{u.number}</span><span className="fr-code">{t(('s_'+u.status) as K)}</span>{u.openDefects>0&&<span className="fr-dc">{u.openDefects}</span>}</button></li>;
 const scopedFloors=unit?data.floors.filter(f=>f.buildingId===unit.buildingId).sort((a,b)=>a.entrance.localeCompare(b.entrance,undefined,{numeric:true})||a.number-b.number):[];

 return <section className="p-card fr-root" data-testid="floor-readiness">{head}
  {loadErr==='net'&&<p className="fr-warn" role="status">{t('error')}</p>}
  <div className="fr-legend" aria-label={t('legend')} data-testid="legend-readiness">{STATUSES.map(s=><span key={s} className={'fr-chip fr-s-'+s}><b>{counts[s]??0}</b>{t(('s_'+s) as K)}</span>)}</div>
  {!shown.length?<p className="fr-empty" data-testid="text-readiness-empty">{t('empty')}</p>:
  <div className="fr-grid"><div className="fr-buildings">{groups.map(b=><div key={b.id} className="fr-building" data-testid={'group-building-'+b.id}>
   {!building&&<h4>{b.name}</h4>}
   {b.entrances.map(([e,fl])=><div key={e} className="fr-entrance"><h5>{t('entrance')} {e}</h5>
    <ol className="fr-floors">{fl.map(s=><li key={s.floor.id} className="fr-floor" data-testid={'row-floor-'+s.floor.id}><span className="fr-fl">{s.floor.number}</span>{s.units.length?<ul className="fr-units">{s.units.map(cell)}</ul>:<span className="fr-none">—</span>}</li>)}</ol></div>)}
   {b.loose.length>0&&<div className="fr-entrance fr-loose" data-testid={'group-unassigned-'+b.id}><h5>{t('unassigned')} <small>{b.loose.length} {t('units')}</small></h5><p className="fr-hint">{t('unassignedHint')}</p><ul className="fr-units">{b.loose.map(cell)}</ul></div>}
  </div>)}</div>
  <aside className="fr-side">
   {data.canCreateFloor&&<form className="fr-new" onSubmit={e=>void createFloor(e)} data-testid="form-create-floor"><h4>{t('newFloor')}</h4>
    {!building?<p className="fr-hint">{t('pickBuilding')}</p>:<>
     <div className="fr-row"><label className="fr-field">{t('entrance')}<input disabled={busy} data-testid="input-floor-entrance" type="text" maxLength={100} required value={ent} onChange={e=>setEnt(e.target.value)}/></label>
     <label className="fr-field">{t('floor')}<input disabled={busy} data-testid="input-floor-number" type="number" min={-20} max={300} required value={num} onChange={e=>setNum(e.target.value)}/></label></div>
     <small className="fr-hint">{t('range')}</small>
     <button className="p-button orange" data-testid="button-create-floor" disabled={busy||!entOk||!numOk}>{busy?t('saving'):t('create')}</button></>}
    {fErr&&<p className="p-error" role="alert" data-testid="text-floor-error">{fErr}</p>}{fOk&&<p className="fr-ok" role="status">{fOk}</p>}
   </form>}
   {ok&&<p className="fr-ok" role="status" data-testid="text-readiness-saved">{ok}</p>}
   {unit&&<div className="fr-detail" data-testid="panel-readiness-unit">
    <div className="fr-dhead"><h4>{unit.buildingName} · {t('unit')} {unit.number}</h4><button type="button" className="p-button" data-testid="button-readiness-close" disabled={busy} onClick={()=>{if(!stale){setSel('');setDraft(null);setErr('')}}}>{t('close')}</button></div>
    <span className={'fr-chip fr-s-'+unit.status} data-testid="status-readiness-unit">{t(('s_'+unit.status) as K)}</span>
    <dl className="fr-dl">
     <dt>{t('openDefects')}</dt><dd data-testid="text-open-defects">{unit.openDefects}</dd>
     <dt>{t('pending')}</dt><dd data-testid="text-pending-inspections">{unit.pendingInspections}</dd>
     <dt>{t('done')}</dt><dd data-testid="text-completed-inspections">{unit.completedInspections}</dd>
     <dt>{t('handover')}</dt><dd data-testid="text-handover-status">{unit.handoverStatus&&STATUSES.includes(unit.handoverStatus as typeof STATUSES[number])?t(('s_'+unit.handoverStatus) as K):t('none')}</dd>
    </dl><p className="fr-hint">{t('noAuto')}</p>
    <button type="button" className="p-button" data-testid="button-open-unit-plan" onClick={()=>onOpenUnit(unit.id)}>{t('openPlan')}</button>
    {canMap&&draft?.unitId===unit.id?<div className="fr-map"><label className="fr-field">{t('mapping')}
     <select data-testid="select-unit-floor" value={draft.floorId??''} disabled={busy||stale} onChange={e=>{setDraft({...draft,floorId:e.target.value||null});setOk('')}}>
      <option value="">{t('unlink')}</option>{scopedFloors.map(f=><option key={f.id} value={f.id}>{t('entrance')} {f.entrance} · {t('floor')} {f.number}</option>)}</select></label>
     <small className="fr-hint">{t('revision')} {draft.revision}</small>
     <button type="button" className="p-button orange" data-testid="button-save-floor" disabled={busy||stale||draft.floorId===unit.floorId}  onClick={()=>void save()}>{busy?t('saving'):t('save')}</button></div>
    :!canMap&&<span className="fr-badge">{t('readOnly')}</span>}
    {err&&<p className="p-error" role="alert" data-testid="text-readiness-save-error">{err} {stale&&<button type="button" className="p-button" data-testid="button-readiness-reload" onClick={reloadReview}>{t('reload')}</button>}</p>}
   </div>}
  </aside></div>}
 </section>;
}
