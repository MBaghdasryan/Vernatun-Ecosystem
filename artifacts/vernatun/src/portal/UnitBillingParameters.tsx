import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {request} from './client';
import './unit-billing-parameters.css';

type Props={language:'hy'|'ru'|'en';canManage:boolean};
type Building={id:string|number;name:string};
type Service={id:string|number;name:string;mandatory:boolean};
type Unit={id:string|number;number:string|number;legal_area:string|number|null;billing_area:string|number|null};
type Resident={assignment_id:string|number;user_id:string|number;name:string;role_key:string;resides_here:boolean;counts_for_billing:boolean};
type Quantity={service_id:string|number;service_name:string;quantity:string};
type Applicability={service_id:string|number;service_name:string;enabled:boolean};
type Parameters={resident_count_mode:'AUTO_ACTIVE_RESIDENTS'|'REGISTRY_COUNT'|'MANUAL_COUNT';billing_resident_count:number|null;occupancy_status:'OCCUPIED'|'VACANT'|'UNKNOWN';effective_from:string};
type Detail={unit:Unit;parameters:Parameters|null;residents:Resident[];serviceQuantities:Quantity[];serviceApplicability:Applicability[]};
type Config={buildings:Building[];services:Service[]};
type ResidentEdit=Pick<Resident,'assignment_id'|'resides_here'|'counts_for_billing'>;
type QuantityEdit={service_id:string|number;service_name:string;quantity:string};
type ApplicabilityEdit={service_id:string|number;service_name:string;enabled:boolean};
type Key=keyof typeof TEXT;
const TEXT={
 title:['Միավորի վճարային պարամետրեր','Параметры начисления помещения','Unit billing parameters'],
 intro:['Ստուգեք բնակիչների հաշվարկը, ծառայությունների քանակները և կիրառելիությունը։','Настройте учёт жильцов, количества услуг и их применимость.','Review resident counting, service quantities and applicability.'],
 configuration:['Վճարային կարգավորում','Настройка начислений','Billing configuration'],building:['Շենք','Здание','Building'],chooseBuilding:['Ընտրեք շենքը','Выберите здание','Choose a building'],unit:['Միավոր','Помещение','Unit'],chooseUnit:['Ընտրեք միավորը','Выберите помещение','Choose a unit'],loadingConfig:['Բեռնվում են շենքերը…','Загрузка списка зданий…','Loading buildings…'],loadingUnits:['Բեռնվում են միավորները…','Загрузка помещений…','Loading units…'],loadingDetail:['Բեռնվում են պարամետրերը…','Загрузка параметров…','Loading parameters…'],
 refresh:['Կրկին փորձել','Повторить','Retry'],loadError:['Տվյալները բեռնել չհաջողվեց։','Не удалось загрузить данные.','Could not load the data.'],saveError:['Պարամետրերը չպահպանվեցին։ Ստուգեք տվյալները և փորձեք կրկին։','Не удалось сохранить параметры. Проверьте данные и повторите попытку.','Parameters were not saved. Check the details and try again.'],saved:['Պահպանված է։ Միավորի տվյալները թարմացվել են։','Сохранено. Данные помещения обновлены.','Saved. Unit parameters have been refreshed.'],save:['Պահպանել փոփոխությունները','Сохранить изменения','Save changes'],saving:['Պահպանվում է…','Сохранение…','Saving…'],readOnly:['Դիտման ռեժիմ․ փոփոխությունները հասանելի են միայն կառավարման իրավասությամբ։','Режим просмотра: редактирование доступно только управляющим.','Read-only: editing is available to managers only.'],
 legalArea:['Իրավական մակերես','Юридическая площадь','Legal area'],billingArea:['Հաշվարկային մակերես','Расчётная площадь','Billing area'],billingAreaHelp:['Օգտագործվում է գանձումների հաշվարկում։ Իրավական մակերեսը չի փոխվում։','Используется для расчёта начислений. Юридическая площадь не изменяется.','Used to calculate charges. Legal area is not changed.'],effectiveFrom:['Գործում է ամսից','Действует с месяца','Effective from month'],residents:['Բնակիչներ','Жильцы','Residents'],residentCountMode:['Բնակիչների քանակի եղանակ','Способ подсчёта жильцов','Resident count mode'],autoResidents:['Գործող բնակիչների ավտոմատ հաշվարկ','Автоматически по активным жильцам','Automatically count active residents'],registryCount:['Գրանցամատյանի քանակ','Количество по реестру','Registry count'],manualCount:['Ձեռքով նշված քանակ','Количество вручную','Manual count'],billingResidentCount:['Հաշվարկային բնակիչների քանակ','Количество жильцов для начисления','Residents counted for billing'],occupancyStatus:['Բնակեցման կարգավիճակ','Статус заселения','Occupancy status'],occupied:['Բնակեցված','Заселено','Occupied'],vacant:['Դատարկ','Свободно','Vacant'],unknown:['Անհայտ','Неизвестно','Unknown'],reason:['Փոփոխության պատճառ','Причина изменения','Reason'],reasonHint:['Նշեք՝ ինչու են պարամետրերը փոխվում։','Укажите причину изменения параметров.','Explain why these parameters are changing.'],
 residentName:['Անուն','Имя','Name'],role:['Դեր','Роль','Role'],residesHere:['Բնակվում է այստեղ','Проживает здесь','Resides here'],countsForBilling:['Հաշվարկվում է','Учитывается при начислении','Counts for billing'],serviceQuantities:['Ծառայությունների քանակներ','Количество услуг','Service quantities'],quantity:['Քանակ','Количество','Quantity'],serviceApplicability:['Ծառայությունների կիրառելիություն','Применимость услуг','Service applicability'],enabled:['Կիրառելի է','Применяется','Applicable'],mandatory:['Պարտադիր ծառայություն','Обязательная услуга','Mandatory service'],noBuildings:['Շենքեր չկան։','Зданий нет.','No buildings are available.'],noUnits:['Այս շենքում միավորներ չկան։','В этом здании нет помещений.','This building has no units.'],noResidents:['Բնակիչների տվյալներ չկան։','Данные о жильцах отсутствуют.','No resident records are available.'],noQuantities:['Քանակի պարամետրեր չկան։','Параметры количества отсутствуют.','No quantity parameters are available.'],noApplicability:['Կիրառելիության պարամետրեր չկան։','Параметры применимости отсутствуют.','No applicability parameters are available.'],selectUnitNotice:['Ընտրեք շենքն ու միավորը՝ դրա վճարային պարամետրերը դիտելու համար։','Выберите здание и помещение, чтобы просмотреть параметры начисления.','Choose a building and unit to inspect its billing parameters.'],publishedNote:['Պահպանված և հրապարակված հաշիվները չեն փոխվում այս կարգավորումներով։','Сохранённые и опубликованные счета не изменяются этими настройками.','Saved and published invoices are never changed by these settings.'],emptyParameters:['Այս միավորի համար պարամետրեր սահմանված չեն․ խմբագրեք դաշտերը և պահպանեք։','Для помещения ещё не заданы параметры. Заполните поля и сохраните.','No parameters are set for this unit yet. Enter values and save.'],unitNumber:['Համար','Номер','Number'],chooseMonth:['Ընտրեք ամիսը','Выберите месяц','Choose a month'],optionalEmpty:['Չսահմանված','Не задано','Not set'],quantityHelp:['Մուտքագրեք քանակը որպես տեքստային թիվ։','Введите количество числом.','Enter the quantity as a numeric value.'],
} as const;
function text(language:Props['language'],key:Key){return TEXT[key][language==='hy'?0:language==='ru'?1:2]}
function idString(value:string|number){return String(value)}
function monthValue(value:string|undefined){return value?value.slice(0,7):new Date().toISOString().slice(0,7)}
function areaValue(value:string|number|null){return value==null?'':String(value)}
function localNumber(value:string|number|null|undefined,language:Props['language']){if(value==null)return '—';const number=Number(value);return Number.isFinite(number)?new Intl.NumberFormat(language==='hy'?'hy-AM':language==='ru'?'ru-RU':'en-US',{maximumFractionDigits:2}).format(number):String(value)}
function AreaLabel({title,children,id}:{title:string;children:ReactNode;id:string}){return <label className="ubp-field" htmlFor={id}><span>{title}</span>{children}</label>}
function Alert({message,retry,onRetry}:{message:string;retry:string;onRetry:()=>void}){return <div className="ubp-alert" role="alert" data-testid="status-unit-billing-error"><span>{message}</span><button type="button" className="ubp-button ubp-button-secondary" onClick={onRetry} data-testid="button-unit-billing-retry">{retry}</button></div>}

export default function UnitBillingParameters({language,canManage}:Props){
 const t=useCallback((key:Key)=>text(language,key),[language]);
 const [config,setConfig]=useState<Config|null>(null),[configLoading,setConfigLoading]=useState(true),[configError,setConfigError]=useState(false);
 const [buildingId,setBuildingId]=useState(''),[units,setUnits]=useState<Unit[]>([]),[unitsLoading,setUnitsLoading]=useState(false),[unitsError,setUnitsError]=useState(false),[unitId,setUnitId]=useState('');
 const [detail,setDetail]=useState<Detail|null>(null),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState(false);
 const [billingArea,setBillingArea]=useState(''),[effectiveMonth,setEffectiveMonth]=useState(''),[residentCountMode,setResidentCountMode]=useState<Parameters['resident_count_mode']>('AUTO_ACTIVE_RESIDENTS'),[billingResidentCount,setBillingResidentCount]=useState(''),[occupancyStatus,setOccupancyStatus]=useState<Parameters['occupancy_status']>('UNKNOWN'),[reason,setReason]=useState('');
 const [residentEdits,setResidentEdits]=useState<ResidentEdit[]>([]),[quantityEdits,setQuantityEdits]=useState<QuantityEdit[]>([]),[applicabilityEdits,setApplicabilityEdits]=useState<ApplicabilityEdit[]>([]);
 const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState(false),[saved,setSaved]=useState(false);
 const initializedUnit=useRef<string|null>(null);
 const currentBuildingId=useRef(buildingId),currentUnitId=useRef(unitId);
 currentBuildingId.current=buildingId;currentUnitId.current=unitId;

 const loadConfig=useCallback(async()=>{setConfigLoading(true);setConfigError(false);try{setConfig(await request<Config>('/finance/configuration'))}catch{setConfigError(true)}finally{setConfigLoading(false)}},[]);
 useEffect(()=>{void loadConfig()},[loadConfig]);
 const loadDetail=useCallback(async(id:string)=>{setDetailLoading(true);setDetailError(false);try{const result=await request<Detail>(`/properties/${encodeURIComponent(id)}/billing-parameters`);if(id===currentUnitId.current)setDetail(result)}catch{if(id===currentUnitId.current){setDetail(null);setDetailError(true)}}finally{if(id===currentUnitId.current)setDetailLoading(false)}},[]);
 useEffect(()=>{
  if(!buildingId){setUnits([]);setUnitsError(false);return}
  let current=true;setUnitsLoading(true);setUnitsError(false);setUnits([]);
  void request<Unit[]>(`/finance/buildings/${encodeURIComponent(buildingId)}/units`).then(result=>{if(current)setUnits(result)}).catch(()=>{if(current)setUnitsError(true)}).finally(()=>{if(current)setUnitsLoading(false)});
  return()=>{current=false};
 },[buildingId]);
 useEffect(()=>{
  if(!unitId){setDetail(null);setDetailError(false);setDetailLoading(false);return}
  let current=true;setDetail(null);setDetailLoading(true);setDetailError(false);
  void request<Detail>(`/properties/${encodeURIComponent(unitId)}/billing-parameters`).then(result=>{if(current)setDetail(result)}).catch(()=>{if(current)setDetailError(true)}).finally(()=>{if(current)setDetailLoading(false)});
  return()=>{current=false};
 },[unitId]);
 useEffect(()=>{
  if(!detail)return;
  const loadedUnitId=idString(detail.unit.id);
  if(initializedUnit.current===loadedUnitId)return;
  initializedUnit.current=loadedUnitId;
  setBillingArea(areaValue(detail.unit.billing_area));
  setEffectiveMonth(monthValue(detail.parameters?.effective_from));
  setResidentCountMode(detail.parameters?.resident_count_mode??'AUTO_ACTIVE_RESIDENTS');
  setBillingResidentCount(detail.parameters?.billing_resident_count==null?'':String(detail.parameters.billing_resident_count));
  setOccupancyStatus(detail.parameters?.occupancy_status??'UNKNOWN');
  setReason('');
  setResidentEdits(detail.residents.map(r=>({assignment_id:r.assignment_id,resides_here:r.resides_here,counts_for_billing:r.counts_for_billing})));
  setQuantityEdits(detail.serviceQuantities.map(q=>({service_id:q.service_id,service_name:q.service_name,quantity:String(q.quantity)})));
  setApplicabilityEdits(detail.serviceApplicability.map(a=>({service_id:a.service_id,service_name:a.service_name,enabled:a.enabled})));
  setSaveError(false);setSaved(false);
 },[detail]);
 const serviceNames=useMemo(()=>new Map((config?.services??[]).map(s=>[idString(s.id),s.name])),[config]);
 const buildingName=config?.buildings.find(b=>idString(b.id)===buildingId)?.name??'';
 const selectedUnit=detail?.unit;
 function updateResident(id:string|number,key:'resides_here'|'counts_for_billing',value:boolean){setResidentEdits(rows=>rows.map(row=>idString(row.assignment_id)===idString(id)?{...row,[key]:value}:row))}
 function updateQuantity(id:string|number,value:string){setQuantityEdits(rows=>rows.map(row=>idString(row.service_id)===idString(id)?{...row,quantity:value}:row))}
 function updateApplicability(id:string|number,value:boolean){setApplicabilityEdits(rows=>rows.map(row=>idString(row.service_id)===idString(id)?{...row,enabled:value}:row))}
 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!canManage||!unitId||saving)return;
  setSaving(true);setSaveError(false);setSaved(false);
  const body={
   effectiveFrom:`${effectiveMonth}-01`,
   billingArea:billingArea.trim()===''?null:Number(billingArea),
   residentCountMode,
   billingResidentCount:billingResidentCount.trim()===''?null:Number(billingResidentCount),
   occupancyStatus,
   reason:reason.trim(),
   residents:residentEdits.map(r=>({assignmentId:r.assignment_id,residesHere:r.resides_here,countsForBilling:r.counts_for_billing})),
   serviceQuantities:quantityEdits.map(q=>({serviceId:q.service_id,quantity:q.quantity})),
   serviceApplicability:applicabilityEdits.map(a=>({serviceId:a.service_id,enabled:a.enabled})),
  };
  try{await request<void>(`/properties/${encodeURIComponent(unitId)}/billing-parameters`,'PATCH',body);setSaved(true);try{const result=await request<Detail>(`/properties/${encodeURIComponent(unitId)}/billing-parameters`);setDetail(result);setDetailError(false)}catch{setDetailError(true)}}
  catch{setSaveError(true)}
  finally{setSaving(false)}
 }
 const noBuildings=(config?.buildings.length??0)===0;
 return <section className="ubp-shell" aria-label={t('title')} data-testid="unit-billing-parameters">
  <header className="ubp-header"><div><span className="ubp-kicker">VERNATUN OS / FINANCE</span><h2>{t('title')}</h2><p>{t('intro')}</p></div><span className="ubp-header-mark" aria-hidden="true">UB</span></header>
  <div className="ubp-notices"><p className="ubp-note"><span className="ubp-note-mark" aria-hidden="true">i</span>{t('billingAreaHelp')}</p><p className="ubp-note ubp-note-invoice"><span className="ubp-note-mark" aria-hidden="true">!</span>{t('publishedNote')}</p></div>
  {configLoading&&!config?<div className="ubp-loading" role="status" data-testid="status-unit-billing-loading"><span>{t('loadingConfig')}</span><i/><i/></div>:configError?<Alert message={t('loadError')} retry={t('refresh')} onRetry={()=>void loadConfig()}/>:config&&<div className="ubp-body">
   <div className="ubp-selectors">
    <AreaLabel title={t('building')} id="ubp-building"><select id="ubp-building" value={buildingId} onChange={e=>{setBuildingId(e.target.value);setUnitId('');setDetail(null);setSaved(false);setSaveError(false)}} data-testid="select-unit-billing-building"><option value="">{t('chooseBuilding')}</option>{config.buildings.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></AreaLabel>
    <AreaLabel title={t('unit')} id="ubp-unit"><select id="ubp-unit" value={unitId} disabled={!buildingId||unitsLoading||unitsError||units.length===0} onChange={e=>{setUnitId(e.target.value);setSaved(false);setSaveError(false)}} data-testid="select-unit-billing-unit"><option value="">{t('chooseUnit')}</option>{units.map(u=><option key={u.id} value={u.id}>{u.number}</option>)}</select></AreaLabel>
    {buildingId&&<span className="ubp-context" data-testid="text-unit-billing-building">{buildingName}</span>}
   </div>
   {noBuildings?<div className="ubp-empty" data-testid="empty-unit-billing-buildings"><span className="ubp-empty-index">01</span><p>{t('noBuildings')}</p></div>:null}
   {unitsLoading&&<div className="ubp-inline-loading" role="status" data-testid="status-unit-list-loading">{t('loadingUnits')}</div>}
   {unitsError&&<Alert message={t('loadError')} retry={t('refresh')} onRetry={()=>{const target=buildingId;setUnitsLoading(true);setUnitsError(false);void request<Unit[]>(`/finance/buildings/${encodeURIComponent(target)}/units`).then(result=>{if(target===currentBuildingId.current)setUnits(result)}).catch(()=>{if(target===currentBuildingId.current)setUnitsError(true)}).finally(()=>{if(target===currentBuildingId.current)setUnitsLoading(false)})}}/>}
   {buildingId&&!unitsLoading&&!unitsError&&units.length===0&&<div className="ubp-empty" data-testid="empty-unit-billing-units"><span className="ubp-empty-index">02</span><p>{t('noUnits')}</p></div>}
   {!unitId&&!noBuildings&&<div className="ubp-select-prompt" data-testid="empty-unit-billing-selection"><span className="ubp-empty-index">03</span><p>{t('selectUnitNotice')}</p></div>}
   {detailLoading&&<div className="ubp-inline-loading" role="status" data-testid="status-unit-parameters-loading">{t('loadingDetail')}</div>}
   {detailError&&<Alert message={t('loadError')} retry={t('refresh')} onRetry={()=>{if(unitId)void loadDetail(unitId)}}/>}
   {detail&&selectedUnit&&<form className="ubp-editor" onSubmit={e=>void save(e)} data-testid="form-unit-billing-parameters">
    <div className="ubp-unit-heading"><div><span className="ubp-kicker">{t('configuration')} / {buildingName}</span><h3>{t('unit')} {selectedUnit.number}</h3></div><span className="ubp-unit-area">{t('legalArea')} <b>{localNumber(selectedUnit.legal_area,language)}</b></span></div>
    {!detail.parameters&&<p className="ubp-first-setup" data-testid="status-unit-billing-unconfigured">{t('emptyParameters')}</p>}
    {!canManage&&<div className="ubp-readonly" role="note" data-testid="status-unit-billing-readonly">{t('readOnly')}</div>}
    {saved&&<div className="ubp-success" role="status" data-testid="status-unit-billing-saved">{t('saved')}</div>}
    {saveError&&<div className="ubp-alert" role="alert" data-testid="status-unit-billing-save-error">{t('saveError')}</div>}
    <fieldset className="ubp-fieldset" disabled={!canManage||saving}>
     <div className="ubp-form-grid">
      <AreaLabel title={t('billingArea')} id="ubp-billing-area"><input id="ubp-billing-area" type="number" min="0" step="0.01" value={billingArea} onChange={e=>setBillingArea(e.target.value)} data-testid="input-unit-billing-area"/></AreaLabel>
      <AreaLabel title={t('effectiveFrom')} id="ubp-effective-month"><input id="ubp-effective-month" type="month" required value={effectiveMonth} onChange={e=>setEffectiveMonth(e.target.value)} aria-label={`${t('effectiveFrom')} · ${t('chooseMonth')}`} data-testid="input-unit-billing-effective-from"/></AreaLabel>
      <AreaLabel title={t('residentCountMode')} id="ubp-resident-mode"><select id="ubp-resident-mode" value={residentCountMode} onChange={e=>setResidentCountMode(e.target.value as Parameters['resident_count_mode'])} data-testid="select-unit-billing-resident-mode"><option value="AUTO_ACTIVE_RESIDENTS">{t('autoResidents')}</option><option value="REGISTRY_COUNT">{t('registryCount')}</option><option value="MANUAL_COUNT">{t('manualCount')}</option></select></AreaLabel>
      <AreaLabel title={t('billingResidentCount')} id="ubp-resident-count"><input id="ubp-resident-count" type="number" min="0" step="1" value={billingResidentCount} required={residentCountMode==='MANUAL_COUNT'} onChange={e=>setBillingResidentCount(e.target.value)} data-testid="input-unit-billing-resident-count"/></AreaLabel>
      <AreaLabel title={t('occupancyStatus')} id="ubp-occupancy-status"><select id="ubp-occupancy-status" value={occupancyStatus} onChange={e=>setOccupancyStatus(e.target.value as Parameters['occupancy_status'])} data-testid="select-unit-billing-occupancy"><option value="OCCUPIED">{t('occupied')}</option><option value="VACANT">{t('vacant')}</option><option value="UNKNOWN">{t('unknown')}</option></select></AreaLabel>
     </div>
     <section className="ubp-data-section" aria-labelledby="ubp-residents-heading"><div className="ubp-section-title"><div><span className="ubp-kicker">01 / {t('residents')}</span><h4 id="ubp-residents-heading">{t('residents')}</h4></div><span className="ubp-count">{residentEdits.length.toString().padStart(2,'0')}</span></div>
      {residentEdits.length===0?<p className="ubp-subtle-empty" data-testid="empty-unit-billing-residents">{t('noResidents')}</p>:<div className="ubp-record-list">{detail.residents.map(resident=>{const edit=residentEdits.find(r=>idString(r.assignment_id)===idString(resident.assignment_id));return <div className="ubp-resident-row" key={resident.assignment_id} data-testid={`row-unit-billing-resident-${resident.assignment_id}`}><div className="ubp-record-copy"><strong>{resident.name}</strong><span>{resident.role_key}</span></div><label className="ubp-toggle"><input type="checkbox" checked={edit?.resides_here??resident.resides_here} onChange={e=>updateResident(resident.assignment_id,'resides_here',e.target.checked)} data-testid={`input-resident-resides-${resident.assignment_id}`}/><span>{t('residesHere')}</span></label><label className="ubp-toggle"><input type="checkbox" checked={edit?.counts_for_billing??resident.counts_for_billing} onChange={e=>updateResident(resident.assignment_id,'counts_for_billing',e.target.checked)} data-testid={`input-resident-counts-${resident.assignment_id}`}/><span>{t('countsForBilling')}</span></label></div>})}</div>}
     </section>
     <section className="ubp-data-section" aria-labelledby="ubp-quantities-heading"><div className="ubp-section-title"><div><span className="ubp-kicker">02 / {t('serviceQuantities')}</span><h4 id="ubp-quantities-heading">{t('serviceQuantities')}</h4></div><span className="ubp-count">{quantityEdits.length.toString().padStart(2,'0')}</span></div>
      {quantityEdits.length===0?<p className="ubp-subtle-empty" data-testid="empty-unit-billing-quantities">{t('noQuantities')}</p>:<div className="ubp-record-list">{quantityEdits.map(q=><div className="ubp-quantity-row" key={q.service_id} data-testid={`row-unit-billing-quantity-${q.service_id}`}><div className="ubp-record-copy"><strong>{serviceNames.get(idString(q.service_id))??q.service_name}</strong><span>{q.service_name}</span></div><AreaLabel title={t('quantity')} id={`ubp-quantity-${q.service_id}`}><input id={`ubp-quantity-${q.service_id}`} type="text" inputMode="decimal" value={q.quantity} onChange={e=>updateQuantity(q.service_id,e.target.value)} aria-label={`${t('quantity')} · ${serviceNames.get(idString(q.service_id))??q.service_name}`} data-testid={`input-service-quantity-${q.service_id}`}/></AreaLabel></div>)}</div>}
      <p className="ubp-field-help">{t('quantityHelp')}</p>
     </section>
     <section className="ubp-data-section" aria-labelledby="ubp-applicability-heading"><div className="ubp-section-title"><div><span className="ubp-kicker">03 / {t('serviceApplicability')}</span><h4 id="ubp-applicability-heading">{t('serviceApplicability')}</h4></div><span className="ubp-count">{applicabilityEdits.length.toString().padStart(2,'0')}</span></div>
      {applicabilityEdits.length===0?<p className="ubp-subtle-empty" data-testid="empty-unit-billing-applicability">{t('noApplicability')}</p>:<div className="ubp-record-list">{applicabilityEdits.map(a=>{const service=config.services.find(s=>idString(s.id)===idString(a.service_id));return <label className="ubp-app-row" key={a.service_id} data-testid={`row-service-applicability-${a.service_id}`}><span className="ubp-record-copy"><strong>{service?.name??a.service_name}</strong>{service?.mandatory&&<small>{t('mandatory')}</small>}</span><span className="ubp-toggle"><input type="checkbox" checked={a.enabled} onChange={e=>updateApplicability(a.service_id,e.target.checked)} data-testid={`input-service-applicable-${a.service_id}`}/><span>{t('enabled')}</span></span></label>})}</div>}
     </section>
     <AreaLabel title={t('reason')} id="ubp-reason"><textarea id="ubp-reason" required minLength={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} placeholder={t('reasonHint')} data-testid="input-unit-billing-reason"/></AreaLabel>
    </fieldset>
    <footer className="ubp-footer"><p>{t('publishedNote')}</p>{canManage&&<button className="ubp-button ubp-button-primary" disabled={saving||!effectiveMonth||!reason.trim()|| (residentCountMode==='MANUAL_COUNT'&&billingResidentCount==='')} data-testid="button-save-unit-billing">{saving?t('saving'):t('save')}</button>}</footer>
   </form>}
  </div>}
 </section>
}
