import {useState} from 'react';
import {updateResidentProfile} from '@workspace/api-client-react';
import type {ResidentProfileInput} from '@workspace/api-client-react';
import type {Language} from '../../portal/i18n';
import {L,type T} from './text';
import {useAct} from './useAct';
type Flag='showName'|'showUnit'|'showPhone'|'allowMessages';
export default function Prefs({profile,l,refresh}:{profile:ResidentProfileInput;l:Language;refresh:()=>void}){
 const [p,setP]=useState<ResidentProfileInput>(profile),a=useAct(l,refresh),[ok,setOk]=useState(false);
 const set=(k:keyof ResidentProfileInput,v:string|boolean)=>{setOk(false);setP({...p,[k]:v})};
 const tg=(k:Flag,lab:T)=><label className="sx-check"><input type="checkbox" checked={p[k]} onChange={e=>set(k,e.target.checked)}/>{L(l,lab)}</label>;
 return <form className="im-card sx-form" onSubmit={e=>{e.preventDefault();void a.run(async()=>{await updateResidentProfile(p);setOk(true)})}}>
 <label>{L(l,['Անուն','Имя','Name'])}<input required maxLength={120} value={p.name} onChange={e=>set('name',e.target.value)}/></label><label>{L(l,['Հեռախոս','Телефон','Phone'])}<input maxLength={30} value={p.phone} onChange={e=>set('phone',e.target.value)}/></label>
 <label>{L(l,['Լեզու','Язык','Language'])}<select value={p.language} onChange={e=>set('language',e.target.value)}><option value="hy">Հայերեն</option><option value="ru">Русский</option><option value="en">English</option></select></label>
 <label>{L(l,['Թեմա','Тема','Theme'])}<select value={p.theme} onChange={e=>set('theme',e.target.value)}><option value="system">{L(l,['Համակարգի','Системная','System'])}</option><option value="light">{L(l,['Բաց','Светлая','Light'])}</option><option value="dark">{L(l,['Մութ','Тёмная','Dark'])}</option></select></label>
 <label>{L(l,['Նախընտրելի կապ','Предпочтительный канал','Preferred channel'])}<select value={p.preferredChannel} onChange={e=>set('preferredChannel',e.target.value)}><option value="email">Email</option><option value="phone">{L(l,['Հեռախոս','Телефон','Phone'])}</option></select></label>
 {tg('showName',['Ցույց տալ անունը ցուցակում','Показывать имя в справочнике','Show name in directory'])}{tg('showUnit',['Ցույց տալ բնակարանը','Показывать квартиру','Show unit'])}{tg('showPhone',['Ցույց տալ հեռախոսը','Показывать телефон','Show phone'])}{tg('allowMessages',['Թույլատրել հաղորդագրություններ','Разрешить сообщения','Allow messages'])}
 <button className="im-button" disabled={a.busy}>{L(l,['Պահպանել','Сохранить','Save'])}</button>{ok&&<p role="status">{L(l,['Պահպանված է','Сохранено','Saved'])}</p>}{a.err&&<p role="alert" className="sx-err">{a.err}</p>}</form>}
