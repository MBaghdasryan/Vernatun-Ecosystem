import {platformHousekeeping} from './subscription-policy.js';
import {logger} from '../../../src/lib/logger.js';
import {runSlaEscalations} from './sla-jobs.js';

let started=false,running=false;
export function startPlatformJobs(){
 if(started)return ()=>{};
 started=true;
 const run=async()=>{
  if(running)return;running=true;
  try{await platformHousekeeping();await runSlaEscalations()}
  catch(e){logger.error({code:(e as {code?:string}).code??'unknown'},'Platform housekeeping failed')}
  finally{running=false}
 };
 const timer=setInterval(()=>void run(),60000);timer.unref();void run();
 return ()=>{clearInterval(timer);started=false};
}
