// One managed development owner per artifact. No pnpm/shell grandchildren.
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const kind=process.argv[2];
if(!['api','web'].includes(kind))throw new Error('Use dev-service.mjs api|web');
process.env.NODE_ENV='development';
const dir=path.join(root,'artifacts',kind==='api'?'api-server':'vernatun');
process.chdir(dir);
const owner=process.ppid;
let shutdown=()=>process.exit(0);
let closing=false;
const stop=async()=>{
 if(closing)return;closing=true;
 const deadline=setTimeout(()=>process.exit(1),15000);deadline.unref();
 await shutdown();clearTimeout(deadline);process.exit(0);
};
process.once('SIGTERM',()=>void stop());
process.once('SIGINT',()=>void stop());
// Also close if a supervisor disappears without forwarding a signal.
setInterval(()=>{if(process.ppid!==owner)void stop()},1000).unref();
if(kind==='web'){
 const require=createRequire(path.join(dir,'package.json'));
 const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);
 const server=await createServer({configFile:path.join(dir,'vite.config.ts')});
 shutdown=()=>server.close();
 await server.listen();server.printUrls();
}else{
 process.env.VERNATUN_DEV_OWNER='1';
 await import(pathToFileURL(path.join(dir,'build.mjs')).href);
 if(closing)process.exit(0);
 const {shutdownServer}=await import(pathToFileURL(path.join(dir,'dist/index.mjs')).href);
 shutdown=shutdownServer;
}
