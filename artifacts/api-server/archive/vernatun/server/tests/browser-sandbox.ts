import {createServer} from 'node:http';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
const schema=process.env.PRIVATE_FILES_TEST_RUN;
if(config.NODE_ENV!=='test'||!/^qa_[a-f0-9]{20}$/.test(schema??'')||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('QA isolation required');
const meta=resolve('../../../../.local/qa/phase8-browser.json');
let finish:()=>void;
const done=new Promise<void>(r=>{finish=r});
const server=createServer((req,res)=>{
  if(req.method==='POST'&&req.url==='/__qa_reset_auth'){
   if(req.headers['x-qa-schema']!==schema){res.writeHead(403,{'Content-Type':'application/json'});res.end('{"error":"forbidden"}');return}
   pool.query('DELETE FROM auth_rate_limits').then(()=>{res.writeHead(204);res.end()}).catch(()=>{res.writeHead(500);res.end()});return;
  }
 if(req.method==='POST'&&req.url==='/__qa_stop'){
  res.writeHead(200,{'Content-Type':'application/json'});res.end('{"stopped":true}');
  setTimeout(()=>server.close(()=>finish()),50);return;
 }
 app(req,res);
});
server.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
await mkdir(resolve(meta,'..'),{recursive:true});
await writeFile(meta,JSON.stringify({url:'http://127.0.0.1:'+(server.address() as any).port,origin:config.APP_ORIGIN,schema},null,2));
console.log('Isolated Phase 8 browser API ready');
await done;await pool.end();await rm(meta,{force:true});
