import type {RoleContext} from '../../portal/types';
import type {Language} from '../../portal/i18n';
import {L,S} from '../superapp/text';
import {useContinuity,tt} from './core';
import Account from './Account';
import Chats from './Chats';
import Market from './Market';
import Bookings from './Bookings';
import HelpDesk from './HelpDesk';
import BuildingFinance from './Finance';
export const continuityViews=['preferences','community','marketplace','services','help','building'];
export default function Continuity({c,l,view,financeOn}:{c:RoleContext;l:Language;view:string;financeOn:boolean}){
 const q=useContinuity(c.id);
 if(view==='building')return financeOn?<BuildingFinance c={c} l={l}/>:null;
 return <>{q.isPending&&<div className="im-card sx-skel" aria-busy="true">{L(l,S.loading)}</div>}
 {q.isError&&<div className="im-notice" role="alert">{tt(l,'Չհաջողվեց բեռնել շարունակականության տվյալները։','Не удалось загрузить данные раздела.','Could not load this section.')} <button onClick={()=>q.refetch()}>{L(l,S.retry)}</button></div>}
 {q.data&&view==='preferences'&&<Account c={c} l={l} d={q.data}/>}
 {q.data&&view==='community'&&<Chats c={c} l={l} d={q.data}/>}
 {q.data&&view==='marketplace'&&<Market c={c} l={l} d={q.data}/>}
 {q.data&&view==='services'&&<Bookings c={c} l={l} d={q.data}/>}
 {q.data&&view==='help'&&<HelpDesk c={c} l={l} d={q.data}/>}</>}
