import {useEffect,useRef,useState} from 'react';
import type {BankImportInput,BankEntryInput,BankConfirmationInput,BankIgnoreInput,InvoiceAllocationInput} from '@workspace/api-client-react';
import {request} from './client';
import {BusinessTable} from './Business';
import {usePolling} from './Phase2';
import {money,date,type Language,type Currency} from './i18n';
import {ft,codeText,toMinor,parseCsv,useIntent,fromMinor,buildBankEntries,type BankMap,type Row} from './finance-util';
import type {RoleContext} from './types';
type Map=BankMap;
const CUR=['AMD','RUB','USD'];
const MAX=1024*1024;
export default function BankReconciliation({c,language,onChanged}:{c:RoleContext;language:Language;onChanged?:()=>void}){
 const t=(k:Parameters<typeof ft>[1])=>ft(language,k);const orgWide=!c.building_id&&!c.unit_id&&c.permissions.includes('payments.reconcile');
 const [account,setAccount]=useState(''),[csv,setCsv]=useState<string[][]>(),[csvErr,setCsvErr]=useState(''),[delim,setDelim]=useState(''),[text,setText]=useState<string>(),[decimal,setDecimal]=useState<'.'|','>('.'),[fmt,setFmt]=useState<'iso'|'dmy'>('iso'),[defCur,setDefCur]=useState(''),[mode,setMode]=useState<'major'|'minor'>('major');
 const [map,setMap]=useState<Map>({externalId:'',date:'',amount:'',currency:'',payer:'',purpose:''});const [prev,setPrev]=useState<Row>();const [prevBusy,setPrevBusy]=useState(false);
 const LIMIT=100;const [imports,setImports]=useState<Row[]>();const [txs,setTxs]=useState<Row[]>();const [status,setStatus]=useState('');const [searchInput,setSearchInput]=useState('');const [search,setSearch]=useState('');const [page,setPage]=useState(0);const [error,setError]=useState(''),[ok,setOk]=useState('');
 const key=useRef(c.id);key.current=c.id;const seq=useRef(0);const imp=useIntent();const act=useIntent();
 const rowsOk=csv&&csv.length>1?csv:undefined;const mapped=csv&&map.externalId&&map.date&&map.amount&&map.payer&&(map.currency||defCur);
 const built=csv&&mapped?buildBankEntries(csv,map,{decimal,fmt,cur:defCur,mode},language):undefined;
 const tooMany=built&&(built.entries.length<1||built.entries.length>1000||csv!.length-1>1000);
 const body=():BankImportInput|undefined=>built&&account.trim().length>=2?{key:crypto.randomUUID(),account:account.trim(),transactions:built.entries}:undefined;
 async function load(){const id=c.id;const n=++seq.current;if(!orgWide)return;try{const [a,b]=await Promise.all([request<Row[]>('/finance/bank/imports'),request<Row[]>('/finance/bank/transactions?'+new URLSearchParams({page:String(page),limit:String(LIMIT),...(status?{status}:{}),...(search?{search}:{})}))]);if(id!==key.current||n!==seq.current)return;if(page>0&&!b.length){setPage(page-1);return}setImports(a);setTxs(b);setError('')}catch(e){if(id===key.current&&n===seq.current)setError(codeText(language,e))}}
 useEffect(()=>{seq.current++;setImports(undefined);setTxs(undefined);setCsv(undefined);setText(undefined);setPrev(undefined);setAccount('');setOk('');setError('');imp.reset();act.reset();setSel(undefined);void load()},[c.id]);
 useEffect(()=>{const h=setTimeout(()=>{const v=searchInput.trim().slice(0,100);if(v!==search){setSearch(v);setPage(0)}},300);return()=>clearTimeout(h)},[searchInput]);
 useEffect(()=>{setTxs(undefined);void load()},[status,search,page]);
 usePolling(()=>void load(),[c.id,status,search,page],false);
 const frozen=imp.uncertain||act.uncertain;
 function readFile(f:File|undefined){setPrev(undefined);setCsv(undefined);setCsvErr('');setText(undefined);if(!f)return;if(f.size>MAX){setCsvErr(t('tooBig'));return}void f.text().then(s=>{setText(s);reparse(s,delim)})}
 function reparse(s:string,d:string){const r=parseCsv(s,d);if(r.error){setCsv(undefined);setCsvErr(t('quote'));return}if(r.rows.length<1){setCsv(undefined);setCsvErr(t('noHeader'));return}setCsvErr('');setCsv(r.rows);setMap({externalId:'',date:'',amount:'',currency:'',payer:'',purpose:''});setPrev(undefined)}
 async function preview(){const b=body();if(!b||prevBusy)return;const id=c.id;setPrevBusy(true);setError('');try{const r=await request<Row>('/finance/bank/imports/preview','POST',b);if(key.current===id)setPrev(r)}catch(e){if(key.current===id)setError(codeText(language,e))}finally{setPrevBusy(false)}}
 async function doImport(){const id=c.id;setError('');setOk('');try{const r=await imp.send('/finance/bank/imports',k=>{const b=body()!;return {...b,key:k} satisfies BankImportInput},()=>key.current===id);if(key.current!==id||!r)return;setOk(t('done'));setPrev(undefined);setCsv(undefined);setText(undefined);await load();onChanged?.()}catch(e){if(key.current===id)setError(codeText(language,e))}}
 // review
 const [ignoreMode,setIgnoreMode]=useState(false),[sel,setSel]=useState<Row>(),[selVersion,setSelVersion]=useState(0),[units,setUnits]=useState<Row[]>([]),[unitId,setUnitId]=useState(''),[payerId,setPayerId]=useState(''),[accounts,setAccounts]=useState<Row[]>([]),[sugg,setSugg]=useState<Row[]>(),[amounts,setAmounts]=useState<Record<string,string>>({}),[reviewed,setReviewed]=useState(false),[reason,setReason]=useState('');
 const live=txs?.find(x=>x.id===sel?.id);const cur=live??sel;
 const latest=useRef({c:c.id,t:'',u:'',p:''});latest.current={c:c.id,t:sel?.id??'',u:unitId,p:payerId};
 const same=(x:{c:string;t:string;u?:string;p?:string})=>{const l=latest.current;return l.c===x.c&&l.t===x.t&&(x.u===undefined||l.u===x.u)&&(x.p===undefined||l.p===x.p)};
 useEffect(()=>{if(orgWide){setUnits([]);request<Row[]>('/units').then(r=>{if(key.current===c.id)setUnits(r)}).catch(e=>{if(key.current===c.id)setError(codeText(language,e))})}},[c.id]);
 function pick(r:Row){if(act.uncertain||act.pending)return;setSel(r);setSelVersion(r.version);setUnitId(r.unit_id??'');setPayerId('');setAmounts({});setReviewed(false);setReason('');setSugg(undefined);setAccounts([]);setInvs([])}
 useEffect(()=>{setAccounts([]);if(!unitId||!sel)return;const x={c:c.id,t:sel.id,u:unitId};request<Row[]>('/finance/accounts?unitId='+unitId).then(r=>{if(same(x))setAccounts(r)}).catch(e=>{if(same(x))setError(codeText(language,e))})},[unitId,sel?.id,c.id]);
 useEffect(()=>{if(!sel)return;const x={c:c.id,t:sel.id,u:unitId,p:payerId};const q=new URLSearchParams({...(unitId?{unitId}:{}),...(payerId?{payerId}:{})}).toString();request<Row[]>('/finance/bank/transactions/'+sel.id+'/suggestions'+(q?'?'+q:'')).then(s=>{if(same(x))setSugg(s)}).catch(e=>{if(same(x)){setSugg(o=>o??[]);setError(codeText(language,e))}})},[sel?.id,unitId,payerId,c.id]);
 const [invs,setInvs]=useState<Row[]>([]);
 const cands=[...(sugg??[]),...invs.filter(i=>!(sugg??[]).some(s=>s.id===i.id))].filter(s=>s.unit_id===unitId&&s.payer_user_id===payerId&&s.currency===cur?.currency&&BigInt(s.balance_minor??0)>0n);
 const sum=()=>{let s=0n;const al:InvoiceAllocationInput[]=[];for(const s2 of cands){const v=amounts[s2.id]??'';if(!v.trim())continue;const m=toMinor(v);if(!m)return null;const mm=BigInt(m);if(mm>BigInt(s2.balance_minor))return null;s+=mm;al.push({invoiceId:s2.id,amountMinor:m})}return {s,al}};
 useEffect(()=>{setInvs([]);if(!unitId||!payerId||!sel)return;const x={c:c.id,t:sel.id,u:unitId,p:payerId};const cc=cur?.currency;if(!cc)return;request<Row>('/finance?currency='+cc).then(f=>{if(same(x))setInvs((f.invoices??[]).filter((i:Row)=>i.unit_id===unitId&&i.payer_user_id===payerId&&i.currency===cc&&i.status==='published').map((i:Row)=>({...i,balance_minor:String(i.balance_minor)})))}).catch(e=>{if(same(x))setError(codeText(language,e))})},[unitId,payerId,sel?.id,cur?.currency,c.id]);
 const open=cur&&BigInt(cur.amount_minor)>0n&&['unmatched','partially_matched'].includes(cur.status);
 async function confirm(){if(!cur)return;const id=c.id;const r=sum();if(!r){setError(t('badMoney'));return}if(r.s>BigInt(cur.amount_minor)){setError(t('allocation_exceeds_payment'));return}setError('');setOk('');
  try{const x=await act.send('/finance/bank/transactions/'+cur.id+'/confirm',k=>({key:k,version:selVersion,unitId,payerId,allocations:r.al} satisfies BankConfirmationInput),()=>key.current===id);if(key.current!==id||!x)return;setOk(t('done'));setSel(undefined);await load();onChanged?.()}catch(e){if(key.current===id){setError(codeText(language,e));void load()}}}
 async function ignore(){if(!cur)return;const id=c.id;setError('');setOk('');try{const x=await act.send('/finance/bank/transactions/'+cur.id+'/ignore',k=>({key:k,version:selVersion,reason:reason.trim()} satisfies BankIgnoreInput),()=>key.current===id);if(key.current!==id||!x)return;setOk(t('done'));setSel(undefined);await load()}catch(e){if(key.current===id){setError(codeText(language,e));void load()}}}
 if(!orgWide)return <section className="p-card"><h2>{t('bank')}</h2><p className="p-info">{t('orgOnly')}</p></section>;
 const stale=!!cur&&cur.version!==selVersion;const headers=csv?.[0]??[];
 const msel=(k:keyof Map,l:Parameters<typeof ft>[1],req=true)=><label>{t(l)}<select required={req} disabled={frozen} value={map[k]} onChange={e=>{setMap({...map,[k]:e.target.value});setPrev(undefined)}}><option value="">{t('none')}</option>{headers.map((h,i)=>h&&<option key={i} value={h}>{h}</option>)}</select></label>;
 return <section className="p-card" aria-busy={prevBusy||imp.pending||act.pending}><header><h2>{t('bank')}</h2><button className="p-button" onClick={()=>void load()}>{t('refresh')}</button></header>
  {error&&<p className="p-error" role="alert">{error}</p>}{ok&&<p role="status">{ok}</p>}
  {frozen&&<div className="p-info" role="alert"><p>{t('uncertain')}</p>{imp.uncertain&&<button className="p-button" disabled={imp.pending} onClick={()=>void doImport()}>{t('retrySame')}</button>}{act.uncertain&&<button className="p-button" disabled={act.pending} onClick={()=>void(ignoreMode?ignore():confirm())}>{t('retrySame')}</button>}<button className="p-button" onClick={()=>{imp.reset();act.reset();void load()}}>{t('abandon')}</button></div>}
  <form className="p-edit-form" onSubmit={e=>{e.preventDefault();void preview()}}><h3>{t('csv')}</h3><p className="p-info">{t('csvFormat')}</p>
   <label>{t('account')}<input required minLength={2} maxLength={160} value={account} disabled={frozen} onChange={e=>{setAccount(e.target.value);setPrev(undefined)}}/></label>
   <label>{t('csv')}<input type="file" accept=".csv,text/csv" disabled={frozen} onChange={e=>readFile(e.target.files?.[0])}/></label>
   {csvErr&&<p className="p-error" role="alert">{csvErr}</p>}
   {csv&&<><label>{t('delimiter')}<select value={delim} onChange={e=>{setDelim(e.target.value);if(text!==undefined)reparse(text,e.target.value)}}><option value="">{t('auto')}</option><option value=",">,</option><option value=";">;</option><option value={'\t'}>tab</option></select></label>
    <label>{t('decimal')}<select value={decimal} onChange={e=>{setDecimal(e.target.value as '.'|',');setPrev(undefined)}}><option value=".">.</option><option value=",">,</option></select></label>
    <label>{t('dateFmt')}<select value={fmt} onChange={e=>{setFmt(e.target.value as 'iso'|'dmy');setPrev(undefined)}}><option value="iso">YYYY-MM-DD</option><option value="dmy">DD.MM.YYYY</option></select></label>
    <label>{t('minorMode')}<select value={mode} onChange={e=>{setMode(e.target.value as 'major'|'minor');setPrev(undefined)}}><option value="major">{t('major')}</option><option value="minor">{t('minor')}</option></select></label>
    <label>{t('defCur')}<select value={defCur} onChange={e=>{setDefCur(e.target.value);setPrev(undefined)}}><option value="">—</option>{CUR.map(x=><option key={x}>{x}</option>)}</select></label>
    {msel('externalId','cExternal')}{msel('date','cDate')}{msel('amount','cAmount')}{msel('currency','cCurrency',false)}{msel('payer','cPayer')}{msel('purpose','cPurpose',false)}
    {!rowsOk&&<p className="p-error">{t('tooMany')}</p>}{!mapped&&<p className="p-info">{t('mapReq')}</p>}
    {built&&<p>{built.entries.length} / {csv.length-1} {t('rows')}</p>}{tooMany&&<p className="p-error">{t('tooMany')}</p>}
    {built&&built.errors.length>0&&<div className="p-error" role="alert"><p>{t('rowErrors')}</p>{built.errors.slice(0,20).map(x=><p key={x.row}>#{x.row} · {x.msg}</p>)}{built.errors.length>20&&<p>+{built.errors.length-20}</p>}</div>}</>}
   <button className="p-button" disabled={prevBusy||frozen||!built||built.errors.length>0||!!tooMany||account.trim().length<2}>{t('previewImport')}</button></form>
  {prev&&<div className="p-card"><p>{t('newRows')}: {prev.newCount} · {t('dupRows')}: {prev.duplicateCount} · {t('confRows')}: {prev.conflictCount}</p>
   {(prev.rows??[]).some((r:Row)=>r.warning==='outgoing_not_reconcilable')&&<p className="p-info">{t('outgoing')}</p>}
   {prev.conflictCount>0&&<p className="p-error" role="alert">{t('bank_reference_conflict')}</p>}
   <BusinessTable rows={(prev.rows??[]).map((r:Row)=>({...r,id:r.externalId,amount:r.amountMinor?fromMinor(String(r.amountMinor))+' '+(r.currency??''):''}))} columns={[["externalId","cExternal"],["amount","amount"],["status","status"]] as [string,string][]} language={language}/>
   <p className="p-info">{t('importNote')}</p><button className="p-button orange" disabled={imp.pending||frozen||prev.conflictCount>0||prev.newCount<1} onClick={()=>void doImport()}>{t('importBtn')}</button></div>}
  <h3>{t('imports')}</h3>{!imports&&!error&&<p role="status">{t('loading')}</p>}{imports&&!imports.length&&<p>{t('empty')}</p>}
  {imports?.slice(0,8).map(i=><p key={i.id}>{i.account} · {i.created_at?date(i.created_at,language):''} · {t('imported')}: {i.imported_count??0} · {t('duplicates')}: {i.duplicate_count??0}</p>)}
  <h3>{t('transactions')}</h3><label>{t('searchBank')}<input maxLength={100} value={searchInput} onChange={e=>setSearchInput(e.target.value)}/></label><label>{t('status')}<select value={status} onChange={e=>{setStatus(e.target.value);setPage(0)}}><option value="">{t('all')}</option>{(['matched','partially_matched','unmatched','ignored'] as const).map(s=><option key={s} value={s}>{t(s)}</option>)}</select></label>
  {!txs&&!error&&<p role="status">{t('loading')}</p>}{txs&&!txs.length&&<p>{t('empty')}</p>}
  {txs&&<BusinessTable rows={txs.map(x=>({...x,amount:money(String(x.amount_minor),x.currency as Currency,language),d:date(x.transaction_date,language),st:t(x.status)}))} columns={[["d","date"],["payer_text","payer"],["amount","amount"],["purpose","purpose"],["st","status"]] as [string,string][]} language={language} onSelect={act.pending||act.uncertain?undefined:pick}/>}
  <div className="p-modal-actions"><button className="p-button" disabled={page===0||!txs} onClick={()=>setPage(page-1)}>{t('prev')}</button><span role="status">{t('pageLbl')} {page+1}</span><button className="p-button" disabled={!txs||txs.length<LIMIT} onClick={()=>setPage(page+1)}>{t('next')}</button></div>
  {cur&&<div className="p-card"><h3>{t('review')} · {cur.payer_text} · {money(String(cur.amount_minor),cur.currency as Currency,language)}</h3><p>{cur.purpose}</p>
   {stale&&<p className="p-info">{t('stale_version')} <button className="p-button" disabled={act.pending||act.uncertain} onClick={()=>setSelVersion(cur.version)}>{t('useLatest')}</button></p>}
   {!open?<p>{t(cur.status)}{BigInt(cur.amount_minor)<0n?' · '+t('outgoing'):''}</p>:<>
    <h4>{t('suggestions')}</h4>{!sugg&&<p role="status">{t('loading')}</p>}{sugg&&!sugg.length&&<p>{t('noCandidates')}</p>}
    {sugg?.map(s=><div className="p-history" key={s.id}><strong>{t('invoice')} {s.number} · {s.payer_name} · {t('balance')} {money(String(s.balance_minor),s.currency as Currency,language)}</strong><small>{(s.suggestionCodes??[]).join(', ')} · {s.score}</small><button className="p-button" disabled={act.pending||act.uncertain} onClick={()=>{setUnitId(s.unit_id);setPayerId(s.payer_user_id);setAmounts({});setReviewed(false)}}>{t('review')}</button></div>)}
    <label>{t('unit')}<select value={unitId} disabled={act.uncertain||act.pending} onChange={e=>{setUnitId(e.target.value);setPayerId('');setAmounts({});setReviewed(false)}}><option value="">—</option>{units.map(u=><option key={u.id} value={u.id}>{u.building_name} · {u.number}</option>)}</select></label>
    <label>{t('payer')}<select value={payerId} disabled={act.uncertain||act.pending||!unitId} onChange={e=>{setPayerId(e.target.value);setAmounts({});setReviewed(false)}}><option value="">—</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    {cands.map(s=><label key={s.id}>{t('invoice')} {s.number} · {t('balance')} {money(String(s.balance_minor),s.currency as Currency,language)}<input inputMode="decimal" pattern="[0-9]{1,14}([.][0-9]{1,2})?" disabled={act.uncertain||act.pending} value={amounts[s.id]??''} onChange={e=>{setAmounts(o=>({...o,[s.id]:e.target.value}));setReviewed(false)}}/></label>)}
    {!Object.values(amounts).some(v=>v.trim())&&<p className="p-info">{t('fullCredit')}</p>}
    <label className="p-check-item"><input type="checkbox" checked={reviewed} disabled={act.uncertain||act.pending} onChange={e=>setReviewed(e.target.checked)}/>{t('reviewed')}</label>
    <button className="p-button orange" disabled={act.pending||frozen||stale||!reviewed||!unitId||!payerId} onClick={()=>{setIgnoreMode(false);void confirm()}}>{t('confirm')}</button>
    {cur.status==='unmatched'&&<><label>{t('reason')}<input minLength={3} maxLength={1000} value={reason} disabled={act.uncertain||act.pending} onChange={e=>setReason(e.target.value)}/></label><button className="p-button" disabled={act.pending||frozen||stale||reason.trim().length<3} onClick={()=>{setIgnoreMode(true);void ignore()}}>{t('ignore')}</button></>}</>}</div>}
  </section>}
