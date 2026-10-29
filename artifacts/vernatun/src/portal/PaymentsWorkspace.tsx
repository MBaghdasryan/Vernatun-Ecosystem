import {useEffect,useMemo,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AlertTriangle,CheckCircle2,CreditCard,Landmark,ReceiptText,ShieldCheck,X,Zap,ArrowRight} from 'lucide-react';
import {useGetPaymentsWorkspace,getGetPaymentsWorkspaceQueryKey,useSavePaymentProviderInstance,useTestPaymentProviderInstance,useDisablePaymentProviderInstance,useIssuePlatformBillingInvoice,useCreateOnlinePaymentIntent,useGetOnlinePaymentIntent,getGetOnlinePaymentIntentQueryKey,useVerifyOnlinePaymentIntent,useGetUtilityBillingWorkspace,getGetUtilityBillingWorkspaceQueryKey,setCsrfTokenGetter,PaymentProviderSetupInputProviderCode,PaymentProviderSetupInputEnvironment,OnlinePaymentIntentInputDomain,OnlinePaymentIntentInputAllocationStrategy,type PaymentReadiness,type PaymentProviderInstance,type OnlinePaymentIntent} from '@workspace/api-client-react';
import type {RoleContext} from './types';
import {date,money,type Currency,type Language} from './i18n';
import {getCsrfHeaders} from './client';
import {pt} from './payments-i18n';
import PlatformPaymentsConsole from './PlatformPaymentsConsole';
import './payments.css';
// Generated clients reuse the session CSRF token already held by ./client.
setCsrfTokenGetter(()=>getCsrfHeaders()['X-CSRF-Token']||null);
type Props={c:RoleContext;language:Language;currency:Currency};
const newClient=()=>new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false,gcTime:0,staleTime:0}}});
// One cache per role context: switching context discards every cached payment record.
function Scoped({c,children}:{c:RoleContext;children:ReactNode}){const client=useMemo(newClient,[c.id]);useEffect(()=>()=>client.clear(),[client]);return <QueryClientProvider client={client} key={c.id}>{children}</QueryClientProvider>}
const wsKey=(c:RoleContext)=>[...getGetPaymentsWorkspaceQueryKey(),c.id] as const;
const msg=(e:unknown,l:Language)=>{const d=e as {data?:{error?:string;message?:string};message?:string};return d?.data?.message??d?.data?.error??pt(l,'failed')};
function Banner({r,l}:{r:PaymentReadiness;l:Language}){return <div className={'pay-ready '+(r.onlineAvailable?'on':'')} role="status" data-testid="payments-readiness">{r.onlineAvailable?<CheckCircle2 size={22}/>:<AlertTriangle size={22}/>}<div><strong>{pt(l,r.onlineAvailable?'available':'unavailable')}</strong>{!r.onlineAvailable&&<p>{pt(l,'noCheckout')}</p>}<small>{pt(l,'serverReason')}: {r.status} · {r.reason}</small></div></div>}
function Skeleton(){return <div className="pay" aria-busy="true"><div className="pay-skel"/><div className="pay-skel"/><div className="pay-skel"/></div>}
function Failure({l,onRetry}:{l:Language;onRetry:()=>void}){return <div className="p-error" role="alert"><p>{pt(l,'loadError')}</p><button className="p-button" onClick={onRetry}>{pt(l,'retry')}</button></div>}
function Dialog({title,onClose,l,children}:{title:string;onClose:()=>void;l:Language;children:ReactNode}){const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal()},[]);return <dialog className="p-modal" ref={ref} onCancel={onClose} onClick={e=>{if(e.currentTarget===e.target)onClose()}}><button className="p-icon p-modal-close" onClick={onClose} aria-label={pt(l,'close')}><X/></button><h2>{title}</h2>{children}</dialog>}
const fmt=(m:string,cur:string,l:Language)=>{try{return money(m,cur as Currency,l)}catch{return m+' '+cur}};
function savedConnection(i:PaymentProviderInstance,l:Language){
 if(i.provider_code!=='ameriabank'||!i.last_health_check)return '';
 if(i.last_error)return pt(l,i.last_error==='authentication_rejected'?'authentication_rejected':'connectionFailed');
 return i.last_success_at&&Date.parse(i.last_success_at)>=Date.parse(i.last_health_check)?pt(l,'connected'):'';
}

function Receipt({id,l,ready,auto,onClose,onVerified}:{id:string;l:Language;ready:boolean;auto?:boolean;onClose:()=>void;onVerified:()=>void}){
 const q=useGetOnlinePaymentIntent(id,{query:{queryKey:getGetOnlinePaymentIntentQueryKey(id)}});const verify=useVerifyOnlinePaymentIntent();const [err,setErr]=useState<string>();
 const d=q.data;const autoDone=useRef(false);
 useEffect(()=>{if(auto&&ready&&!autoDone.current&&d){autoDone.current=true;verify.mutate({id},{onSuccess:()=>{void q.refetch();onVerified()},onError:e=>setErr(msg(e,l))})}});
 return <Dialog title={pt(l,'receipt')} onClose={onClose} l={l}>{q.isLoading?<div className="pay-skel"/>:q.isError||!d?<Failure l={l} onRetry={()=>void q.refetch()}/>:<div className="pay">
  <dl className="pay-dl"><dt>{pt(l,'reference')}</dt><dd>{d.intent.public_reference}</dd><dt>{pt(l,'domain')}</dt><dd>{d.intent.payment_domain}</dd><dt>{pt(l,'amount')}</dt><dd>{fmt(d.intent.amount_minor,d.intent.currency,l)}</dd><dt>{pt(l,'status')}</dt><dd>{d.intent.status}</dd>{d.intent.provider_code&&<><dt>{pt(l,'provider')}</dt><dd>{d.intent.provider_code}</dd></>}{d.intent.created_at&&<><dt>{pt(l,'due')}</dt><dd>{date(d.intent.created_at,l)}</dd></>}</dl>
  <h3>{pt(l,'transactions')}</h3>{d.transactions.length?<ul className="pay-list">{d.transactions.map(t=><li className="pay-row" key={t.id}><div><strong>{fmt(t.amount_minor,t.currency,l)}</strong><small>{t.transaction_type} · {t.external_transaction_id}</small></div><span className="pay-tag">{t.status}</span></li>)}</ul>:<p>{pt(l,'noTransactions')}</p>}
  <h3>{pt(l,'allocations')}</h3>{d.allocations.length?<ul className="pay-list">{d.allocations.map(a=><li className="pay-row" key={a.invoice_id}><div><strong>{fmt(a.amount_minor,d.intent.currency,l)}</strong><small>{pt(l,'invoice')} {a.invoice_id.slice(0,8)}</small></div></li>)}</ul>:<p>{pt(l,'none')}</p>}
  <p className="pay-note">{pt(l,'verifyNote')}</p>
  {err&&<div className="pay-msg" role="alert">{err}</div>}
  <div className="pay-actions"><button className="p-button orange" disabled={!ready||verify.isPending} data-testid="button-verify-intent" onClick={()=>{setErr(undefined);verify.mutate({id},{onSuccess:()=>{void q.refetch();onVerified()},onError:e=>setErr(msg(e,l))})}}><ShieldCheck size={16}/>{pt(l,'verify')}</button></div></div>}</Dialog>}

export function PaymentsInner({c,language:l,currency}:Props){
 void currency;
 const key=wsKey(c);
 const q=useGetPaymentsWorkspace({query:{queryKey:key}});
 const refresh=()=>void q.refetch();
 const save=useSavePaymentProviderInstance(),test=useTestPaymentProviderInstance(),disable=useDisablePaymentProviderInstance(),issue=useIssuePlatformBillingInvoice(),create=useCreateOnlinePaymentIntent();
 const platform=c.shell==='platform';
 const allowed=platform?['ameriabank','telcell']:['arca'];
 const [setup,setSetup]=useState({providerCode:allowed[0],environment:'sandbox',clientId:'',username:'',password:''});
 const [setupMsg,setSetupMsg]=useState<{ok:boolean;text:string}>();
 const [tests,setTests]=useState<Record<string,string>>({});
 const [confirm,setConfirm]=useState<PaymentProviderInstance>();
 const [issueForm,setIssueForm]=useState({subscriptionId:'',period:'',dueOn:''});const opKeys=useRef<Record<string,{sig:string;key:string}>>({});const opKey=(name:string,sig:string)=>{const k=opKeys.current[name];if(k&&k.sig===sig)return k.key;const key=crypto.randomUUID();opKeys.current[name]={sig,key};return key};const [selected,setSelected]=useState<string[]>([]);const [issueMsg,setIssueMsg]=useState<{ok:boolean;text:string}>();
 const [receipt,setReceipt]=useState<string|undefined>(()=>new URLSearchParams(location.search).get('payment')||undefined);const [returned,setReturned]=useState(()=>!!new URLSearchParams(location.search).get('payment'));const [payMsg,setPayMsg]=useState<string>();
 if(q.isLoading)return <Skeleton/>;
 if(q.isError||!q.data)return <Failure l={l} onRetry={refresh}/>;
 const w=q.data,ready=w.readiness.onlineAvailable;
 const defs=w.providers.filter(p=>allowed.includes(p.code)&&p.scope!=='contract_required');
 const existing=w.instances.find(i=>i.provider_code===setup.providerCode&&i.environment===setup.environment);
 const hasCreds=setup.providerCode==='ameriabank';
 const submitSetup=(e:FormEvent)=>{e.preventDefault();setSetupMsg(undefined);
  const credentials=hasCreds&&(setup.clientId||setup.username||setup.password)?{clientId:setup.clientId,username:setup.username,password:setup.password}:undefined;
  save.mutate({data:{providerCode:setup.providerCode as PaymentProviderSetupInputProviderCode,environment:setup.environment as PaymentProviderSetupInputEnvironment,...(existing?{revision:existing.revision}:{}),...(credentials?{credentials}:{})}},{onSuccess:()=>{setSetup(s=>({...s,clientId:'',username:'',password:''}));setTests({});setSetupMsg({ok:true,text:pt(l,'saved')});refresh()},onError:er=>{setSetup(s=>({...s,password:''}));setSetupMsg({ok:false,text:msg(er,l)})}})};
 const submitIssue=(e:FormEvent)=>{e.preventDefault();setIssueMsg(undefined);
  issue.mutate({data:{subscriptionId:issueForm.subscriptionId,period:issueForm.period,dueOn:issueForm.dueOn,key:opKey('issue',JSON.stringify(issueForm))}},{onSuccess:()=>{delete opKeys.current.issue;setIssueForm({subscriptionId:'',period:'',dueOn:''});setIssueMsg({ok:true,text:pt(l,'issued')});refresh()},onError:er=>setIssueMsg({ok:false,text:msg(er,l)})})};
 // Intent creation is attempted only when the server reports readiness; the result is shown as a receipt, never as a redirect.
 const startIntent=(body:{domain:OnlinePaymentIntentInputDomain;platformInvoiceId?:string;invoiceIds?:string[];allocationStrategy?:OnlinePaymentIntentInputAllocationStrategy})=>{setPayMsg(undefined);const name=JSON.stringify(body);create.mutate({data:{...body,key:opKey('intent',name)}},{onSuccess:(i:OnlinePaymentIntent)=>{delete opKeys.current.intent;setSelected([]);refresh();setReceipt(i.id)},onError:er=>{setPayMsg(msg(er,l));refresh()}})};
 const payable=w.payableInvoices??[];const chosen=payable.filter(i=>selected.includes(i.id));const currencies=new Set(chosen.map(i=>i.currency));const mixed=currencies.size>1;
 const closeReceipt=()=>{setReceipt(undefined);if(returned){setReturned(false);const u=new URL(location.href);u.searchParams.delete('payment');history.replaceState(null,'',u.pathname+u.search)}};
 const providerLabel=(code:string)=>w.providers.find(p=>p.code===code)?.name??code;
 return <div className="pay" data-testid="payments-workspace">
  <div className="pay-hero"><h2>{pt(l,'title')}</h2><p>{pt(l,'lede')}</p></div>
  <Banner r={w.readiness} l={l}/>
  {payMsg&&<div className="pay-msg" role="alert">{payMsg}</div>}
  <div className="pay-grid">
   <section className="p-card"><header><Landmark size={20}/><h2>{pt(l,'providers')}</h2></header><ul className="pay-list">{w.providers.map(p=><li className="pay-row" key={p.code} data-testid={'provider-'+p.code}><div><strong>{p.name}</strong><small>{p.domain} · {p.scope==='contract_required'?pt(l,'scopeUnresolved'):allowed.includes(p.code)?pt(l,platform?'platformScope':'orgScope'):pt(l,'readOnlyProvider')}</small></div><span className={'pay-tag '+(p.status==='CONTRACT_REQUIRED'?'warn':'')}>{p.status==='CONTRACT_REQUIRED'?pt(l,'contractRequired'):p.status}</span></li>)}</ul></section>
   {w.canConfigure&&defs.length>0&&<section className="p-card"><header><CreditCard size={20}/><h2>{pt(l,'setup')}</h2></header>
    {hasCreds&&<p className="pay-note">{pt(l,'connectionHint')}</p>}
    <form className="pay-form" onSubmit={submitSetup} autoComplete="off">
     <div className="two"><label>{pt(l,'provider')}<select value={setup.providerCode} data-testid="select-provider" onChange={e=>setSetup({...setup,providerCode:e.target.value,clientId:'',username:'',password:''})}>{defs.map(p=><option key={p.code} value={p.code}>{p.name}</option>)}</select></label>
     <label>{pt(l,'environment')}<select value={setup.environment} onChange={e=>setSetup({...setup,environment:e.target.value})}><option value="sandbox">{pt(l,'sandbox')}</option><option value="production">{pt(l,'production')}</option></select></label></div>
     {hasCreds?<><label>{pt(l,'clientId')}<input type="password" autoComplete="off" value={setup.clientId} onChange={e=>setSetup({...setup,clientId:e.target.value})} maxLength={200}/></label>
      <div className="two"><label>{pt(l,'username')}<input type="password" autoComplete="off" value={setup.username} onChange={e=>setSetup({...setup,username:e.target.value})} maxLength={200}/></label><label>{pt(l,'password')}<input type="password" autoComplete="new-password" value={setup.password} onChange={e=>setSetup({...setup,password:e.target.value})} maxLength={200}/></label></div><small className="pay-note">{pt(l,'writeOnly')}</small></>:<p className="pay-note">{pt(l,'noCredFields')}</p>}
     {existing&&<small className="pay-note">{pt(l,'revision')}: {existing.revision}</small>}
     {setupMsg&&<div className={'pay-msg '+(setupMsg.ok?'pay-ok':'')} role={setupMsg.ok?'status':'alert'}>{setupMsg.text}</div>}
     <button className="p-button orange" disabled={save.isPending} data-testid="button-save-provider">{pt(l,'save')}</button></form></section>}
  </div>
  <section className="p-card"><header><ShieldCheck size={20}/><h2>{pt(l,'instances')}</h2></header>
   {w.instances.filter(i=>i.provider_code==='ameriabank'&&savedConnection(i,l)).map(i=><p className="pay-note" role="status" key={'connection-'+i.id}>{providerLabel(i.provider_code)} · {i.environment}: {savedConnection(i,l)}</p>)}
   {w.instances.length===0?<p>{pt(l,'noInstances')}</p>:<ul className="pay-list">{w.instances.map(i=><li className="pay-row" key={i.id} data-testid={'instance-'+i.id}><div><strong>{providerLabel(i.provider_code)} · {i.environment}</strong><small>{i.status} · {pt(l,i.credentials_configured?'credsSaved':'credsMissing')} · {pt(l,'revision')} {i.revision}</small>{tests[i.id]&&<small>{pt(l,'testResult')}: {tests[i.id]}</small>}</div>
    {w.canConfigure&&<div className="pay-actions"><button className="p-button small" disabled={test.isPending||i.status==='disabled'} onClick={()=>test.mutate({id:i.id},{onSuccess:r=>{setTests(s=>({...s,[i.id]:r.status==='connected'?pt(l,'connected'):r.reason==='authentication_rejected'?pt(l,'authentication_rejected'):r.reason==='credentials_missing'?pt(l,'credentials_missing'):i.provider_code==='ameriabank'?pt(l,'connectionFailed')+' · '+r.reason:r.status+' · '+r.reason}));refresh()},onError:er=>setTests(s=>({...s,[i.id]:msg(er,l)}))})}>{pt(l,'test')}</button><button className="p-button small" disabled={disable.isPending||i.status==='disabled'} onClick={()=>setConfirm(i)}>{pt(l,'disable')}</button></div>}</li>)}</ul>}
  </section>
  {(w.canIssuePlatformInvoice||w.platformInvoices.length>0)&&<section className="p-card"><header><ReceiptText size={20}/><h2>{pt(l,'invoices')}</h2></header>
   {w.canIssuePlatformInvoice&&<form className="pay-form" onSubmit={submitIssue}><h3>{pt(l,'issueInvoice')}</h3><p className="pay-note">{pt(l,'issueHint')}</p>
    <label>{pt(l,'subscription')}<select required value={issueForm.subscriptionId} data-testid="select-subscription" onChange={e=>setIssueForm({...issueForm,subscriptionId:e.target.value})}><option value="">—</option>{w.subscriptions.map(s=><option key={s.id} value={s.id}>{s.organization_name} · {s.name} · {fmt(s.amount_minor,s.currency,l)}</option>)}</select></label>
    <div className="two"><label>{pt(l,'period')}<input type="month" required value={issueForm.period} onChange={e=>setIssueForm({...issueForm,period:e.target.value})}/></label><label>{pt(l,'dueOn')}<input type="date" required value={issueForm.dueOn} onChange={e=>setIssueForm({...issueForm,dueOn:e.target.value})}/></label></div>
    {issueMsg&&<div className={'pay-msg '+(issueMsg.ok?'pay-ok':'')} role={issueMsg.ok?'status':'alert'}>{issueMsg.text}</div>}
    <button className="p-button orange" disabled={issue.isPending} data-testid="button-issue-invoice">{pt(l,'issue')}<ArrowRight size={16}/></button></form>}
   {w.platformInvoices.length===0?<p>{pt(l,'noInvoices')}</p>:<ul className="pay-list" style={{marginTop:14}}>{w.platformInvoices.map(inv=><li className="pay-row" key={inv.id}><div><strong>{inv.billing_period} · {fmt(inv.amount_minor,inv.currency,l)}</strong><small>{pt(l,'paid')}: {fmt(inv.paid_minor??'0',inv.currency,l)}{inv.due_at?' · '+pt(l,'due')+' '+date(inv.due_at,l):''}</small></div><div className="pay-actions"><span className="pay-tag">{inv.status}</span>{!platform&&<button className="p-button small orange" disabled={!ready||create.isPending} title={ready?undefined:pt(l,'payBlocked')} data-testid={'button-pay-'+inv.id} onClick={()=>startIntent({domain:'platform',platformInvoiceId:inv.id})}>{pt(l,'pay')}</button>}</div></li>)}</ul>}
  </section>}
  <section className="p-card"><header><CreditCard size={20}/><h2>{pt(l,'intents')}</h2></header>
   {!platform&&<div className="pay-form" style={{marginBottom:14}}><h3>{pt(l,'payable')}</h3>{payable.length===0?<p>{pt(l,'noPayable')}</p>:<ul className="pay-list">{payable.map(i=><li className="pay-row" key={i.id}><label style={{flexDirection:'row',alignItems:'center'}}><input type="checkbox" style={{width:18,minHeight:18}} checked={selected.includes(i.id)} onChange={e=>setSelected(e.target.checked?[...selected,i.id]:selected.filter(x=>x!==i.id))} data-testid={'check-invoice-'+i.id}/><span>{i.period} · {fmt(i.balance_minor,i.currency,l)}</span></label></li>)}</ul>}{mixed&&<div className="pay-msg" role="alert">{pt(l,'mixedCurrency')}</div>}<div><button className="p-button orange" disabled={!ready||create.isPending||chosen.length===0||mixed} title={ready?undefined:pt(l,'payBlocked')} data-testid="button-pay-property" onClick={()=>startIntent({domain:'property',invoiceIds:chosen.map(i=>i.id),allocationStrategy:'selected_invoices'})}>{pt(l,'pay')}</button></div></div>}
   {!ready&&<p className="pay-note">{pt(l,'payBlocked')}</p>}
   {w.intents.length===0?<p>{pt(l,'noIntents')}</p>:<ul className="pay-list">{w.intents.map(i=><li className="pay-row" key={i.id} data-testid={'intent-'+i.id}><div><strong>{i.public_reference} · {fmt(i.amount_minor,i.currency,l)}</strong><small>{i.payment_domain}{i.created_at?' · '+date(i.created_at,l):''}</small></div><div className="pay-actions"><span className="pay-tag">{i.status}</span><button className="p-button small" onClick={()=>setReceipt(i.id)}>{pt(l,'receipt')}</button></div></li>)}</ul>}
   {w.hasMore&&<p className="pay-note">{pt(l,'moreHint')}</p>}
  </section>
  {receipt&&<Receipt id={receipt} l={l} ready={ready} auto={returned} onClose={closeReceipt} onVerified={refresh}/>}
  {confirm&&<Dialog title={pt(l,'disable')} l={l} onClose={()=>setConfirm(undefined)}><p>{pt(l,'disableConfirm')} {providerLabel(confirm.provider_code)} · {confirm.environment}</p><div className="p-modal-actions"><button className="p-button" onClick={()=>setConfirm(undefined)}>{pt(l,'cancel')}</button><button className="p-button orange" disabled={disable.isPending} onClick={()=>disable.mutate({id:confirm.id},{onSuccess:()=>{setConfirm(undefined);refresh()},onError:er=>{setConfirm(undefined);setSetupMsg({ok:false,text:msg(er,l)})}})}>{pt(l,'confirm')}</button></div></Dialog>}
 </div>}

export default function PaymentsWorkspace(p:Props){return p.c.role_key==='platform_admin'?<PlatformPaymentsConsole c={p.c} language={p.language}/>:<Scoped c={p.c}><PaymentsInner {...p}/></Scoped>}

function UtilitiesInner({c,language:l}:Props){
 const q=useGetUtilityBillingWorkspace({query:{queryKey:[...getGetUtilityBillingWorkspaceQueryKey(),c.id]}});
 if(q.isLoading)return <Skeleton/>;if(q.isError||!q.data)return <Failure l={l} onRetry={()=>void q.refetch()}/>;
 const u=q.data;
 return <div className="pay" data-testid="utilities-workspace"><div className="pay-hero"><h2>{pt(l,'utilities')}</h2><p>{pt(l,'utilLede')}</p></div>
  <div className="pay-ready" role="status"><Zap size={22}/><div><strong>{u.status==='CONTRACT_REQUIRED'?pt(l,'contractRequired'):u.status}</strong><p>{pt(l,'noCheckout')}</p></div></div>
  <div className="pay-grid"><section className="p-card"><h2>{pt(l,'catalog')}</h2>{u.catalog.length?<ul className="pay-list">{u.catalog.map(e=><li className="pay-row" key={e.id}><div><strong>{e.name}</strong><small>{e.utility_type}</small></div></li>)}</ul>:<p>{pt(l,'noCatalog')}</p>}</section>
  <section className="p-card"><h2>{pt(l,'accounts')}</h2>{u.accounts.length?<ul className="pay-list">{u.accounts.map(a=><li className="pay-row" key={a.id}><div><strong>{a.display_name}</strong><small>{a.subscriber_number_masked}</small></div><span className="pay-tag">{a.status}</span></li>)}</ul>:<p>{pt(l,'noAccounts')}</p>}</section></div>
  <section className="p-card"><h2>{pt(l,'balance')}</h2>{u.balanceState==='unavailable'?<p data-testid="text-utility-balance">{pt(l,'balanceUnavailable')}</p>:<p>{u.balanceState}</p>}<small className="pay-note">{pt(l,'capabilities')}: {u.capabilities.length?u.capabilities.join(', '):pt(l,'none')}</small></section></div>}
export function UtilitiesWorkspace(p:Props){return <Scoped c={p.c}><UtilitiesInner {...p}/></Scoped>}

function ReadinessInner({c,language:l,onOpen}:Props&{onOpen?:()=>void}){
 const q=useGetPaymentsWorkspace({query:{queryKey:wsKey(c)}});
 return <section className="p-card" data-testid="online-payment-readiness"><header><CreditCard size={20}/><h2>{pt(l,'readiness')}</h2></header>{q.isLoading?<div className="pay-skel"/>:q.isError||!q.data?<Failure l={l} onRetry={()=>void q.refetch()}/>:<div className="pay-compact"><div style={{flex:1,minWidth:240}}><Banner r={q.data.readiness} l={l}/></div>{onOpen&&<button className="p-button" onClick={onOpen}>{pt(l,'openPayments')}<ArrowRight size={16}/></button>}</div>}</section>}
export function OnlinePaymentReadiness(p:Props&{onOpen?:()=>void}){return <Scoped c={p.c}><ReadinessInner {...p}/></Scoped>}
