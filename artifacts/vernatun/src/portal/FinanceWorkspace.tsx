import {useEffect,useState} from 'react';
import BillingBatches from './BillingBatches';
import BankReconciliation from './BankReconciliation';
import Credits from './Credits';
import FinanceConfiguration from './FinanceConfiguration';
import UnitBillingParameters from './UnitBillingParameters';
import {ft} from './finance-util';
import type {Language,Currency} from './i18n';
import type {RoleContext} from './types';
export default function FinanceWorkspace({c,language,currency,onChanged}:{c:RoleContext;language:Language;currency:Currency;onChanged:()=>void}){
 const can=(p:string)=>c.permissions.includes(p);const orgWide=!c.building_id&&!c.unit_id;
 const tabs=[...(can('billing.read')?['batches']:[]),...(can('payments.reconcile')&&orgWide?['bank']:[]),...(can('payments.reconcile')&&orgWide||can('billing.own')?['credits']:[]),...(can('billing.calculate')||can('billing.read')?['configuration']:[]),...(can('billing.calculate')?['unit-parameters']:[])] as ('batches'|'bank'|'credits'|'configuration'|'unit-parameters')[];
 const urlTab=()=>new URLSearchParams(location.search).get('tab')??'';
  const [tab,setTabState]=useState<string>(urlTab);
  useEffect(()=>{const pop=()=>setTabState(urlTab());window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop)},[]);
  // Keep other query keys; tab is a deep link only, authorization stays on the API.
  const setTab=(k:string)=>{const q=new URLSearchParams(location.search);q.set('tab',k);history.replaceState(history.state,'',location.pathname+'?'+q+location.hash);setTabState(k)};const cur=tabs.includes(tab as any)?tab:tabs[0];
 if(!tabs.length)return null;
   const label=(k:'batches'|'bank'|'credits'|'configuration'|'unit-parameters')=>k==='configuration'?({hy:'Սակագներ և կանոններ',ru:'Тарифы и правила',en:'Rates & rules'} as const)[language]:k==='unit-parameters'?({hy:'Բնակարանների տվյալներ',ru:'Параметры помещений',en:'Unit parameters'} as const)[language]:ft(language,k);
  return <div className="p-finance-ws" key={c.id}><div className="p-table-tools" role="tablist" aria-label={ft(language,'workspace')}>{tabs.map(k=><button key={k} role="tab" aria-selected={cur===k} className={'p-button'+(cur===k?' orange':'')} onClick={()=>setTab(k)}>{label(k)}</button>)}</div>
    {cur==='batches'&&<BillingBatches c={c} language={language} currency={currency}/>}
    {cur==='bank'&&<BankReconciliation c={c} language={language} onChanged={onChanged}/>}
    {cur==='credits'&&<Credits c={c} language={language} onChanged={onChanged}/>}
    {cur==='configuration'&&<FinanceConfiguration language={language} currency={currency} canManage={can('billing.calculate')} canCalculate={can('billing.calculate')}/>}
     {cur==='unit-parameters'&&<UnitBillingParameters language={language} canManage={can('billing.calculate')} canReview={can('billing.calculate')&&can('billing.publish')}/>}
   </div>}
