export type MaintenanceFrequency='once'|'daily'|'weekly'|'monthly'|'quarterly'|'semiannual'|'annual'|'custom';

/** Compute from the original anchor, not the previous clamped occurrence.
 * Jan 31 -> Feb 28 -> Mar 31; no accumulated drift or local timezone changes. */
export function maintenanceDueOn(anchor:string,frequency:MaintenanceFrequency,cycle:number,intervalDays?:number|null):string|null{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(anchor)||!Number.isInteger(cycle)||cycle<0||cycle>100000)throw new Error('invalid_maintenance_calendar');
 const start=new Date(anchor+'T00:00:00.000Z');
 if(!Number.isFinite(start.getTime())||start.toISOString().slice(0,10)!==anchor)throw new Error('invalid_maintenance_anchor');
 if(frequency==='once')return cycle===0?anchor:null;
 const months=frequency==='monthly'?1:frequency==='quarterly'?3:frequency==='semiannual'?6:frequency==='annual'?12:0;
 if(months){
  const target=new Date(start);target.setUTCDate(1);target.setUTCMonth(start.getUTCMonth()+months*cycle);
  const last=new Date(target);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
  target.setUTCDate(Math.min(start.getUTCDate(),last.getUTCDate()));
  if(target.getUTCFullYear()>9999)throw new Error('maintenance_calendar_out_of_range');
  return target.toISOString().slice(0,10);
 }
 const days=frequency==='daily'?1:frequency==='weekly'?7:frequency==='custom'?intervalDays:undefined;
 if(!days||!Number.isInteger(days)||days<1||days>36600)throw new Error('invalid_maintenance_interval');
 const target=new Date(start.getTime()+days*cycle*86400000);
 if(!Number.isFinite(target.getTime())||target.getUTCFullYear()>9999)throw new Error('maintenance_calendar_out_of_range');
 return target.toISOString().slice(0,10);
}
