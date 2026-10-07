import {useState,type FormEvent,type ReactNode} from 'react';
import type {Language} from './i18n';
import type {RoleContext} from './types';
import {Dlg,Fail,Frozen,useFrozen,useMounted,useLoad,useOrgTz,LoadFail,Empty,p6,bp,parsePct,zonedToInstant,stamp,g,type Row} from './phase6-ui';

type Item={title:string;kind:'yes_no'|'single_choice';options:string;passOption:string;pass:string};
const blank=():Item=>({title:'',kind:'yes_no',options:'',passOption:'yes',pass:'50'});
const YN=['yes','no','abstain'];
const votePercent=(weight:unknown,total:unknown)=>{const d=BigInt(String(total??0));return d>0n?bp((BigInt(String(weight??0))*10000n/d).toString()):'—'};
const optsOf=(i:Item)=>i.kind==='yes_no'?YN:i.options.split('\n').map(x=>x.trim()).filter(Boolean);
const optText=(l:Language,o:string)=>YN.includes(o)?({yes:{hy:'Այո',ru:'Да',en:'Yes'},no:{hy:'Ոչ',ru:'Нет',en:'No'},abstain:{hy:'Ձեռնպահ',ru:'Воздержался',en:'Abstain'}} as any)[o][l]:o;

function Create({c,l,onClose,onDone}:{c:RoleContext;l:Language;onClose:()=>void;onDone:(id?:string)=>void}){
 const {tz,known}=useOrgTz();const h=useFrozen(),live=useMounted();
 const blds=useLoad<Row[]>('/community/buildings',[c.id]),docs=useLoad<Row[]>(c.permissions.includes('documents.read')?'/documents':null,[c.id]);
 const [f,setF]=useState({buildingId:'',title:'',description:'',startsAt:'',endsAt:'',quorum:'50'}),[items,setItems]=useState<Item[]>([blank()]),[dids,setDids]=useState<string[]>([]),[err,setErr]=useState<unknown>(),[bad,setBad]=useState('');
 const dis=h.uncertain;
 const upd=(n:number,p:Partial<Item>)=>setItems(items.map((x,i)=>i===n?{...x,...p}:x));
 async function go(e:FormEvent){e.preventDefault();setErr(undefined);setBad('');
  let startsAt:string,endsAt:string;try{startsAt=zonedToInstant(f.startsAt,tz);endsAt=zonedToInstant(f.endsAt,tz)}catch{setBad(p6(l,'invalid'));return}
  const q=parsePct(f.quorum);if(!f.buildingId||f.title.trim().length<3||q===null||endsAt<=startsAt||!items.length){setBad(p6(l,'invalid'));return}
  const agenda:Row[]=[];for(const i of items){const o=optsOf(i),p=parsePct(i.pass);if(i.title.trim().length<3||p===null||o.length<2||o.length>10||new Set(o).size!==o.length||!o.includes(i.passOption)||(i.kind==='yes_no'&&i.passOption==='abstain')){setBad(p6(l,'invalid')+': '+(i.title||'?'));return}agenda.push({title:i.title.trim(),votingType:i.kind,options:o,passOption:i.passOption,passBasisPoints:p})}
  try{const r=await h.send<Row>('POST','/governance/meetings',key=>({key,buildingId:f.buildingId,title:f.title.trim(),description:f.description.trim(),startsAt,endsAt,quorumBasisPoints:q,documentIds:dids,agenda}),()=>live.current);if(r&&live.current)onDone(r.id)}catch(x){if(live.current)setErr(x)}}
 async function retry(){try{const r=await h.retry<Row>(()=>live.current);if(r&&live.current)onDone(r.id)}catch(x){if(live.current)setErr(x)}}
 return <Dlg l={l} title={p6(l,'newMeeting')} onClose={onClose}><form className="p-edit-form" onSubmit={e=>void go(e)}>
  <label>{p6(l,'building')}<select required disabled={dis} value={f.buildingId} onChange={e=>setF({...f,buildingId:e.target.value})}><option value="">—</option>{blds.data?.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
  <label>{p6(l,'title')}<input required minLength={3} maxLength={200} disabled={dis} value={f.title} onChange={e=>setF({...f,title:e.target.value})}/></label>
  <label>{p6(l,'description')}<textarea maxLength={4000} disabled={dis} value={f.description} onChange={e=>setF({...f,description:e.target.value})}/></label>
  <div className="p5-grid2"><label>{p6(l,'startsAt')}<input type="datetime-local" required disabled={dis} value={f.startsAt} onChange={e=>setF({...f,startsAt:e.target.value})}/></label><label>{p6(l,'endsAt')}<input type="datetime-local" required disabled={dis} value={f.endsAt} min={f.startsAt||undefined} onChange={e=>setF({...f,endsAt:e.target.value})}/></label></div>
  <p className="p5-muted">{p6(l,'tzNote')} {tz} {!known&&p6(l,'tzFallback')}</p>
  <label>{p6(l,'quorum')}<input inputMode="decimal" required disabled={dis} pattern="\d{1,3}([.,]\d{1,2})?" value={f.quorum} onChange={e=>setF({...f,quorum:e.target.value})}/></label>
  {docs.data&&<fieldset><legend>{p6(l,'docs')}</legend>{docs.data.length===0&&<p className="p5-muted">{p6(l,'empty')}</p>}{docs.data.map(d=><label className="p-check-item" style={{display:'flex',gap:8}} key={d.id}><input type="checkbox" disabled={dis} checked={dids.includes(d.id)} onChange={e=>setDids(e.target.checked?[...dids,d.id]:dids.filter(x=>x!==d.id))}/>{d.title}</label>)}</fieldset>}
  <h3>{p6(l,'agenda')}</h3>
  {items.map((it,n)=>{const o=optsOf(it);return <div className="p6-agenda" key={n}>
   <label>{p6(l,'title')} #{n+1}<input required minLength={3} maxLength={300} disabled={dis} value={it.title} onChange={e=>upd(n,{title:e.target.value})}/></label>
   <label>{p6(l,'votingType')}<select disabled={dis} value={it.kind} onChange={e=>{const kind=e.target.value as Item['kind'];upd(n,{kind,passOption:kind==='yes_no'?'yes':''})}}><option value="yes_no">{p6(l,'yesNo')}</option><option value="single_choice">{p6(l,'custom')}</option></select></label>
   {it.kind==='single_choice'&&<label>{p6(l,'options')}<textarea disabled={dis} value={it.options} onChange={e=>upd(n,{options:e.target.value})}/></label>}
   <div className="p5-grid2"><label>{p6(l,'passOption')}<select required disabled={dis} value={it.passOption} onChange={e=>upd(n,{passOption:e.target.value})}><option value="">—</option>{(it.kind==='yes_no'?['yes','no']:o).map(x=><option key={x} value={x}>{optText(l,x)}</option>)}</select></label>
   <label>{p6(l,'passPct')}<input inputMode="decimal" required disabled={dis} pattern="\d{1,3}([.,]\d{1,2})?" value={it.pass} onChange={e=>upd(n,{pass:e.target.value})}/></label></div>
   {items.length>1&&<button type="button" className="p-button small" disabled={dis} onClick={()=>setItems(items.filter((_,i)=>i!==n))}>{p6(l,'removeItem')}</button>}</div>})}
  <button type="button" className="p-button" disabled={dis} onClick={()=>setItems([...items,blank()])}>{p6(l,'addItem')}</button>
  {bad&&<p className="p-error" role="alert">{bad}</p>}<Fail l={l} error={err}/>
  <Frozen l={l} h={h} onRetry={()=>void retry()} onAbandon={onClose}/>
  <button className="p-button orange" disabled={h.pending||dis}>{h.pending?p6(l,'saving'):p6(l,'create')}</button></form></Dlg>}

function Detail({c,l,id,onChanged}:{c:RoleContext;l:Language;id:string;onChanged:()=>void}){
 const {tz}=useOrgTz();const m=useLoad<Row>('/governance/meetings/'+id,[c.id]);const manage=c.permissions.includes('meetings.manage')&&c.role_key!=='unit_owner';const canVote=c.permissions.includes('meetings.vote')&&c.role_key==='unit_owner';
 const act=useFrozen(),vote=useFrozen(),live=useMounted();const [err,setErr]=useState<unknown>(),[verr,setVerr]=useState<unknown>(),[cancel,setCancel]=useState(false),[reason,setReason]=useState(''),[pick,setPick]=useState<Record<string,string>>({}),[done,setDone]=useState<string[]>([]);
 const d=m.data;const status=String(g(d,'status')??'');const end=g(d,'ends_at','endsAt');const ended=end?new Date(end).getTime()<=Date.now():false;
 const after=()=>{m.reload();onChanged()};
 async function run(action:string,why?:string){setErr(undefined);try{const r=await act.send('POST','/governance/meetings/'+id+'/actions',key=>({key,version:d!.version,action,...(why?{reason:why}:{})}),()=>live.current);if(r!==undefined&&live.current){setCancel(false);setReason('');after()}}catch(x){if(live.current)setErr(x)}}
 async function retryAct(){try{const r=await act.retry(()=>live.current);if(r!==undefined&&live.current){setCancel(false);after()}}catch(x){if(live.current)setErr(x)}}
 async function cast(aid:string,eid:string){const k=aid+':'+eid;setVerr(undefined);try{const r=await vote.send('POST','/governance/agenda/'+aid+'/vote',key=>({key,eligibilityId:eid,selectedOption:pick[k]}),()=>live.current);if(r!==undefined&&live.current){setDone(x=>[...x,k]);m.reload()}}catch(x){if(live.current)setVerr(x)}}
 async function retryVote(){try{const r=await vote.retry(()=>live.current);if(r!==undefined&&live.current){m.reload()}}catch(x){if(live.current)setVerr(x)}}
 if(m.error)return <LoadFail l={l} error={m.error} onRetry={m.reload}/>;if(!d)return <p role="status">{p6(l,'loading')}</p>;
 const agenda:Row[]=d.agenda??[],elig:Row[]=d.eligibility??[],res=d.result,pid=g(d,'protocol_document_id','protocolDocumentId');
 const ra=(aid:string)=>res?.agenda?.find((x:Row)=>x.id===aid);const locked=act.uncertain||vote.uncertain;
 const Actions:ReactNode=manage&&<div className="p5-row">{status==='draft'&&<button className="p-button orange" disabled={act.pending||locked} onClick={()=>void run('publish')}>{p6(l,'publish')}</button>}{['draft','published'].includes(status)&&<button className="p-button" disabled={act.pending||locked} onClick={()=>setCancel(true)}>{p6(l,'cancelMeeting')}</button>}{status==='published'&&ended&&<button className="p-button orange" disabled={act.pending||locked} onClick={()=>void run('finalize')}>{p6(l,'finalize')}</button>}</div>;
 return <section className="p-card"><header><h2>{d.title}</h2><span className="p-badge amber">{p6(l,status)==status?status:p6(l,status)}</span></header>
  <p className="p5-muted">{stamp(g(d,'starts_at','startsAt'),l,tz)} → {stamp(end,l,tz)} · {p6(l,'quorum')}: {bp(g(d,'quorum_basis_points','quorumBasisPoints'))}</p>{d.description&&<p className="p6-pre">{d.description}</p>}
  {status==='draft'&&manage&&<p className="p5-muted">{p6(l,'publishNote')}</p>}{Actions}<Fail l={l} error={err} onRefresh={m.reload}/><Frozen l={l} h={act} onRetry={()=>void retryAct()} onAbandon={m.reload}/>
  {pid&&<p><a className="p-button" href={'/api/documents/'+pid+'/download'} download>{p6(l,'protocol')} · {p6(l,'download')} ↓</a></p>}
  {(d.documents??[]).length>0&&<><h3>{p6(l,'docs')}</h3><ul>{(d.documents as Row[]).map((x,i)=><li key={i}>{x.title??String(g(x,'version_id','versionId','id')).slice(0,8)}{g(x,'document_id','documentId')&&g(x,'version_id','versionId')&&<> · <a href={'/api/documents/'+g(x,'document_id','documentId')+'/versions/'+g(x,'version_id','versionId')+'/download'} download>{p6(l,'download')}</a></>}</li>)}</ul></>}
  <h3>{p6(l,'eligibility')}</h3>{elig.length===0?<Empty l={l}/>:<div className="p6-scroll"><table><thead><tr><th>{p6(l,'unit')}</th><th>{p6(l,'owner')}</th><th>{p6(l,'share')}</th></tr></thead><tbody>{elig.map(e=><tr key={e.id}><td>{e.number??e.unit_number??'—'}</td><td>{e.owner_name??'—'}</td><td className="p6-num">{bp(g(e,'share_basis_points','shareBasisPoints','weight_basis_points'))}</td></tr>)}</tbody></table></div>}
  <h3>{p6(l,'agenda')}</h3><p className="p5-muted">{p6(l,'ballotNote')}</p>
  {agenda.map((a,n)=>{const r=ra(a.id);const opts:string[]=a.options??[];return <div className="p6-agenda" key={a.id}><strong>{n+1}. {a.title}</strong><small className="p5-muted">{p6(l,'passOption')}: {optText(l,g(a,'pass_option','passOption'))} · {p6(l,'passPct')}: {bp(g(a,'pass_basis_points','passBasisPoints'))}</small>
   {canVote&&status==='published'&&elig.map(e=>{const k=a.id+':'+e.id;const voted=done.includes(k)||((a.my_votes??[]) as Row[]).some(v=>v.eligibility_id===e.id);return <div className="p6-opt" key={e.id}><span>{e.number??e.unit_number} · {bp(g(e,'share_basis_points','shareBasisPoints'))}</span>{voted?<span className="p-badge green">{p6(l,'voted')}</span>:<><select aria-label={p6(l,'cast')} value={pick[k]??''} disabled={locked} onChange={ev=>setPick({...pick,[k]:ev.target.value})}><option value="">—</option>{opts.map(o=><option key={o} value={o}>{optText(l,o)}</option>)}</select><button className="p-button small orange" disabled={!pick[k]||vote.pending||locked} onClick={()=>void cast(a.id,e.id)}>{p6(l,'cast')}</button></>}</div>})}
   {r&&<div className="p6-scroll"><table><thead><tr><th>{p6(l,'byOption')}</th><th>{p6(l,'share')}</th></tr></thead><tbody>{Object.entries(r.byOption??{}).map(([o,v])=><tr key={o}><td>{optText(l,o)}</td><td className="p6-num">{votePercent(v,r.participationShare)}</td></tr>)}</tbody></table><p>{p6(l,'participation')}: {votePercent(r.participationShare,res.totalEligibleShare)} · {r.quorum?p6(l,'quorumMet'):p6(l,'quorumNot')} · {r.passed===true?p6(l,'passed'):r.passed===false?p6(l,'notPassed'):p6(l,'pending')}</p></div>}</div>})}
  <Fail l={l} error={verr} onRefresh={m.reload}/><Frozen l={l} h={vote} onRetry={()=>void retryVote()} onAbandon={m.reload}/>
  {res&&<p><strong>{p6(l,'totalElig')}:</strong> {res.totalEligibleShare}/10000 · <strong>{p6(l,'participation')}:</strong> {votePercent(res.participationShare,res.totalEligibleShare)} · {res.quorum?p6(l,'quorumMet'):p6(l,'quorumNot')}</p>}
  {status!=='finalized'&&<p className="p-info">{l==='hy'?'Նախնական արդյունքներ․ դրանք վերջնական չեն մինչև քվեարկության ավարտը և ամփոփումը։':l==='ru'?'Предварительные результаты: они не являются итоговыми до окончания и завершения голосования.':'Provisional results: not final until voting has ended and been finalized.'}</p>}
  <p className="p5-muted">{p6(l,'noLegal')}</p>
  {cancel&&<Dlg l={l} title={p6(l,'cancelMeeting')} onClose={()=>setCancel(false)}><form className="p-edit-form" onSubmit={e=>{e.preventDefault();if(reason.trim().length>=3)void run('cancel',reason.trim())}}><label>{p6(l,'reason')}<textarea required minLength={3} maxLength={1000} value={reason} disabled={act.uncertain} onChange={e=>setReason(e.target.value)}/></label><Fail l={l} error={err} onRefresh={m.reload}/><Frozen l={l} h={act} onRetry={()=>void retryAct()} onAbandon={()=>setCancel(false)}/><button className="p-button orange" disabled={act.pending||act.uncertain}>{p6(l,'cancelMeeting')}</button></form></Dlg>}
 </section>}

export default function Governance({c,language:l,legacy}:{c:RoleContext;language:Language;legacy:ReactNode}){
 const {tz}=useOrgTz();const list=useLoad<Row[]>('/governance/meetings',[c.id]);const [sel,setSel]=useState(''),[creating,setCreating]=useState(false);
 const manage=c.permissions.includes('meetings.manage')&&c.role_key!=='unit_owner';
 return <div className="p5"><div className="p5-split"><section className="p-card"><header><h2>{p6(l,'meetings')}</h2>{manage&&<button className="p-button orange small" onClick={()=>setCreating(true)}>{p6(l,'newMeeting')}</button>}<button className="p-button small" onClick={list.reload}>{p6(l,'refresh')}</button></header>
  <LoadFail l={l} error={list.error} onRetry={list.reload}/>{!list.data&&!list.error?<p role="status">{p6(l,'loading')}</p>:list.data&&(list.data.length===0?<Empty l={l}/>:<ul className="p5-list">{list.data.map(r=><li key={r.id}><button className="p5-item" aria-current={sel===r.id} onClick={()=>setSel(r.id)}><strong>{r.title}</strong><small>{r.building_name?r.building_name+' · ':''}{stamp(g(r,'starts_at','startsAt'),l,tz)} · {p6(l,String(r.status))===String(r.status)?r.status:p6(l,String(r.status))}</small></button></li>)}</ul>)}</section>
  {sel?<Detail key={sel+c.id} c={c} l={l} id={sel} onChanged={list.reload}/>:<Empty l={l} text={p6(l,'meetings')}/>}</div>
  <section className="p-card p6-legacy"><h3>{p6(l,'legacyHead')}</h3><p className="p-info">{p6(l,'legacyNote')}</p>{legacy}</section>
  {creating&&<Create c={c} l={l} onClose={()=>setCreating(false)} onDone={id=>{setCreating(false);list.reload();if(id)setSel(id)}}/>}</div>}
