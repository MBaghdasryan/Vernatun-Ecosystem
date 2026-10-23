import {createServer} from 'node:http';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
const schema=process.env.PRIVATE_FILES_TEST_RUN;
if(config.NODE_ENV!=='test'||!/^qa_[a-f0-9]{20}$/.test(schema??'')||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('QA isolation required');
const meta=resolve('../../../../.local/qa/phase8-browser.json');
if(process.argv.includes('--payments-qa')){
 const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
 const organization=(await pool.query("SELECT organization_id FROM role_assignments WHERE user_id=$1 AND role_key='org_admin' LIMIT 1",[seeded.accounts.org_admin.id])).rows[0].organization_id;
 const plan=(await pool.query("INSERT INTO subscription_plans(name,amount_minor,currency,building_limit) VALUES('Isolated payment QA',120000,'AMD',100) RETURNING id")).rows[0];
 await pool.query(`INSERT INTO subscriptions(organization_id,plan_id,starts_on,ends_on,status,created_by)
  VALUES($1,$2,(date_trunc('month',now() AT TIME ZONE 'Asia/Yerevan'))::date,(now() AT TIME ZONE 'Asia/Yerevan')::date+365,'trial',$3)`,
  [organization,plan.id,seeded.accounts.platform_admin.id]);
 const invoice=(await pool.query(`INSERT INTO invoices(organization_id,unit_id,payer_user_id,period,amount_minor,currency,status,created_by)
  VALUES($1,$2,$3,(date_trunc('month',now() AT TIME ZONE 'Asia/Yerevan'))::date,26000,'AMD','draft',$3) RETURNING id`,
  [organization,seeded.fixtures.ua,seeded.accounts.unit_owner.id])).rows[0];
 await pool.query("INSERT INTO invoice_lines(invoice_id,description,quantity_hundredths,rate_minor,amount_minor) VALUES($1,'Isolated QA invoice',100,26000,26000)",[invoice.id]);
 await pool.query("UPDATE invoices SET status='published',published_by=$2,published_at=now() WHERE id=$1",[invoice.id,seeded.accounts.accountant.id]);
}
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
