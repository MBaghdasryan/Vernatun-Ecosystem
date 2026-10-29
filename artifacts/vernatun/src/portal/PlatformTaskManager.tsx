import {useCallback,useEffect,useMemo,useState,type ComponentType,type FormEvent,type ReactNode} from 'react';
import {Archive,Building2,CalendarDays,Check,Clock3,Download,ListTodo,MessageCircle,Paperclip,Pencil,Plus,Search,Send,UserRound} from 'lucide-react';
import {downloadFile,request,uploadPlatformTaskAttachment} from './client';
import {type Language} from './i18n';
import type {RoleContext} from './types';
import './platform-task-manager.css';

type Status='todo'|'in_progress'|'blocked'|'done';
type Priority='low'|'normal'|'high'|'urgent';
type Task={id:string;title:string;description:string;status:Status;priority:Priority;organizationId:string|null;organizationName:string|null;assigneeId:string|null;assigneeName:string|null;dueOn:string|null;version:number;createdAt:string;updatedAt:string};
type Activity={id:string;type:'comment'|'attachment';content:string|null;fileName:string|null;mediaType:string|null;byteSize:string|number|null;author:string;createdAt:string};
type SelectItem={id:string;name:string};
type BoardData={tasks:Task[];organizations:SelectItem[];assignees:SelectItem[]};
type ModalComponent=ComponentType<{title:string;onClose:()=>void;children:ReactNode}>;
type ErrorComponent=ComponentType<{error:unknown}>;
type Props={c:RoleContext;language:Language;Modal:ModalComponent;ErrorNotice:ErrorComponent};
type Draft={title:string;description:string;status:Status;priority:Priority;organizationId:string;assigneeId:string;dueOn:string};
type Copy={subtitle:string;newTask:string;search:string;organization:string;allOrganizations:string;noOrganization:string;assignee:string;anyAssignee:string;priority:string;allPriorities:string;dueFrom:string;dueTo:string;clear:string;loading:string;retry:string;empty:string;createFirst:string;todo:string;inProgress:string;blocked:string;done:string;created:string;urgent:string;high:string;normal:string;low:string;noAssignee:string;noDueDate:string;due:string;overdue:string;edit:string;createTitle:string;editTitle:string;taskTitle:string;description:string;status:string;save:string;cancel:string;saving:string;archive:string;archiveConfirm:string;archiving:string;filters:string;allTasks:string;invalidRange:string;loadFailed:string;saveFailed:string;archiveFailed:string;moveFailed:string;taskCount:string;taskDescription:string;discussion:string;commentPlaceholder:string;sendComment:string;sendingComment:string;attachment:string;uploadAttachment:string;uploading:string;download:string;noActivity:string;activityFailed:string;attachmentFailed:string;commentFailed:string;supportedFiles:string};
const TEXT:Record<Language,Copy>={
 hy:{subtitle:'Վերնատունի ներքին աշխատանքների Kanban տախտակ',newTask:'Նոր առաջադրանք',search:'Որոնել առաջադրանքներ',organization:'Կազմակերպություն',allOrganizations:'Բոլոր կազմակերպությունները',noOrganization:'Առանց կազմակերպության',assignee:'Պատասխանատու',anyAssignee:'Բոլորը',priority:'Առաջնահերթություն',allPriorities:'Բոլորը',dueFrom:'Ժամկետը՝ սկսած',dueTo:'Ժամկետը՝ մինչև',clear:'Մաքրել զտիչները',loading:'Բեռնվում է…',retry:'Կրկնել',empty:'Այս սյունակում առաջադրանքներ չկան։',createFirst:'Ստեղծել առաջադրանք',todo:'Անելիք',inProgress:'Ընթացքում',blocked:'Արգելափակված',done:'Ավարտված',created:'Ստեղծված է',urgent:'Շտապ',high:'Բարձր',normal:'Սովորական',low:'Ցածր',noAssignee:'Նշանակված չէ',noDueDate:'Ժամկետ սահմանված չէ',due:'Ժամկետ',overdue:'Ժամկետանց',edit:'Խմբագրել',createTitle:'Նոր առաջադրանք',editTitle:'Խմբագրել առաջադրանքը',taskTitle:'Վերնագիր',description:'Նկարագրություն',status:'Կարգավիճակ',save:'Պահպանել',cancel:'Չեղարկել',saving:'Պահպանվում է…',archive:'Արխիվացնել',archiveConfirm:'Արխիվացնե՞լ այս առաջադրանքը։ Այն կանհետանա տախտակից, բայց կմնա գործողությունների մատյանում։',archiving:'Արխիվացվում է…',filters:'Զտիչներ',allTasks:'Բոլոր առաջադրանքները',invalidRange:'Սկզբի ամսաթիվը պետք է լինի մինչև ավարտի ամսաթիվը։',loadFailed:'Չհաջողվեց բեռնել առաջադրանքները։',saveFailed:'Չհաջողվեց պահպանել առաջադրանքը։',archiveFailed:'Չհաջողվեց արխիվացնել առաջադրանքը։',moveFailed:'Չհաջողվեց փոխել կարգավիճակը։',taskCount:'առաջադրանք',taskDescription:'Պլանավորեք, հանձնարարեք և հետևեք Vernatun-ի ներքին աշխատանքներին։',discussion:'Մեկնաբանություններ և ֆայլեր',commentPlaceholder:'Գրեք մեկնաբանություն…',sendComment:'Ավելացնել մեկնաբանություն',sendingComment:'Ուղարկվում է…',attachment:'Կցված ֆայլ',uploadAttachment:'Կցել ֆայլ',uploading:'Վերբեռնվում է…',download:'Ներբեռնել',noActivity:'Մեկնաբանություններ կամ ֆայլեր դեռ չկան։',activityFailed:'Չհաջողվեց բեռնել քննարկումը։',attachmentFailed:'Չհաջողվեց կցել ֆայլը։',commentFailed:'Չհաջողվեց ավելացնել մեկնաբանությունը։',supportedFiles:'PDF, PNG, JPEG կամ WebP · մինչև 6 ՄԲ'},
 ru:{subtitle:'Внутренние задачи Vernatun — доска Kanban',newTask:'Новая задача',search:'Поиск задач',organization:'Компания',allOrganizations:'Все компании',noOrganization:'Без компании',assignee:'Ответственный',anyAssignee:'Любой',priority:'Приоритет',allPriorities:'Любой приоритет',dueFrom:'Срок с',dueTo:'Срок по',clear:'Сбросить фильтры',loading:'Загрузка…',retry:'Повторить',empty:'В этой колонке пока нет задач.',createFirst:'Создать задачу',todo:'К выполнению',inProgress:'В работе',blocked:'Заблокировано',done:'Готово',created:'Создана',urgent:'Срочно',high:'Высокий',normal:'Обычный',low:'Низкий',noAssignee:'Не назначен',noDueDate:'Без срока',due:'Срок',overdue:'Просрочена',edit:'Изменить',createTitle:'Новая задача',editTitle:'Изменить задачу',taskTitle:'Название',description:'Описание',status:'Статус',save:'Сохранить',cancel:'Отмена',saving:'Сохранение…',archive:'В архив',archiveConfirm:'Архивировать эту задачу? Она исчезнет с доски, но останется в журнале действий.',archiving:'Архивирование…',filters:'Фильтры',allTasks:'Всего задач',invalidRange:'Начальная дата должна быть раньше конечной.',loadFailed:'Не удалось загрузить задачи.',saveFailed:'Не удалось сохранить задачу.',archiveFailed:'Не удалось архивировать задачу.',moveFailed:'Не удалось изменить статус.',taskCount:'задач',taskDescription:'Создавайте задачи, назначайте ответственных и отслеживайте работу Vernatun.',discussion:'Обсуждение и файлы',commentPlaceholder:'Напишите комментарий…',sendComment:'Добавить комментарий',sendingComment:'Отправка…',attachment:'Файл',uploadAttachment:'Прикрепить файл',uploading:'Загрузка…',download:'Скачать',noActivity:'Пока нет комментариев и файлов.',activityFailed:'Не удалось загрузить обсуждение.',attachmentFailed:'Не удалось прикрепить файл.',commentFailed:'Не удалось добавить комментарий.',supportedFiles:'PDF, PNG, JPEG или WebP · до 6 МБ'},
 en:{subtitle:'Internal Vernatun work, organized on a Kanban board',newTask:'New task',search:'Search tasks',organization:'Organization',allOrganizations:'All organizations',noOrganization:'No organization',assignee:'Assignee',anyAssignee:'Anyone',priority:'Priority',allPriorities:'Any priority',dueFrom:'Due from',dueTo:'Due through',clear:'Clear filters',loading:'Loading…',retry:'Retry',empty:'No tasks in this column yet.',createFirst:'Create a task',todo:'To do',inProgress:'In progress',blocked:'Blocked',done:'Done',created:'Created',urgent:'Urgent',high:'High',normal:'Normal',low:'Low',noAssignee:'Unassigned',noDueDate:'No due date',due:'Due',overdue:'Overdue',edit:'Edit',createTitle:'New task',editTitle:'Edit task',taskTitle:'Title',description:'Description',status:'Status',save:'Save',cancel:'Cancel',saving:'Saving…',archive:'Archive',archiveConfirm:'Archive this task? It will disappear from the board but remain in the audit log.',archiving:'Archiving…',filters:'Filters',allTasks:'All tasks',invalidRange:'The start date must be earlier than the end date.',loadFailed:'Could not load tasks.',saveFailed:'Could not save the task.',archiveFailed:'Could not archive the task.',moveFailed:'Could not change the status.',taskCount:'tasks',taskDescription:'Create tasks, assign owners, and track Vernatun internal work.',discussion:'Discussion and files',commentPlaceholder:'Write a comment…',sendComment:'Add comment',sendingComment:'Sending…',attachment:'Attachment',uploadAttachment:'Attach a file',uploading:'Uploading…',download:'Download',noActivity:'No comments or files yet.',activityFailed:'Could not load the discussion.',attachmentFailed:'Could not attach the file.',commentFailed:'Could not add the comment.',supportedFiles:'PDF, PNG, JPEG, or WebP · up to 6 MB'}
};
const STATUS:Status[]=['todo','in_progress','blocked','done'];
const PRIORITIES:Priority[]=['urgent','high','normal','low'];
const freshDraft=():Draft=>({title:'',description:'',status:'todo',priority:'normal',organizationId:'',assigneeId:'',dueOn:''});
const localToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Yerevan'}).format(new Date());

export default function PlatformTaskManager({c,language,Modal,ErrorNotice}:Props){
 const copy=TEXT[language]??TEXT.ru;
 const [data,setData]=useState<BoardData>();
 const [error,setError]=useState<unknown>();
 const [loading,setLoading]=useState(true);
 const [revision,setRevision]=useState(0);
 const [searchInput,setSearchInput]=useState('');
 const [query,setQuery]=useState('');
 const [organizationId,setOrganizationId]=useState('');
 const [assigneeId,setAssigneeId]=useState('');
 const [priority,setPriority]=useState('');
 const [dueFrom,setDueFrom]=useState('');
 const [dueTo,setDueTo]=useState('');
 const [editing,setEditing]=useState<Task|null>(null);
 const [creating,setCreating]=useState(false);
 const [draft,setDraft]=useState<Draft>(freshDraft);
 const [busy,setBusy]=useState(false);
 const [busyTask,setBusyTask]=useState<string|null>(null);
 const [moving,setMoving]=useState<string|null>(null);
 const [archiveConfirm,setArchiveConfirm]=useState(false);
  const [activity,setActivity]=useState<Activity[]>([]);
  const [activityLoading,setActivityLoading]=useState(false);
  const [activityRevision,setActivityRevision]=useState(0);
  const [activityError,setActivityError]=useState('');
  const [comment,setComment]=useState('');
  const [commentBusy,setCommentBusy]=useState(false);
  const [attachmentBusy,setAttachmentBusy]=useState(false);
 const dateRangeInvalid=Boolean(dueFrom&&dueTo&&dueFrom>dueTo);

 const load=useCallback(async()=>{
  setLoading(true);setError(undefined);
  const params=new URLSearchParams();
  if(query)params.set('q',query);
  if(organizationId)params.set('organizationId',organizationId);
  if(assigneeId)params.set('assigneeId',assigneeId);
  if(priority)params.set('priority',priority);
  if(dueFrom)params.set('dueFrom',dueFrom);
  if(dueTo)params.set('dueTo',dueTo);
  try{const result=await request<BoardData>('/platform/tasks'+(params.size?'?'+params.toString():''));setData(result)}
  catch(err){setError(err)}
  finally{setLoading(false)}
 },[query,organizationId,assigneeId,priority,dueFrom,dueTo]);
 useEffect(()=>{if(!dateRangeInvalid)void load()},[load,revision,dateRangeInvalid]);
  const activeTaskId=editing?.id;
  useEffect(()=>{
   if(!creating||!activeTaskId){setActivity([]);return}
   let active=true;
   setActivityLoading(true);setActivityError('');
   request<{activity:Activity[]}>('/platform/tasks/'+activeTaskId+'/activity')
    .then(result=>{if(active)setActivity(result.activity)})
    .catch(()=>{if(active)setActivityError(copy.activityFailed)})
    .finally(()=>{if(active)setActivityLoading(false)});
   return()=>{active=false};
  },[creating,activeTaskId,activityRevision,copy.activityFailed]);

 const visibleTasks=data?.tasks??[];
 const totals=useMemo(()=>STATUS.reduce((acc,status)=>({...acc,[status]:visibleTasks.filter(task=>task.status===status).length}),{} as Record<Status,number>),[visibleTasks]);
 const priorityName=(value:Priority)=>value==='urgent'?copy.urgent:value==='high'?copy.high:value==='low'?copy.low:copy.normal;
 const statusName=(value:Status)=>value==='in_progress'?copy.inProgress:value==='blocked'?copy.blocked:value==='done'?copy.done:copy.todo;
 const clearFilters=()=>{setSearchInput('');setQuery('');setOrganizationId('');setAssigneeId('');setPriority('');setDueFrom('');setDueTo('')};
  const openNew=()=>{setEditing(null);setDraft(freshDraft());setComment('');setActivityError('');setArchiveConfirm(false);setCreating(true)};
  const openEdit=(task:Task)=>{setEditing(task);setDraft({title:task.title,description:task.description,status:task.status,priority:task.priority,organizationId:task.organizationId??'',assigneeId:task.assigneeId??'',dueOn:task.dueOn??''});setComment('');setActivityError('');setArchiveConfirm(false);setCreating(true)};
  const closeEditor=()=>{if(!busy&&!commentBusy&&!attachmentBusy){setCreating(false);setEditing(null);setArchiveConfirm(false)}};
 const submitSearch=(event:FormEvent)=>{event.preventDefault();setQuery(searchInput.trim())};
 const save=async(event:FormEvent)=>{
   event.preventDefault();if(busy||commentBusy||attachmentBusy)return;
  setBusy(true);
  const body={title:draft.title.trim(),description:draft.description,status:draft.status,priority:draft.priority,organizationId:draft.organizationId||null,assigneeId:draft.assigneeId||null,dueOn:draft.dueOn||null};
  try{
   if(editing)await request<Task>('/platform/tasks/'+editing.id,'PATCH',{...body,version:editing.version});
   else await request<Task>('/platform/tasks','POST',body);
   setCreating(false);setEditing(null);setRevision(value=>value+1);
  }catch(err){setError(err)}
  finally{setBusy(false)}
 };
 const archive=async()=>{
   if(!editing||busy||commentBusy||attachmentBusy)return;
  setBusy(true);
  try{await request('/platform/tasks/'+editing.id+'/archive','POST',{version:editing.version});setCreating(false);setEditing(null);setArchiveConfirm(false);setRevision(value=>value+1)}
  catch(err){setError(err)}
  finally{setBusy(false)}
 };
 const move=async(task:Task,status:Status)=>{
  if(task.status===status||busyTask)return;
  setBusyTask(task.id);setMoving(task.id);
  try{await request('/platform/tasks/'+task.id,'PATCH',{version:task.version,status});setRevision(value=>value+1)}
  catch(err){setError(err)}
  finally{setBusyTask(null);setMoving(null)}
 };
  const addComment=async(event:FormEvent)=>{
   event.preventDefault();
   if(!editing||!comment.trim()||commentBusy)return;
   setCommentBusy(true);setActivityError('');
   try{
    await request('/platform/tasks/'+editing.id+'/comments','POST',{text:comment.trim()});
    setComment('');setActivityRevision(value=>value+1);
   }catch{setActivityError(copy.commentFailed)}
   finally{setCommentBusy(false)}
  };
  const attachFile=async(file:File|undefined)=>{
   if(!editing||!file||attachmentBusy)return;
   setAttachmentBusy(true);setActivityError('');
   try{
    await uploadPlatformTaskAttachment(editing.id,file);
    setActivityRevision(value=>value+1);
   }catch{setActivityError(copy.attachmentFailed)}
   finally{setAttachmentBusy(false)}
  };
  const downloadAttachment=async(item:Activity)=>{
   if(!editing||!item.fileName)return;
   try{
    const blob=await downloadFile('/platform/tasks/'+editing.id+'/attachments/'+item.id);
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=item.fileName;link.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
   }catch{setActivityError(copy.attachmentFailed)}
  };
  const timeLabel=(value:string)=>new Intl.DateTimeFormat(language==='en'?'en-US':language==='hy'?'hy-AM':'ru-RU',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Yerevan'}).format(new Date(value));
  const sizeLabel=(value:string|number|null)=>{const bytes=Number(value??0);return bytes<1024?`${bytes} B`:bytes<1024*1024?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1024/1024).toFixed(1)} MB`};
 const dateLabel=(date:string)=>new Intl.DateTimeFormat(language==='en'?'en-US':language==='hy'?'hy-AM':'ru-RU',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Yerevan'}).format(new Date(date+'T12:00:00'));

 return <section className="ptm" aria-labelledby="ptm-title">
  <header className="ptm-header">
   <div><div className="ptm-eyebrow"><ListTodo size={17}/>{copy.allTasks}</div><h2 id="ptm-title">{copy.subtitle}</h2><p>{copy.taskDescription}</p></div>
   <button className="p-button orange" onClick={openNew}><Plus size={17}/>{copy.newTask}</button>
  </header>
  <section className="ptm-toolbar p-card" aria-label={copy.filters}>
   <form className="ptm-search" onSubmit={submitSearch}>
    <label className="ptm-search-input"><Search size={17}/><input value={searchInput} onChange={event=>setSearchInput(event.target.value)} placeholder={copy.search}/></label>
    <button className="p-button" type="submit">{copy.search}</button>
   </form>
   <label>{copy.organization}<select value={organizationId} onChange={event=>setOrganizationId(event.target.value)}><option value="">{copy.allOrganizations}</option>{(data?.organizations??[]).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
   <label>{copy.assignee}<select value={assigneeId} onChange={event=>setAssigneeId(event.target.value)}><option value="">{copy.anyAssignee}</option>{(data?.assignees??[]).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
   <label>{copy.priority}<select value={priority} onChange={event=>setPriority(event.target.value)}><option value="">{copy.allPriorities}</option>{PRIORITIES.map(value=><option key={value} value={value}>{priorityName(value)}</option>)}</select></label>
   <label>{copy.dueFrom}<input type="date" value={dueFrom} onChange={event=>setDueFrom(event.target.value)}/></label>
   <label>{copy.dueTo}<input type="date" value={dueTo} onChange={event=>setDueTo(event.target.value)}/></label>
   <button className="p-button ptm-clear" onClick={clearFilters}>{copy.clear}</button>
  </section>
  {dateRangeInvalid&&<p className="p-error" role="alert">{copy.invalidRange}</p>}
  {error!==undefined&&<div className="ptm-error"><ErrorNotice error={error}/><button className="p-button" onClick={()=>{setError(undefined);setRevision(value=>value+1)}}>{copy.retry}</button></div>}
  <div className="ptm-summary" aria-live="polite"><strong>{visibleTasks.length}</strong><span>{copy.taskCount}</span>{STATUS.map(status=><span key={status} className={'ptm-summary-pill ptm-'+status}>{statusName(status)} · {totals[status]}</span>)}</div>
  {loading&&!data?<div className="ptm-loading" role="status">{copy.loading}</div>:<div className="ptm-board" aria-label="Kanban">
   {STATUS.map(status=><section className={'ptm-column ptm-column-'+status} key={status} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();const id=event.dataTransfer.getData('text/plain'),task=visibleTasks.find(item=>item.id===id);if(task)void move(task,status)}} aria-label={`${statusName(status)}: ${totals[status]}`}>
    <header className="ptm-column-heading"><div><span className="ptm-status-dot"/><h3>{statusName(status)}</h3><span className="ptm-count">{totals[status]}</span></div>{status==='todo'&&<button className="p-icon" aria-label={copy.createFirst} onClick={openNew}><Plus size={18}/></button>}</header>
    {loading&&data&&<p className="ptm-refresh" role="status">{copy.loading}</p>}
    <div className="ptm-card-list">
     {visibleTasks.filter(task=>task.status===status).map(task=><article key={task.id} className={'ptm-task-card '+(moving===task.id?'is-moving':'')} draggable onDragStart={event=>{event.dataTransfer.setData('text/plain',task.id);event.dataTransfer.effectAllowed='move'}} onDragEnd={()=>setMoving(null)}>
      <div className="ptm-card-top"><span className={'ptm-priority ptm-priority-'+task.priority}>{priorityName(task.priority)}</span><button className="p-icon" onClick={()=>openEdit(task)} aria-label={copy.edit+': '+task.title}>{busyTask===task.id?<Clock3 size={16}/>:<Pencil size={16}/>}</button></div>
      <button className="ptm-task-title" onClick={()=>openEdit(task)}>{task.title}</button>
      {task.description&&<p className="ptm-task-description">{task.description}</p>}
      <div className="ptm-task-meta">
       {task.organizationName&&<span><Building2 size={14}/>{task.organizationName}</span>}
       <span><UserRound size={14}/>{task.assigneeName||copy.noAssignee}</span>
       <span className={task.dueOn&&task.status!=='done'&&task.dueOn<localToday()?'ptm-overdue':''}><CalendarDays size={14}/>{task.dueOn?dateLabel(task.dueOn):copy.noDueDate}</span>
      </div>
      {busyTask===task.id&&<span className="ptm-card-saving" role="status">{copy.saving}</span>}
     </article>)}
     {!loading&&!visibleTasks.some(task=>task.status===status)&&<div className="ptm-empty-column">{copy.empty}</div>}
    </div>
   </section>)}
  </div>}
  {creating&&<Modal title={editing?copy.editTitle:copy.createTitle} onClose={closeEditor}>
   <form className="ptm-form" onSubmit={save}>
    <label>{copy.taskTitle}<input required minLength={2} maxLength={160} autoFocus value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})}/></label>
    <label>{copy.description}<textarea maxLength={4000} rows={4} value={draft.description} onChange={event=>setDraft({...draft,description:event.target.value})}/></label>
    <div className="ptm-form-grid">
     <label>{copy.status}<select value={draft.status} onChange={event=>setDraft({...draft,status:event.target.value as Status})}>{STATUS.map(value=><option value={value} key={value}>{statusName(value)}</option>)}</select></label>
     <label>{copy.priority}<select value={draft.priority} onChange={event=>setDraft({...draft,priority:event.target.value as Priority})}>{PRIORITIES.map(value=><option value={value} key={value}>{priorityName(value)}</option>)}</select></label>
     <label>{copy.organization}<select value={draft.organizationId} onChange={event=>setDraft({...draft,organizationId:event.target.value})}><option value="">{copy.noOrganization}</option>{(data?.organizations??[]).map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
     <label>{copy.assignee}<select value={draft.assigneeId} onChange={event=>setDraft({...draft,assigneeId:event.target.value})}><option value="">{copy.noAssignee}</option>{(data?.assignees??[]).map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    </div>
    <label>{copy.dueTo}<input type="date" value={draft.dueOn} onChange={event=>setDraft({...draft,dueOn:event.target.value})}/></label>
     {editing&&<section className="ptm-discussion" aria-labelledby="ptm-discussion-title">
      <h3 id="ptm-discussion-title"><MessageCircle size={17}/>{copy.discussion}</h3>
      {activityError&&<p className="ptm-discussion-error" role="alert">{activityError}</p>}
      {activityLoading?<p className="ptm-activity-empty" role="status">{copy.loading}</p>:activity.length===0?<p className="ptm-activity-empty">{copy.noActivity}</p>:
       <ol className="ptm-activity-list">{activity.map(item=><li key={item.type+item.id} className="ptm-activity-item">
        <div className="ptm-activity-meta"><strong>{item.author}</strong><time dateTime={item.createdAt}>{timeLabel(item.createdAt)}</time></div>
        {item.type==='comment'?<p className="ptm-activity-content">{item.content}</p>:<div className="ptm-attachment-row">
         <span><Paperclip size={15}/><strong>{item.fileName}</strong><small>{sizeLabel(item.byteSize)}</small></span>
         <button className="p-button" type="button" onClick={()=>void downloadAttachment(item)}><Download size={14}/>{copy.download}</button>
        </div>}
       </li>)}</ol>}
      <form className="ptm-comment-form" onSubmit={addComment}>
       <label className="sr-only" htmlFor="ptm-comment">{copy.commentPlaceholder}</label>
       <textarea id="ptm-comment" rows={2} maxLength={4000} placeholder={copy.commentPlaceholder} value={comment} onChange={event=>setComment(event.target.value)}/>
       <button className="p-button orange" type="submit" disabled={commentBusy||!comment.trim()}><Send size={15}/>{commentBusy?copy.sendingComment:copy.sendComment}</button>
      </form>
      <div className="ptm-attachment-upload">
       <label className="p-button" htmlFor="ptm-attachment"><Paperclip size={15}/>{attachmentBusy?copy.uploading:copy.uploadAttachment}</label>
       <input id="ptm-attachment" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={attachmentBusy} onChange={event=>{const file=event.currentTarget.files?.[0];void attachFile(file);event.currentTarget.value=''}}/>
       <small>{copy.supportedFiles}</small>
      </div>
     </section>}
      {archiveConfirm&&<div className="ptm-archive-confirm" role="alert"><p>{copy.archiveConfirm}</p><div><button className="p-button" type="button" disabled={busy||commentBusy||attachmentBusy} onClick={()=>setArchiveConfirm(false)}>{copy.cancel}</button><button className="p-button danger" type="button" disabled={busy||commentBusy||attachmentBusy} onClick={()=>void archive()}><Archive size={15}/>{busy?copy.archiving:copy.archive}</button></div></div>}
    <div className="ptm-form-actions">
     {editing&&!archiveConfirm&&<button className="p-button danger" type="button" disabled={busy} onClick={()=>setArchiveConfirm(true)}><Archive size={15}/>{copy.archive}</button>}
     <span/>
      <button className="p-button" type="button" disabled={busy||commentBusy||attachmentBusy} onClick={closeEditor}>{copy.cancel}</button>
      <button className="p-button orange" type="submit" disabled={busy||commentBusy||attachmentBusy||!draft.title.trim()}>{busy?copy.saving:<><Check size={16}/>{copy.save}</>}</button>
    </div>
   </form>
  </Modal>}
 </section>;
}
