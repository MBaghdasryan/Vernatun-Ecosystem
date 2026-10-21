import {calendarDay} from './calendar-date';
export function todayYerevan(){return calendarDay()}
export function calendarWindow(from:string,to:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return null;
 const start=Date.parse(from+'T00:00:00+04:00'),end=Date.parse(to+'T00:00:00+04:00')+86400000;
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>62*86400000)return null;
 if(new Date(start+4*3600000).toISOString().slice(0,10)!==from||new Date(end-86400000+4*3600000).toISOString().slice(0,10)!==to)return null;
 return {from:new Date(start).toISOString(),to:new Date(end).toISOString()};
}
export function conflictingVisits(rows:ReadonlyArray<{id:string;technician_id:string|null;starts_at:string;ends_at:string}>){
 const conflicts=new Set<string>();
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
  const a=rows[i],b=rows[j];
  if(a.technician_id&&a.technician_id===b.technician_id&&Date.parse(a.starts_at)<Date.parse(b.ends_at)&&Date.parse(b.starts_at)<Date.parse(a.ends_at)){conflicts.add(a.id);conflicts.add(b.id)}
 }
 return conflicts;
}
