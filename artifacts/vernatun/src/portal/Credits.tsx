import {useEffect,useRef,useState} from 'react';
import type {CreditAllocationInput,InvoiceAllocationInput} from '@workspace/api-client-react';
import {request} from './client';
import {usePolling} from './Phase2';
import {money,date,type Language,type Currency} from './i18n';
import {ft,codeText,toMinor,useIntent,type Row} from './finance-util';
import type {RoleContext} from './types';
export default function Credits({c,language,onChanged}:{c:RoleContext;language:Language;onChanged?:()=>void}){
 const t=(k:Parameters<typeof ft>[1])=>ft(language,k);const manage=c.permissions.includes('payments.reconcile')&&!c.building_id&&!c.unit_id;
 const [rows,setRows]=useState<Row[]>();const [error,setError]=useState('');const [ok,setOk]=useState('');const [selId,setSelId]=useState<string>();const [amounts,setAmounts]=useState<Record<string,string>>({});const [invoices,setInvoices]=useState<Row[]>([]);
 const key=useRef(c.id);key.current=c.id;const seq=useRef(0);const it=useIntent();
 async function load(){const id=c.id;const n=++seq.current;try{const r=await request<Row[]>('/finance/credits');if(id!==key.current||n!==seq.current)return;setRows(r);setError('')}catch(e){if(id===key.current&&n===seq.current)setError(codeText(language,e))}}
 useEffect(()=>{seq.current++;setRows(undefined);setSelId(undefined);setAmounts({});setInvoices([]);setOk('');setError('');it.reset();void load()},[c.id]);
 usePolling(()=>void load(),[c.id],false);
 const sel=rows?.find(r=>r.id===selId);
 useEffect(()=>{setInvoices([]);if(!sel||!manage)return;const id=c.id,cur=sel.currency,pid=sel.id;request<Row>('/finance?currency='+cur).then(f=>{if(id===key.current)setInvoices((f.invoices??[]).filter((i:Row)=>i.unit_id===sel.unit_id&&(i.payer_user_id===undefined||i.payer_user_id===sel.payer_user_id)&&i.currency===sel.currency&&i.status==='published'&&BigInt(i.balance_minor??0)>0n));void pid}).catch(e=>setError(codeText(language,e)))},[selId,manage,c.id]);
 async function submit(){if(!sel)return;const id=c.id;setError('');setOk('');const allocations:InvoiceAllocationInput[]=[];let total=0n;
  for(const [invoiceId,v] of Object.entries(amounts)){if(!v.trim())continue;const m=toMinor(v);if(!m){setError(t('badMoney'));return}allocations.push({invoiceId,amountMinor:m});total+=BigInt(m)}
  if(!allocations.length||total>BigInt(sel.credit_minor)){setError(t('allocation_exceeds_payment'));return}
  try{const r=await it.send('/finance/credits/'+sel.id+'/allocate',k=>({key:k,allocations} satisfies CreditAllocationInput),()=>key.current===id);if(key.current!==id||!r)return;setOk(t('done'));setAmounts({});await load();onChanged?.()}catch(e){if(key.current===id)setError(codeText(language,e))}}
 return <section className="p-card" aria-busy={it.pending}><header><h2>{t('credits')}</h2><button className="p-button" onClick={()=>void load()}>{t('refresh')}</button></header>
  {error&&<p className="p-error" role="alert">{error} <button className="p-button" onClick={()=>void load()}>{t('retry')}</button></p>}{ok&&<p role="status">{ok}</p>}
  {it.uncertain&&<div className="p-info" role="alert"><p>{t('uncertain')}</p><button className="p-button" disabled={it.pending} onClick={()=>void submit()}>{t('retrySame')}</button><button className="p-button" onClick={()=>{it.reset();void load()}}>{t('abandon')}</button></div>}
  {!rows&&!error&&<p role="status">{t('loading')}</p>}{rows&&!rows.length&&<p>{t('noCredit')}</p>}
  {rows?.map(r=>{const zero=BigInt(r.credit_minor??0)===0n;return <div className="p-history" key={r.id}><strong>{r.number} · {r.payer_name} · {t('credit')}: {money(String(r.credit_minor),r.currency as Currency,language)}</strong><small>{r.source==='opening_balance'?ft(language,'openingBalance')+' · ':''}{r.reference} · {r.created_at?date(r.created_at,language):''}</small>
   {(r.allocations??[]).map((a:Row)=><small key={a.id}>{t('allocations')}: {money(String(a.amountMinor),r.currency as Currency,language)} · {a.kind} · {date(a.createdAt,language)}</small>)}
   {zero?<small>{t('zeroRO')}</small>:manage&&<button className="p-button" disabled={it.uncertain||it.pending} onClick={()=>{setSelId(r.id);setAmounts({})}}>{t('allocate')}</button>}</div>})}
  {sel&&manage&&BigInt(sel.credit_minor)>0n&&<div className="p-edit-form"><h3>{t('allocate')} · {sel.number} · {money(String(sel.credit_minor),sel.currency as Currency,language)}</h3>
   {!invoices.length&&<p>{t('empty')}</p>}{invoices.map(i=><label key={i.id}>{t('invoice')} {i.number??''} · {t('balance')} {money(String(i.balance_minor),i.currency as Currency,language)}<input inputMode="decimal" pattern="[0-9]{1,14}([.][0-9]{1,2})?" disabled={it.uncertain||it.pending} value={amounts[i.id]??''} onChange={e=>setAmounts(o=>({...o,[i.id]:e.target.value}))}/></label>)}
   <button className="p-button" disabled={it.pending||it.uncertain} onClick={()=>{setAmounts({});setSelId(undefined)}}>{t('discard')}</button> <button className="p-button orange" disabled={it.pending||it.uncertain||!Object.values(amounts).some(v=>v.trim())} onClick={()=>void submit()}>{t('allocate')}</button></div>}</section>}
