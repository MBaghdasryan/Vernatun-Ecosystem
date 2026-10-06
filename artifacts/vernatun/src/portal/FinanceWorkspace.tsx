import {useState} from 'react';
import BillingBatches from './BillingBatches';
import BankReconciliation from './BankReconciliation';
import Credits from './Credits';
import {ft} from './finance-util';
import type {Language,Currency} from './i18n';
import type {RoleContext} from './types';
export default function FinanceWorkspace({c,language,currency,onChanged}:{c:RoleContext;language:Language;currency:Currency;onChanged:()=>void}){
 const can=(p:string)=>c.permissions.includes(p);const orgWide=!c.building_id&&!c.unit_id;
 const tabs=[...(can('billing.read')?['batches']:[]),...(can('payments.reconcile')&&orgWide?['bank']:[]),...(can('payments.reconcile')&&orgWide||can('billing.own')?['credits']:[])] as ('batches'|'bank'|'credits')[];
 const [tab,setTab]=useState<string>('');const cur=tabs.includes(tab as any)?tab:tabs[0];
 if(!tabs.length)return null;
 return <div className="p-finance-ws" key={c.id}><div className="p-table-tools" role="tablist" aria-label={ft(language,'workspace')}>{tabs.map(k=><button key={k} role="tab" aria-selected={cur===k} className={'p-button'+(cur===k?' orange':'')} onClick={()=>setTab(k)}>{ft(language,k)}</button>)}</div>
  {cur==='batches'&&<BillingBatches c={c} language={language} currency={currency}/>}{cur==='bank'&&<BankReconciliation c={c} language={language} onChanged={onChanged}/>}{cur==='credits'&&<Credits c={c} language={language} onChanged={onChanged}/>}</div>}
