import {useEffect,useRef,useState} from 'react';
import type {BillingBatchInput,BillingDraftInput,BillingPublicationInput} from '@workspace/api-client-react';
import {request} from './client';
import {BusinessTable} from './Business';
import {usePolling} from './Phase2';
import {money,date,type Language,type Currency} from './i18n';
import {ft,codeText,useIntent,type Row} from './finance-util';
import type {RoleContext} from './types';
const snap=(b:Row):Row=>typeof b.snapshot==='string'?JSON.parse(b.snapshot):(b.snapshot??{});
const warnsOf=(s:Row):Row[]=>[...(s.skipped??[]),...(s.warnings??[])];
export default function BillingBatches({c,language,currency}:{c:RoleContext;language:Language;currency:Currency}){
 const t=(k:Parameters<typeof ft>[1])=>ft(language,k);const can=(p:string)=>c.permissions.includes(p);
 const [batches,setBatches]=useState<Row[]>();const [buildings,setBuildings]=useState<Row[]>([]);const [tariffs,setTariffs]=useState<Row[]>([]);const [error,setError]=useState('');const [ok,setOk]=useState('');
 const [form,setForm]=useState({buildingId:c.building_id??'',period:'',tariffId:''});const [prev,setPrev]=useState<Row>();const [prevBusy,setPrevBusy]=useState(false);
 const [selId,setSelId]=useState<string>();const [selVersion,setSelVersion]=useState(0);const [ack,setAck]=useState(false);
 const scope=c.id+'|'+currency;const key=useRef(scope);key.current=scope;const seq=useRef(0);const live=()=>key.current===scope;
 const draft=useIntent(),act=useIntent();const scopeLive=(id:string)=>()=>key.current===id;
 async function load(){const id=scope;const n=++seq.current;try{const [b,f]=await Promise.all([request<Row[]>('/finance/batches'),request<Row>('/finance?currency='+currency)]);if(id!==key.current||n!==seq.current)return;setBatches(b);setTariffs(f.tariffs??[]);setError('')}catch(e){if(id===key.current&&n===seq.current)setError(codeText(language,e))}}
 useEffect(()=>{seq.current++;setBatches(undefined);setBuildings([]);setTariffs([]);setPrev(undefined);setSelId(undefined);setAck(false);setOk('');setError('');draft.reset();act.reset();setForm({buildingId:c.building_id??'',period:'',tariffId:''});const sc=scope;request<Row[]>('/properties').then(r=>{if(key.current===sc)setBuildings(c.building_id?r.filter(x=>x.id===c.building_id):r)}).catch(e=>{if(key.current===sc)setError(codeText(language,e))});void load()},[c.id,currency]);
 usePolling(()=>void load(),[c.id,currency],false);
 const frozen=draft.uncertain||act.uncertain;
 const input=():BillingBatchInput=>({buildingId:form.buildingId,period:form.period+'-01',tariffId:form.tariffId});
 const edit=(v:Partial<typeof form>)=>{if(frozen||draft.pending)return;setForm({...form,...v});setPrev(undefined)};
 async function doPreview(){if(prevBusy)return;const id=scope;setPrevBusy(true);setError('');setOk('');try{const r=await request<Row>('/finance/batches/preview','POST',input());if(live()&&id===scope)setPrev(r)}catch(e){if(live())setError(codeText(language,e))}finally{setPrevBusy(false)}}
 async function save(){const id=scope;setError('');setOk('');try{const r=await draft.send<Row>('/finance/batches',k=>({...input(),key:k} satisfies BillingDraftInput),scopeLive(id));if(!live()||!r)return;setOk(t('done'));setPrev(undefined);await load()}catch(e){if(live())setError(codeText(language,e))}}
 const sel=batches?.find(b=>b.id===selId);const ss=sel?snap(sel):undefined;const sw=ss?warnsOf(ss):[];
 async function transition(action:'publish'|'cancel'){if(!sel)return;const id=scope;setError('');setOk('');try{const r=await act.send<Row>('/finance/batches/'+sel.id+'/'+action,k=>({key:k,version:selVersion,...(action==='publish'?{acceptWarnings:ack}:{})} satisfies BillingPublicationInput),scopeLive(id));if(!live()||!r)return;setOk(t('done'));setAck(false);await load()}catch(e){if(live())setError(codeText(language,e));void load()}}
 const selectBatch=(r:Row)=>{if(act.uncertain)return;setSelId(r.id);setSelVersion(r.version);setAck(false)};
 const stale=!!sel&&sel.version!==selVersion;const tariff=tariffs.find(x=>x.id===form.tariffId);
 const cur=(prev?.tariff?.currency??tariff?.currency??currency) as Currency;
 return <section className="p-card" aria-busy={prevBusy||draft.pending||act.pending}><header><h2>{t('batches')}</h2><button className="p-button" onClick={()=>void load()}>{t('refresh')}</button></header>
  {error&&<p className="p-error" role="alert">{error}</p>}{ok&&<p role="status">{ok}</p>}
  {frozen&&<div className="p-info" role="alert"><p>{t('uncertain')}</p>{draft.uncertain&&<button className="p-button" disabled={draft.pending} onClick={()=>void save()}>{t('retrySame')}</button>}{act.uncertain&&sel&&<button className="p-button" disabled={act.pending} onClick={()=>void transition(sel.status==='draft'&&ack?'publish':'cancel')}>{t('retrySame')}</button>}<button className="p-button" onClick={()=>{draft.reset();act.reset();void load()}}>{t('abandon')}</button></div>}
  {!batches&&!error&&<p role="status">{t('loading')}</p>}{batches&&!batches.length&&<p>{t('empty')}</p>}
  {batches&&<BusinessTable rows={batches.map(b=>{const s=snap(b);return {...b,status:b.status,unitCount:s.unitCount,total:s.totalMinor!=null?money(String(s.totalMinor),(s.tariff?.currency??currency) as Currency,language):'',pd:b.period?date(b.period,language):''}})} columns={[["pd","period"],["unitCount","units"],["total","total"],["status","status"]] as [string,string][]} language={language} onSelect={selectBatch}/>}
  {sel&&ss&&<div className="p-card"><h3>{ss.tariff?.name} · {ss.unitCount} {t('units')} · {money(String(ss.totalMinor),(ss.tariff?.currency??currency) as Currency,language)}</h3>
   {stale&&<p className="p-info">{t('stale_version')} <button className="p-button" disabled={act.pending||act.uncertain} onClick={()=>setSelVersion(sel.version)}>{t('useLatest')}</button></p>}
   {sw.length>0&&<><h4>{t('warnings')}</h4>{sw.map((w,i)=><p key={i} className="p-info">{w.number??w.unitId} · {w.code}</p>)}</>}
   {sel.status==='draft'?<>{sw.length>0&&<label className="p-check-item"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>{t('ackWarnings')}</label>}
    <div className="p-modal-actions">{can('billing.publish')&&<button className="p-button orange" disabled={act.pending||frozen||stale||(sw.length>0&&!ack)} onClick={()=>void transition('publish')}>{t('publish')}</button>}<button className="p-button" disabled={act.pending||frozen||stale} onClick={()=>void transition('cancel')}>{t('cancel')}</button></div></>:<p>{t('publishedNote')}</p>}
   <ChargesTable s={ss} cur={(ss.tariff?.currency??currency) as Currency} language={language}/></div>}
  {can('billing.calculate')&&<form className="p-edit-form" onSubmit={e=>{e.preventDefault();void doPreview()}}><h3>{t('preview')}</h3>
   <label>{t('building')}<select required value={form.buildingId} disabled={!!c.building_id||frozen||draft.pending} onChange={e=>edit({buildingId:e.target.value})}><option value="">—</option>{buildings.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
   <label>{t('period')}<input type="month" required value={form.period} disabled={frozen||draft.pending} onChange={e=>edit({period:e.target.value})}/></label>
   <label>{t('tariff')}<select required value={form.tariffId} disabled={frozen||draft.pending} onChange={e=>edit({tariffId:e.target.value})}><option value="">—</option>{tariffs.map(x=><option key={x.id} value={x.id}>{x.name} · {money(String(x.amount_minor),x.currency,language)}</option>)}</select></label>
   <button className="p-button" disabled={prevBusy||frozen||!form.buildingId||!form.period||!form.tariffId}>{t('preview')}</button></form>}
  {prev&&<div className="p-card"><h3>{prev.tariff?.name} · {prev.unitCount} {t('units')} · {prev.chargeCount} {t('charges')} · {money(String(prev.totalMinor),cur,language)}</h3>
   {warnsOf(prev).length>0&&<><h4>{t('warnings')}</h4>{warnsOf(prev).map((w,i)=><p key={i} className="p-info">{w.number??w.unitId} · {w.code}</p>)}</>}
   <ChargesTable s={prev} cur={cur} language={language}/><p className="p-info">{t('draftNote')}</p><button className="p-button orange" disabled={draft.pending||frozen} onClick={()=>void save()}>{t('saveDraft')}</button></div>}
 </section>}
function ChargesTable({s,cur,language}:{s:Row;cur:Currency;language:Language}){return <BusinessTable rows={(s.charges??[]).map((x:Row)=>({...x,id:x.unitId,amount:money(String(x.amountMinor),cur,language)}))} columns={[["number","unit"],["amount","amount"]]} language={language}/>}
