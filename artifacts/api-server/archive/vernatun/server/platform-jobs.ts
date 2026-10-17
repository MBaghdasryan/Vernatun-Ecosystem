import {platformHousekeeping} from './subscription-policy.js';
import {logger} from '../../../src/lib/logger.js';
import {runSlaEscalations} from './sla-jobs.js';
import {runMaintenanceGeneration} from './maintenance.js';
import {observedJob,recordSystemEvent} from './system-observability.js';
import {pruneSystemLogs} from './system-retention.js';
import {runPendingBackup} from './operations-backups.js';
import {scheduleBackups,pruneScheduledBackups} from './system-backup-policies.js';
import {deliverOutgoingWebhooks} from './system-webhooks.js';
import {safeDatabaseFailure} from './system-diagnostics.js';

let started=false,running=false;
export function startPlatformJobs(){
 if(started)return ()=>{};
 started=true;
 void recordSystemEvent({category:'system',event:'application_started'});
 const run=async()=>{
  if(running)return;running=true;
  try{await observedJob('platform_housekeeping',platformHousekeeping);await observedJob('sla_escalations',runSlaEscalations);await observedJob('maintenance_generation',runMaintenanceGeneration)}
   catch(e){logger.error({code:(e as {code?:string}).code??'unknown',...(safeDatabaseFailure(e)??{})},'Platform housekeeping failed')}
  finally{
   try{await observedJob('system_log_retention',pruneSystemLogs)}catch(e){logger.error({code:'retention_failed',...(safeDatabaseFailure(e)??{})},'Log retention failed')}
   try{await observedJob('operations_backup',runPendingBackup)}catch(e){logger.error({code:'backup_worker_failed',...(safeDatabaseFailure(e)??{})},'Backup worker failed')}
   try{await observedJob('backup_schedule',scheduleBackups)}catch(e){logger.error({code:'backup_schedule_failed',...(safeDatabaseFailure(e)??{})},'Backup scheduler failed')}
   try{await observedJob('backup_retention',pruneScheduledBackups)}catch(e){logger.error({code:'backup_retention_failed',...(safeDatabaseFailure(e)??{})},'Backup retention failed')}
   try{await observedJob('outgoing_webhooks',deliverOutgoingWebhooks)}catch(e){logger.error({code:'webhook_worker_failed',...(safeDatabaseFailure(e)??{})},'Webhook worker failed')}
   running=false;
  }
 };
 const timer=setInterval(()=>void run(),60000);timer.unref();void run();
 return ()=>{clearInterval(timer);started=false};
}
