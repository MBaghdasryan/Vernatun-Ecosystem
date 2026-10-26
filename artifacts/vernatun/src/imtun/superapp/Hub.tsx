import {Building2,Car,Smartphone,FileCheck2,Phone,BookUser,Sparkles,MessagesSquare,Store,LifeBuoy,MessageSquareHeart,SlidersHorizontal} from 'lucide-react';
import type {Language} from '../../portal/i18n';
import {L,superViews,superTitle} from './text';
const icons={building:Building2,vehicles:Car,devices:Smartphone,agreements:FileCheck2,contacts:Phone,directory:BookUser,services:Sparkles,community:MessagesSquare,marketplace:Store,help:LifeBuoy,feedback:MessageSquareHeart,preferences:SlidersHorizontal};
export default function Hub({view,language,go}:{view:string;language:Language;go:(v:string)=>void}){
 return <div className="im-quick sx-hub">{superViews.map(v=>{const I=icons[v];return <button key={v} aria-current={view===v?'page':undefined} className={view===v?'active':''} onClick={()=>go(v)}><span><I size={27} strokeWidth={1.7}/></span>{L(language,superTitle[v])}</button>})}</div>}
