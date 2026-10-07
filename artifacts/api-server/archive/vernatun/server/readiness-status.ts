export function readinessStatus(handover:string|null,openDefects:number,pendingInspections:number,completedInspections:number){
 if(openDefects>0)return 'defects';
 if(pendingInspections>0)return 'inspection';
 if(!handover)return 'unknown';
 if(completedInspections===0)return 'inspection';
 if(handover==='operational')return 'operational';
 if(handover==='ready')return 'ready';
 return 'awaiting_confirmation';
}
