import {useState,type ComponentType,type ReactNode} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {CalendarDays,Check,RefreshCw,UserRound,X} from 'lucide-react';
import {getListOwnerAccessRequestsQueryKey,useDecideOwnerAccessRequest,useListOwnerAccessRequests} from '@workspace/api-client-react';
import type {OwnerAccessRequest} from '@workspace/api-client-react';
import type {Language} from './i18n';
import type {RoleContext} from './types';
import './owner-access-queue.css';

type Props={
 language:Language;
 context:RoleContext;
 ErrorNotice:ComponentType<{error:unknown}>;
 Modal:ComponentType<{title:string;onClose:()=>void;children:ReactNode}>;
};

export default function OwnerAccessQueue({language,context,ErrorNotice,Modal}:Props){
 const tr=(hy:string,ru:string,en:string)=>language==='hy'?hy:language==='ru'?ru:en;
 const isAuthorizedOrgAdmin=context.role_key==='org_admin'&&!!context.organization_id&&context.permissions.includes('roles.assign');
 const query=useListOwnerAccessRequests({query:{enabled:isAuthorizedOrgAdmin,queryKey:[...getListOwnerAccessRequestsQueryKey(),context.id]}});
 const decide=useDecideOwnerAccessRequest();
 const queryClient=useQueryClient();
 const [selected,setSelected]=useState<OwnerAccessRequest|null>(null);
 const [decision,setDecision]=useState<'approve'|'reject'>('approve');
 const [reason,setReason]=useState('');
 const [actionError,setActionError]=useState<unknown>();
 const [success,setSuccess]=useState('');
 const items=query.data?.requests??[];

 async function submit(){
  if(!selected||decide.isPending)return;
  setActionError(undefined);
  try{
   await decide.mutateAsync({id:selected.id,data:{decision,...(decision==='reject'?{note:reason.trim()}:{})}});
   setSuccess(tr('Հարցումն ավարտված է։','Запрос обработан.','Request reviewed.'));
   setSelected(null);setReason('');
   await queryClient.invalidateQueries({queryKey:getListOwnerAccessRequestsQueryKey()});
  }catch(error){setActionError(error)}
 }
 function open(item:OwnerAccessRequest,next:'approve'|'reject'){
  setSelected(item);setDecision(next);setReason('');setActionError(undefined);
 }
 const dateLabel=(value:string)=>{const parsed=new Date(value);return Number.isNaN(parsed.getTime())?value:new Intl.DateTimeFormat(language==='hy'?'hy-AM':language==='ru'?'ru-RU':'en-GB',{dateStyle:'medium',timeStyle:'short'}).format(parsed)};
 if(!isAuthorizedOrgAdmin)return null;

 return <section className="p-card owner-queue" aria-labelledby="owner-queue-title">
  <header className="owner-queue-head">
   <div><span className="owner-queue-kicker">{tr('ԿԱԶՄԱԿԵՐՊՈՒԹՅԱՆ ՄՈՒՏՔ','ДОСТУП ОРГАНИЗАЦИИ','ORGANIZATION ACCESS')}</span>
    <h2 id="owner-queue-title">{tr('Սեփականատիրոջ մուտքի հարցումներ','Запросы владельцев','Owner access requests')}</h2>
    <p>{tr('Ստուգեք սեփականատիրոջ հայտերը ձեր կազմակերպության շենքերի համար։','Проверяйте заявки владельцев только для зданий вашей организации.','Review owner applications for buildings in your organization only.')}</p>
   </div>
   <button className="p-button small owner-refresh" type="button" onClick={()=>{setSuccess('');void query.refetch()}} disabled={query.isFetching} data-testid="button-refresh-owner-requests">
    <RefreshCw size={16} className={query.isFetching?'owner-spin':''}/>{tr('Թարմացնել','Обновить','Refresh')}
   </button>
  </header>
  {success&&<p className="owner-success" role="status" data-testid="status-owner-request-success"><Check size={16}/>{success}</p>}
  {query.isError&&<div className="owner-error-state"><ErrorNotice error={query.error}/><button type="button" className="p-button small" onClick={()=>void query.refetch()}>{tr('Կրկին փորձել','Повторить','Retry')}</button></div>}
  {query.isLoading?<div className="owner-skeletons" role="status" aria-label={tr('Բեռնվում է','Загрузка','Loading')} data-testid="status-owner-requests-loading">{[0,1,2].map(n=><div className="owner-skeleton" key={n}><i/><span><i/><i/></span><i/></div>)}</div>
   :query.isError?null:items.length===0?<div className="owner-empty" data-testid="state-owner-requests-empty"><span className="owner-empty-icon"><Check size={22}/></span><strong>{tr('Սպասվող հարցումներ չկան','Нет ожидающих запросов','No requests waiting')}</strong><p>{tr('Նոր հայտերը կհայտնվեն այստեղ։','Новые заявки появятся здесь.','New applications will appear here when submitted.')}</p></div>
   :<div className="owner-requests" data-testid="list-owner-requests">{items.map(item=><article className="owner-request" key={item.id} data-testid={`row-owner-request-${item.id}`}>
    <div className="owner-applicant-mark"><UserRound size={19}/></div>
    <div className="owner-request-main"><div className="owner-name-line"><h3>{item.applicantName}</h3><span className="owner-pending">{tr('ՍՊԱՍՈՒՄ Է','ОЖИДАЕТ','PENDING')}</span></div>
     <a className="owner-email" href={`mailto:${item.applicantEmail}`}>{item.applicantEmail}</a>
     <div className="owner-meta"><span>{item.buildingName}</span><span>{tr('Բնակարան','Квартира','Unit')} {item.unitNumber}</span><span><CalendarDays size={14}/>{dateLabel(item.requestedAt)}</span></div>
    </div>
    <div className="owner-actions"><button className="p-button small owner-approve" type="button" onClick={()=>open(item,'approve')} data-testid={`button-approve-owner-${item.id}`}><Check size={15}/>{tr('Հաստատել','Одобрить','Approve')}</button><button className="p-button small owner-reject" type="button" onClick={()=>open(item,'reject')} data-testid={`button-reject-owner-${item.id}`}><X size={15}/>{tr('Մերժել','Отклонить','Reject')}</button></div>
   </article>)}</div>}
  {selected&&<Modal title={decision==='approve'?tr('Հաստատել մուտքի հարցումը','Подтвердить запрос доступа','Approve access request'):tr('Մերժել մուտքի հարցումը','Отклонить запрос доступа','Reject access request')} onClose={()=>{if(!decide.isPending)setSelected(null)}}>
   <div className="owner-confirm"><p>{tr('Դուք պատրաստվում եք','Вы собираетесь','You are about to')} <strong>{decision==='approve'?tr('հաստատել','одобрить','approve'):tr('մերժել','отклонить','reject')}</strong> {tr('հետևյալ դիմորդի հարցումը՝','запрос пользователя:','the access request from:')}</p><div className="owner-confirm-person"><strong>{selected.applicantName}</strong><span>{selected.applicantEmail}</span><span>{selected.buildingName} · {tr('Բնակարան','Квартира','Unit')} {selected.unitNumber}</span></div>
    {decision==='reject'&&<label>{tr('Մերժման պատճառը','Причина отказа','Reason for rejection')}<textarea data-testid="input-owner-rejection-reason" required minLength={3} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder={tr('Գրեք պատճառը դիմորդի համար…','Укажите причину для заявителя…','Explain the decision to the applicant…')}/></label>}
    {actionError?<ErrorNotice error={actionError}/>:null}
    <div className="owner-confirm-actions"><button className="p-button small" type="button" disabled={decide.isPending} onClick={()=>setSelected(null)}>{tr('Չեղարկել','Отмена','Cancel')}</button><button className={`p-button small ${decision==='approve'?'orange':'owner-danger'}`} type="button" disabled={decide.isPending||(decision==='reject'&&reason.trim().length<3)} onClick={()=>void submit()} data-testid="button-confirm-owner-decision">{decide.isPending?tr('Պահպանվում է…','Сохраняется…','Saving…'):decision==='approve'?tr('Հաստատել հարցումը','Подтвердить запрос','Confirm approval'):tr('Մերժել հարցումը','Отклонить запрос','Confirm rejection')}</button></div>
   </div>
  </Modal>}
 </section>;
}
