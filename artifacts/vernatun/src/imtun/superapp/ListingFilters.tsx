import type {Language} from '../../portal/i18n';
import {L} from './text';
import {LT,majorToMinor,CURRENCIES} from './listingText';
export type LF={saleType:string;currency:string;min:string;max:string;rooms:string};
export const emptyLF:LF={saleType:'',currency:'',min:'',max:'',rooms:''};
export const lfParams=(f:LF)=>{const p:Record<string,unknown>={};if(f.saleType)p.saleType=f.saleType;if(f.currency)p.currency=f.currency;
 if(f.min)p.minPrice=majorToMinor(f.min)??f.min;if(f.max)p.maxPrice=majorToMinor(f.max)??f.max;
 if(f.rooms!=='')p.rooms=f.rooms;return p};
export default function ListingFilters({f,set,l}:{f:LF;set:(f:LF)=>void;l:Language}){
 return <div className="sx-form" role="search"><div className="sx-row">
 <select aria-label={L(l,LT.type)} value={f.saleType} onChange={e=>set({...f,saleType:e.target.value})}><option value="">{L(l,LT.type)}: {L(l,LT.any)}</option><option value="sale">{L(l,LT.sale)}</option><option value="rent">{L(l,LT.rent)}</option></select>
 <select aria-label={L(l,LT.currency)} value={f.currency} onChange={e=>set({...f,currency:e.target.value})}><option value="">{L(l,LT.currency)}: {L(l,LT.any)}</option>{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select>
 <input aria-label={L(l,LT.min)} placeholder={L(l,LT.min)} disabled={!f.currency} inputMode="decimal" value={f.min} onChange={e=>set({...f,min:e.target.value})}/>
 <input aria-label={L(l,LT.max)} placeholder={L(l,LT.max)} disabled={!f.currency} inputMode="decimal" value={f.max} onChange={e=>set({...f,max:e.target.value})}/>
 <input aria-label={L(l,LT.rooms)} placeholder={L(l,LT.rooms)} type="number" min={0} max={100} value={f.rooms} onChange={e=>set({...f,rooms:e.target.value})}/>
 <button type="button" className="im-button im-secondary" onClick={()=>set(emptyLF)}>{L(l,LT.reset)}</button></div></div>}
