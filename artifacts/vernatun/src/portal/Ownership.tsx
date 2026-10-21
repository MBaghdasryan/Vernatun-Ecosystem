import {useState,type FormEvent} from 'react';
import type {Language} from './i18n';
import type {RoleContext} from './types';
import {calendarDay} from './calendar-date';
import {Dlg,Fail,Frozen,useFrozen,useMounted,useLoad,LoadFail,Empty,p6,bp,parsePct,dayText,fmt,g,ISO_DAY,type Row} from './phase6-ui';

function state(r:Row,today:string,l:Language){const s=String(g(r,'starts_on')).slice(0,10),e=g(r,'ends_on')?String(g(r,'ends_on')).slice(0,10):'';return e&&e<today?p6(l,'ownEnded'):s>today?p6(l,'ownFuture'):p6(l,'ownActive')}
const todayIso=()=>calendarDay();

function EndDialog({l,row,onClose,onDone}:{l:Language;row:Row;onClose:()=>void;onDone:()=>void}){
 const h=useFrozen(),live=useMounted();const [endsOn,setEnds]=useState(''),[reason,setReason]=useState(''),[err,setErr]=useState<unknown>(),[bad,setBad]=useState(false);
 async function go(e:FormEvent){e.preventDefault();setErr(undefined);if(!ISO_DAY.test(endsOn)||reason.trim().length<3){setBad(true);return}setBad(false);
  try{const r=await h.send('POST','/ownerships/'+row.id+'/end',key=>({key,version:row.version,endsOn,reason:reason.trim()}),()=>live.current);if(r!==undefined&&live.current)onDone()}catch(x){if(live.current)setErr(x)}}
 async function retry(){try{const r=await h.retry(()=>live.current);if(r!==undefined&&live.current)onDone()}catch(x){if(live.current)setErr(x)}}
 return <Dlg l={l} title={p6(l,'ownEnd')+' · '+row.number} onClose={onClose}><form className="p-edit-form" onSubmit={e=>void go(e)}>
  <label>{p6(l,'ends')}<input type="date" required value={endsOn} disabled={h.uncertain} onChange={e=>setEnds(e.target.value)}/></label>
  <label>{p6(l,'reason')}<textarea required minLength={3} maxLength={1000} value={reason} disabled={h.uncertain} onChange={e=>setReason(e.target.value)}/></label>
  {bad&&<p className="p-error" role="alert">{p6(l,'invalid')}</p>}<Fail l={l} error={err} onRefresh={onDone}/>
  <Frozen l={l} h={h} onRetry={()=>void retry()} onAbandon={onClose}/>
  <button className="p-button orange" disabled={h.pending||h.uncertain}>{h.pending?p6(l,'saving'):p6(l,'ownEnd')}</button></form></Dlg>}

export default function Ownership({c,language:l}:{c:RoleContext;language:Language}){
 const manage=c.permissions.includes('ownership.manage')&&c.role_key!=='unit_owner';
 const [unitFilter,setUnitFilter]=useState('');
 const list=useLoad<Row[]>('/ownerships'+(unitFilter?'?unitId='+encodeURIComponent(unitFilter):''),[c.id]);
 const units=useLoad<Row[]>(manage?'/units':null,[c.id]),cands=useLoad<Row[]>(manage?'/ownerships/candidates':null,[c.id]),docs=useLoad<Row[]>(manage&&c.permissions.includes('documents.read')?'/documents':null,[c.id]);
 const [sel,setSel]=useState<string>(''),[ending,setEnding]=useState<Row>();
 const h=useFrozen(),live=useMounted();
 const [f,setF]=useState({unitId:'',userId:'',startsOn:'',endsOn:'',share:'',basis:'',basisDocumentId:''}),[err,setErr]=useState<unknown>(),[bad,setBad]=useState(false);
 const row=list.data?.find(r=>r.id===sel);
 async function create(e:FormEvent){e.preventDefault();setErr(undefined);const bps=parsePct(f.share);
  if(!f.unitId||!f.userId||!ISO_DAY.test(f.startsOn)||(f.endsOn&&(!ISO_DAY.test(f.endsOn)||f.endsOn<f.startsOn))||bps===null||f.basis.trim().length<3){setBad(true);return}setBad(false);
  try{const r=await h.send('POST','/ownerships',key=>({key,unitId:f.unitId,userId:f.userId,startsOn:f.startsOn,endsOn:f.endsOn||null,shareBasisPoints:bps,basis:f.basis.trim(),...(f.basisDocumentId?{basisDocumentId:f.basisDocumentId}:{})}),()=>live.current);
   if(r!==undefined&&live.current){setF({unitId:'',userId:'',startsOn:'',endsOn:'',share:'',basis:'',basisDocumentId:''});list.reload()}}catch(x){if(live.current)setErr(x)}}
 async function retry(){try{const r=await h.retry(()=>live.current);if(r!==undefined&&live.current){setF({unitId:'',userId:'',startsOn:'',endsOn:'',share:'',basis:'',basisDocumentId:''});list.reload()}}catch(x){if(live.current)setErr(x)}}
 const dis=h.uncertain;const set=(k:keyof typeof f)=>(e:{target:{value:string}})=>setF({...f,[k]:e.target.value});
 return <div className="p5"><div className="p5-split"><section className="p-card"><header><h2>{p6(l,'ownership')}</h2><button className="p-button small" onClick={list.reload}>{p6(l,'refresh')}</button></header>
  {!manage&&<p className="p-info">{p6(l,'ownOnlyOwn')}</p>}
  {manage&&<div className="p5-filters"><label>{p6(l,'filterUnit')}<select value={unitFilter} onChange={e=>{setUnitFilter(e.target.value);setSel('')}}><option value="">{p6(l,'all')}</option>{units.data?.map(u=><option key={u.id} value={u.id}>{u.building_name} · {u.number}</option>)}</select></label></div>}
  <LoadFail l={l} error={list.error} onRetry={list.reload}/>
  {!list.data&&!list.error?<p role="status">{p6(l,'loading')}</p>:list.data&&(list.data.length===0?<Empty l={l}/>:<div className="p6-scroll"><table><thead><tr><th>{p6(l,'unit')}</th><th>{p6(l,'owner')}</th><th>{p6(l,'share')}</th><th>{p6(l,'starts')}</th><th>{p6(l,'ends')}</th><th>{p6(l,'status')}</th></tr></thead><tbody>{list.data.map(r=><tr key={r.id} aria-selected={sel===r.id}><td><button className="p-button small" onClick={()=>setSel(r.id)}>{r.building_name?r.building_name+' · ':''}{r.number}</button></td><td>{r.owner_name??'—'}</td><td className="p6-num">{bp(r.share_basis_points)}</td><td>{dayText(r.starts_on,l)}</td><td>{r.ends_on?dayText(r.ends_on,l):'—'}</td><td>{state(r,todayIso(),l)}</td></tr>)}</tbody></table></div>)}
  </section>
  <div className="p5">{row&&<section className="p-card"><header><h2>{row.number} · {row.owner_name}</h2>{manage&&!row.ends_on&&<button className="p-button orange small" onClick={()=>setEnding(row)}>{p6(l,'ownEnd')}</button>}</header>
   <p><strong>{p6(l,'basis')}:</strong> {row.basis}</p>{row.basis_version_id&&<p className="p5-muted">{p6(l,'basisDoc')}: {String(row.basis_version_id).slice(0,8)}</p>}
   <h3>{p6(l,'history')}</h3>{(row.history??[]).length===0?<Empty l={l}/>:<ul className="p5-timeline">{(row.history as Row[]).map((x,i)=><li className="p5-msg" key={i}><strong>{x.action}</strong><small>{x.created_at&&new Date(x.created_at).getTime()>86400000?fmt(x.created_at,l):p6(l,'unknownDate')}</small>{x.reason&&<p>{x.reason}</p>}{x.snapshot&&<details><summary>{p6(l,'snapshot')}</summary><pre className="p6-pre">{JSON.stringify(x.snapshot,null,1)}</pre></details>}</li>)}</ul>}</section>}
  {manage&&<form className="p-card p-edit-form" onSubmit={e=>void create(e)}><h3>{p6(l,'ownNew')}</h3><p className="p5-muted">{p6(l,'ownNote')}</p>
   <label>{p6(l,'unit')}<select required value={f.unitId} disabled={dis} onChange={set('unitId')}><option value="">—</option>{units.data?.map(u=><option key={u.id} value={u.id}>{u.building_name} · {u.number}</option>)}</select></label>
   <label>{p6(l,'candidate')}<select required value={f.userId} disabled={dis} onChange={set('userId')}><option value="">—</option>{cands.data?.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select><small>{p6(l,'candNote')}</small></label>
   <div className="p5-grid2"><label>{p6(l,'starts')}<input type="date" required value={f.startsOn} disabled={dis} onChange={set('startsOn')}/></label><label>{p6(l,'ends')}<input type="date" value={f.endsOn} min={f.startsOn||undefined} disabled={dis} onChange={set('endsOn')}/></label></div>
   <label>{p6(l,'share')} (%)<input inputMode="decimal" required pattern="\d{1,3}([.,]\d{1,2})?" placeholder="25.00" value={f.share} disabled={dis} onChange={set('share')}/>{f.share&&parsePct(f.share)!==null&&<small>{parsePct(f.share)} bp</small>}</label>
   <label>{p6(l,'basis')}<textarea required minLength={3} maxLength={1000} value={f.basis} disabled={dis} onChange={set('basis')}/></label>
   {docs.data&&<label>{p6(l,'basisDoc')}<select value={f.basisDocumentId} disabled={dis} onChange={set('basisDocumentId')}><option value="">—</option>{docs.data.map(d=><option key={d.id} value={d.id}>{d.title}</option>)}</select></label>}
   {bad&&<p className="p-error" role="alert">{p6(l,'invalid')}</p>}<Fail l={l} error={err}/>
   <Frozen l={l} h={h} onRetry={()=>void retry()} onAbandon={()=>list.reload()}/>
   <button className="p-button orange" disabled={h.pending||dis}>{h.pending?p6(l,'saving'):p6(l,'create')}</button></form>}
  </div></div>
  {ending&&<EndDialog l={l} row={ending} onClose={()=>setEnding(undefined)} onDone={()=>{setEnding(undefined);list.reload()}}/>}</div>}
