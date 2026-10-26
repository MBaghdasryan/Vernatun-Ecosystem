import {useQuery,useQueryClient} from '@tanstack/react-query';
import {getResidentWorkspace} from '@workspace/api-client-react';
import type {RoleContext} from '../../portal/types';
import type {Language} from '../../portal/i18n';
import {L,S,kinds} from './text';
import Records from './Records';
import Building from './Building';
import HomeSummary from './HomeSummary';
import Prefs from './Prefs';
import './deeplink.css';
export {superViews,superTitle} from './text';
export default function ExtensionView({c,view,language:l}:{c:RoleContext;view:string;language:Language}){
 const qc=useQueryClient(),wk=['resident-ws',c.id],ws=useQuery({queryKey:wk,queryFn:()=>getResidentWorkspace()});
 const all=kinds[view]??[],selected=new URLSearchParams(location.search),target=selected.get('recordKind');
 const list=selected.has('recordId')&&all.some(k=>k===target)?all.filter(k=>k===target):all,own=view==='building'||view==='preferences';
 return <div className="sx-root" key={c.id+view}>
 {ws.isError&&<div className="im-notice" role="alert">{L(l,S.fail)} <button onClick={()=>ws.refetch()}>{L(l,S.retry)}</button></div>}
 {ws.isPending&&<div className="im-card sx-skel" aria-busy="true">{L(l,S.loading)}</div>}
 {view==='building'&&ws.data&&<><HomeSummary c={c} language={l}/><Building l={l} ws={ws.data}/><Records kind="contacts" l={l} c={c} caps={ws.data.capabilities}/></>}
 {view==='preferences'&&ws.data&&<Prefs key={JSON.stringify(ws.data.profile)} profile={ws.data.profile} l={l} refresh={()=>{void qc.invalidateQueries({queryKey:wk})}}/>}
 {!own&&ws.data&&list.map(k=><Records key={k} kind={k} l={l} c={c} caps={ws.data.capabilities}/>)}</div>}
