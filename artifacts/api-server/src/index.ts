import app from "./app";
import { logger } from "./lib/logger";
import { startPlatformJobs } from "../archive/vernatun/server/platform-jobs";
import {pool} from "../archive/vernatun/server/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

let stopJobs: (() => void) | undefined;
const server=app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  stopJobs=startPlatformJobs();
});

export async function shutdownServer(){
 stopJobs?.();
 await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
 await pool.end();
}
if(process.env.VERNATUN_DEV_OWNER!=='1')for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>{
 const deadline=setTimeout(()=>process.exit(1),15000);deadline.unref();
 void shutdownServer().then(()=>process.exit(0),()=>process.exit(1));
});
