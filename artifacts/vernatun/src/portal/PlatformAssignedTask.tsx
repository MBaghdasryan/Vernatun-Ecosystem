import {useEffect,useState} from 'react';
import {CalendarDays,ListTodo} from 'lucide-react';
import {request} from './client';
import {date,type Language} from './i18n';
import type {RoleContext} from './types';

type Task={id:string;title:string;description:string;status:'todo'|'in_progress'|'blocked'|'done';priority:string;organizationName:string|null;assigneeName:string|null;dueOn:string|null};
const TEXT={
 hy:{loading:'Բեռնվում է…',error:'Չհաջողվեց բացել առաջադրանքը։',retry:'Կրկնել',status:'Կարգավիճակ',due:'Ժամկետ',assignee:'Պատասխանատու',todo:'Անելիք',in_progress:'Ընթացքում',blocked:'Արգելափակված',done:'Ավարտված',noDue:'Ժամկետ սահմանված չէ'},
 ru:{loading:'Загрузка…',error:'Не удалось открыть задачу.',retry:'Повторить',status:'Статус',due:'Срок',assignee:'Ответственный',todo:'К выполнению',in_progress:'В работе',blocked:'Заблокировано',done:'Готово',noDue:'Без срока'},
 en:{loading:'Loading…',error:'Could not open the task.',retry:'Retry',status:'Status',due:'Due',assignee:'Assignee',todo:'To do',in_progress:'In progress',blocked:'Blocked',done:'Done',noDue:'No due date'},
} as const;

export default function PlatformAssignedTask({c,language,taskId}:{c:RoleContext;language:Language;taskId:string}){
 const text=TEXT[language]??TEXT.ru,[task,setTask]=useState<Task>(),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false);
 async function load(){setLoading(true);setFailed(false);try{setTask(await request<Task>('/platform/tasks/'+encodeURIComponent(taskId)))}catch{setFailed(true)}finally{setLoading(false)}}
 useEffect(()=>{setTask(undefined);void load()},[taskId,c.id]);
 return <section className="ptm" aria-labelledby="assigned-task-title">
  <header className="ptm-header"><div><div className="ptm-eyebrow"><ListTodo size={17}/>{text.assignee}</div><h2 id="assigned-task-title">{task?.title??text.loading}</h2></div></header>
  {loading&&!task&&<p className="ptm-loading" role="status">{text.loading}</p>}
  {failed&&<div className="ptm-error" role="alert"><p>{text.error}</p><button className="p-button" onClick={()=>void load()}>{text.retry}</button></div>}
  {task&&<article className="p-card">
   {task.description&&<p>{task.description}</p>}
   <div className="ptm-task-meta">
    <span><ListTodo size={14}/>{text.status}: {text[task.status]}</span>
    <span><CalendarDays size={14}/>{text.due}: {task.dueOn?date(task.dueOn,language):text.noDue}</span>
    {task.assigneeName&&<span>{text.assignee}: {task.assigneeName}</span>}
   </div>
  </article>}
 </section>;
}
