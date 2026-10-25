export const edgeHealth = Object.freeze({
 heartbeatExpectedSeconds:30,
 offlineAfterSeconds:120,
 inventoryStaleAfterSeconds:600,
 telemetryStaleAfterSeconds:300,
 warningQueueDepth:100,
 criticalQueueDepth:1000,
});

export const edgeModules = ['access','fire_monitoring','elevator_monitoring','metering','hvac','pumps','cameras'] as const;
export const lockedEdgeCapabilities = ['FIRE.CONTROL','ELEVATOR.SAFETY_CONTROL'] as const;

export function edgeThresholds(node:Record<string,any>){
 const c=node.management_config??{};
 const interval=(key:string,fallback:number)=>Number.isFinite(Number(c[key]))&&Number(c[key])>0?Number(c[key]):fallback;
 const heartbeatExpectedSeconds=interval('heartbeatSeconds',edgeHealth.heartbeatExpectedSeconds);
 return {...edgeHealth,heartbeatExpectedSeconds,
  offlineAfterSeconds:Math.max(edgeHealth.offlineAfterSeconds,heartbeatExpectedSeconds*3),
  inventoryStaleAfterSeconds:Math.max(edgeHealth.inventoryStaleAfterSeconds,interval('inventorySeconds',300)*2),
  telemetryStaleAfterSeconds:Math.max(edgeHealth.telemetryStaleAfterSeconds,interval('telemetrySeconds',30)*3)};
}

// Status must not report ONLINE solely because a heartbeat changed a DB field.
export function normalizeEdgeStatus(node:Record<string,any>,connected:boolean,now=Date.now()){
 const thresholds=edgeThresholds(node);
 if(node.archived_at||node.status==='DISABLED')return 'DISABLED';
 if(node.registration_state!=='REGISTERED'||!node.last_heartbeat_at)return 'UNKNOWN';
 const age=(now-new Date(node.last_heartbeat_at).getTime())/1000;
 if(!connected||age>thresholds.offlineAfterSeconds||!node.credential_active)return 'OFFLINE';
 const inventoryAge=node.last_inventory_at?(now-new Date(node.last_inventory_at).getTime())/1000:null;
 const telemetryAge=node.last_telemetry_at?(now-new Date(node.last_telemetry_at).getTime())/1000:null;
 if(node.local_authorization_status!=='OK'||node.queue_depth>=edgeHealth.warningQueueDepth||
  (inventoryAge!==null&&inventoryAge>thresholds.inventoryStaleAfterSeconds)||
  (telemetryAge!==null&&telemetryAge>thresholds.telemetryStaleAfterSeconds))return 'DEGRADED';
 return 'ONLINE';
}
