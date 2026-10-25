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

export function edgeStatusReasons(node:Record<string,any>,connected:boolean,now=Date.now()){
 const thresholds=edgeThresholds(node);
 if(node.archived_at||node.status==='DISABLED')return ['disabled'];
 if(node.registration_state!=='REGISTERED')return ['registration_pending'];
 if(!node.last_heartbeat_at)return ['heartbeat_missing'];
 const age=(now-new Date(node.last_heartbeat_at).getTime())/1000;
 const offlineReasons:string[]=[];
 if(!connected)offlineReasons.push('websocket_disconnected');
 if(age>thresholds.offlineAfterSeconds)offlineReasons.push('heartbeat_stale');
 if(!node.credential_active)offlineReasons.push('credential_inactive');
 if(offlineReasons.length)return offlineReasons;
 const inventoryAge=node.last_inventory_at?(now-new Date(node.last_inventory_at).getTime())/1000:null;
 const telemetryAge=node.last_telemetry_at?(now-new Date(node.last_telemetry_at).getTime())/1000:null;
 const degradedReasons:string[]=[];
 if(node.local_authorization_status!=='OK')degradedReasons.push('local_authorization');
 if(node.queue_depth>=edgeHealth.warningQueueDepth)degradedReasons.push('queue_depth');
 if(inventoryAge!==null&&inventoryAge>thresholds.inventoryStaleAfterSeconds)degradedReasons.push('inventory_stale');
 if(telemetryAge!==null&&telemetryAge>thresholds.telemetryStaleAfterSeconds)degradedReasons.push('telemetry_stale');
 return degradedReasons;
}

// Status must not report ONLINE solely because a heartbeat changed a DB field.
export function normalizeEdgeStatus(node:Record<string,any>,connected:boolean,now=Date.now()){
 const reasons=edgeStatusReasons(node,connected,now);
 if(reasons.includes('disabled'))return 'DISABLED';
 if(reasons.includes('registration_pending')||reasons.includes('heartbeat_missing'))return 'UNKNOWN';
 if(reasons.some(r=>['websocket_disconnected','heartbeat_stale','credential_inactive'].includes(r)))return 'OFFLINE';
 if(reasons.length)return 'DEGRADED';
 return 'ONLINE';
}
