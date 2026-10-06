import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw new Error('Isolated database required');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
const server=app.listen(0,'127.0.0.1');let base='';
class Client{
 cookie='';csrf='';
 async call(path:string,method='GET',body?:unknown){
  const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:this.cookie,...(method==='GET'?{}:{'X-CSRF-Token':this.csrf})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
  const data=r.status===204?null:await r.json();if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data};
 }
 async login(key:string){const a=seeded.accounts[key];await this.call('/auth/session');const r=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(r.status,200);if(!r.data.contextId){const c=r.data.contexts.find((c:any)=>c.role_key===a.role);assert.equal((await this.call('/auth/context','POST',{id:c.id})).status,200)}return this}
}
let accountant:Client,owner:Client,family:Client,foreign:Client,org:string,building:string,unitA:string,unitB:string,tariff:any,published:any,invoices:any[],ownerContext:string;
before(async()=>{
 await pool.query('DELETE FROM auth_rate_limits');
 await new Promise<void>(r=>server.listening?r():server.on('listening',r));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 accountant=await new Client().login('accountant');owner=await new Client().login('unit_owner');family=await new Client().login('family');foreign=await new Client().login('second_org');
 const data=(await accountant.call('/finance')).data;const original=(await pool.query('SELECT organization_id,building_id FROM units WHERE id=$1',[seeded.fixtures.ua])).rows[0];org=original.organization_id;building=original.building_id;
 const foreignOrg=(await pool.query('SELECT organization_id FROM role_assignments WHERE user_id=$1 AND organization_id IS NOT NULL LIMIT 1',[seeded.accounts.second_org.id])).rows[0].organization_id;
 const assignment=(await pool.query("INSERT INTO role_assignments(user_id,organization_id,role_key) VALUES($1,$2,'accountant') RETURNING id",[seeded.accounts.second_org.id,foreignOrg])).rows[0].id;
 assert.equal((await foreign.call('/auth/context','POST',{id:assignment})).status,200);
 const rows=(await pool.query("INSERT INTO units(organization_id,building_id,number,area) VALUES($1,$2,'P401A',10.25),($1,$2,'P401B',20.00) RETURNING id,number",[org,building])).rows;
 unitA=rows.find(r=>r.number==='P401A').id;unitB=rows.find(r=>r.number==='P401B').id;
 ownerContext=(await pool.query("INSERT INTO role_assignments(user_id,organization_id,building_id,unit_id,role_key) VALUES($1,$2,$3,$4,'unit_owner') RETURNING id",[seeded.accounts.unit_owner.id,org,building,unitA])).rows[0].id;
 const result=await accountant.call('/finance/tariffs','POST',{name:'Phase4 batch service',amountMinor:'10000',currency:'AMD',basis:'unit'});assert.equal(result.status,201);tariff=result.data;
 for(const unitId of [unitA,unitB]){
  // Real payer-rule records are sufficient accounting provenance even when a
  // party no longer has a login assignment for a historical billing period.
  await pool.query('INSERT INTO payer_assignments(organization_id,unit_id,payer_user_id,service_id,starts_on) VALUES($1,$2,$3,$4,$5)',[org,unitId,seeded.accounts.unit_owner.id,tariff.service_id,'2026-01-01']);
 }
 assert.ok(data.invoices);
});
after(async()=>{server.close();server.closeAllConnections();await pool.end()});
const batchInput=(period='2026-11-01')=>({buildingId:building,tariffId:tariff.id,period});
const entry=(externalId:string,amountMinor='15000',currency='AMD')=>({externalId,date:'2026-10-07',amountMinor,currency,payerText:'Test payer',purpose:'Bank transfer',rawPayload:{reference:externalId}});
async function importRows(rows:any[]){
 const body={key:randomUUID(),account:'Phase4 account',transactions:rows};const r=await accountant.call('/finance/bank/imports','POST',body);assert.equal(r.status,201,JSON.stringify(r.data));
 return {body,batch:r.data,rows:(await pool.query('SELECT * FROM bank_transactions WHERE import_batch_id=$1 ORDER BY external_id',[r.data.id])).rows};
}
test('Batch preview/draft do not post money; atomic publish is scoped, versioned, acknowledged and concurrent-idempotent',async()=>{
 assert.equal((await owner.call('/finance/batches/preview','POST',batchInput())).status,403);
 assert.equal((await foreign.call('/finance/batches/preview','POST',batchInput())).status,404);
 assert.equal((await accountant.call('/finance/batches/preview','POST',batchInput('2026-11-02'))).status,400);
 const start=(await pool.query('SELECT count(*)::int AS n FROM invoices')).rows[0].n;
 const preview=await accountant.call('/finance/batches/preview','POST',batchInput());assert.equal(preview.status,200);assert.equal(preview.data.chargeCount,2);assert.equal(preview.data.totalMinor,'20000');assert.ok(preview.data.warnings.length);
 const key=randomUUID(),draft=await accountant.call('/finance/batches','POST',{...batchInput(),key});assert.equal(draft.status,201);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM invoices')).rows[0].n,start);
 assert.equal((await accountant.call('/finance/batches','POST',{...batchInput(),key})).data.id,draft.data.id);
 assert.equal((await foreign.call('/finance/batches/'+draft.data.id+'/publish','POST',{key:randomUUID(),version:1,acceptWarnings:true})).status,404);
 assert.equal((await accountant.call('/finance/batches/'+draft.data.id+'/publish','POST',{key:randomUUID(),version:1})).data.error,'batch_warnings_unacknowledged');
 const body={key:randomUUID(),version:1,acceptWarnings:true};
 const results=await Promise.all([accountant.call('/finance/batches/'+draft.data.id+'/publish','POST',body),accountant.call('/finance/batches/'+draft.data.id+'/publish','POST',body)]);
 assert.ok(results.every(r=>r.status===200));published=results[0].data;
 invoices=(await pool.query('SELECT i.* FROM invoices i JOIN billing_batch_invoices b ON b.invoice_id=i.id WHERE b.batch_id=$1 ORDER BY i.unit_id',[published.id])).rows;
 assert.equal(invoices.length,2);assert.ok(invoices.every(i=>i.status==='published'));
 assert.equal((await accountant.call('/finance/batches/'+draft.data.id+'/cancel','POST',{key:randomUUID(),version:1})).status,409);
 assert.equal((await accountant.call('/finance/batches/preview','POST',batchInput())).data.chargeCount,0);
 await assert.rejects(pool.query('UPDATE invoices SET amount_minor=amount_minor+1 WHERE id=$1',[invoices[0].id]));
 await assert.rejects(pool.query("UPDATE billing_batches SET snapshot='{}' WHERE id=$1",[published.id]));
});
test('Publication rejects changed snapshots and rolls back an entire multi-unit post on a late database failure',async()=>{
 const draft=(await accountant.call('/finance/batches','POST',{...batchInput('2026-12-01'),key:randomUUID()})).data;
 await pool.query('UPDATE tariffs SET amount_minor=10001 WHERE id=$1',[tariff.id]);
 assert.equal((await accountant.call('/finance/batches/'+draft.id+'/publish','POST',{key:randomUUID(),version:1,acceptWarnings:true})).data.error,'batch_preview_changed');
 assert.equal((await pool.query('SELECT * FROM billing_batch_invoices WHERE batch_id=$1',[draft.id])).rowCount,0);
 assert.equal((await accountant.call('/finance/batches/'+draft.id+'/cancel','POST',{key:randomUUID(),version:1})).status,200);
 await pool.query('UPDATE tariffs SET amount_minor=10000 WHERE id=$1',[tariff.id]);
 const fresh=(await accountant.call('/finance/batches','POST',{...batchInput('2026-12-01'),key:randomUUID()})).data;
 const failUnit=fresh.snapshot.charges[1].unitId;
 await pool.query(`CREATE FUNCTION phase4_fail_invoice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.unit_id='${failUnit}'::uuid AND NEW.period='2026-12-01'::date THEN RAISE EXCEPTION 'Isolated rollback fixture';END IF;RETURN NEW;END $$;
 CREATE TRIGGER phase4_fail_invoice BEFORE INSERT ON invoices FOR EACH ROW EXECUTE FUNCTION phase4_fail_invoice()`);
 try{
  assert.equal((await accountant.call('/finance/batches/'+fresh.id+'/publish','POST',{key:randomUUID(),version:1,acceptWarnings:true})).status,500);
  assert.equal((await pool.query('SELECT id FROM invoices WHERE unit_id=ANY($1::uuid[]) AND period=$2',[[unitA,unitB],'2026-12-01'])).rowCount,0);
  assert.equal((await pool.query('SELECT status,version FROM billing_batches WHERE id=$1',[fresh.id])).rows[0].status,'draft');
 }finally{await pool.query('DROP TRIGGER phase4_fail_invoice ON invoices; DROP FUNCTION phase4_fail_invoice()')}
 assert.equal((await accountant.call('/finance/batches/'+fresh.id+'/publish','POST',{key:randomUUID(),version:1,acceptWarnings:true})).status,200);
});
test('Bank import is evidence only, preserves raw metadata, detects duplicate/reference conflicts and never auto-posts suggested matches',async()=>{
 const before=(await pool.query('SELECT count(*)::int AS n FROM payments')).rows[0].n;
 const inv=invoices.find(i=>i.unit_id===unitA);
 const rows=[{...entry('B-001'),purpose:'Invoice '+inv.id+' unit P401A'},entry('B-OUT','-500')];
 const body={key:randomUUID(),account:'Phase4 account',transactions:rows};
 assert.equal((await family.call('/finance/bank/imports/preview','POST',body)).status,403);
 const preview=await accountant.call('/finance/bank/imports/preview','POST',body);assert.equal(preview.data.newCount,2);assert.equal(preview.data.rows[1].warning,'outgoing_not_reconcilable');
 const imported=await accountant.call('/finance/bank/imports','POST',body);assert.equal(imported.status,201);assert.equal(imported.data.imported_count,2);
 assert.equal((await accountant.call('/finance/bank/imports','POST',body)).data.id,imported.data.id);
 const tx=(await pool.query("SELECT * FROM bank_transactions WHERE external_id='B-001' AND organization_id=$1",[org])).rows[0];
 assert.deepEqual(tx.raw_payload,{reference:'B-001'});
 const suggestions=await accountant.call('/finance/bank/transactions/'+tx.id+'/suggestions');assert.equal(suggestions.status,200);assert.equal(suggestions.data[0].id,inv.id);assert.ok(suggestions.data[0].score>=100);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM payments')).rows[0].n,before);
 const duplicates=await accountant.call('/finance/bank/imports','POST',{...body,key:randomUUID()});assert.equal(duplicates.data.imported_count,0);assert.equal(duplicates.data.duplicate_count,2);
 const conflict={...body,key:randomUUID(),transactions:[{...rows[0],amountMinor:'16000'}]};
 assert.equal((await accountant.call('/finance/bank/imports/preview','POST',conflict)).data.conflictCount,1);
 assert.equal((await accountant.call('/finance/bank/imports','POST',conflict)).data.error,'bank_reference_conflict');
 assert.equal((await foreign.call('/finance/bank/transactions/'+tx.id+'/suggestions')).status,404);
 const outgoing=(await pool.query("SELECT * FROM bank_transactions WHERE external_id='B-OUT' AND organization_id=$1",[org])).rows[0];
 assert.equal((await accountant.call('/finance/bank/transactions/'+outgoing.id+'/confirm','POST',{key:randomUUID(),version:1,unitId:unitA,payerId:seeded.accounts.unit_owner.id,allocations:[]})).data.error,'outgoing_not_reconcilable');
 assert.equal((await accountant.call('/finance/bank/transactions/'+outgoing.id+'/ignore','POST',{key:randomUUID(),version:1,reason:'Outgoing transfer'})).status,200);
 await assert.rejects(pool.query('UPDATE bank_transactions SET amount_minor=amount_minor+1 WHERE id=$1',[tx.id]));
 assert.equal((await accountant.call('/finance/bank/imports','POST',{...body,key:randomUUID(),transactions:[entry('invalid','1.25')]})).status,400);
 assert.equal((await accountant.call('/finance/bank/imports','POST',{...body,key:randomUUID(),transactions:[{...entry('invalid-day'),date:'2026-02-30'}]})).status,400);
});
test('One bank deposit allocates across invoices on one account, creates credit and supports repeated append-only credit use without overspend',async()=>{
 const extra=(await accountant.call('/finance/batches','POST',{...batchInput('2027-01-01'),key:randomUUID()})).data;
 assert.equal((await accountant.call('/finance/batches/'+extra.id+'/publish','POST',{key:randomUUID(),version:1,acceptWarnings:true})).status,200);
 const accountInvoices=(await pool.query('SELECT i.* FROM invoices i JOIN billing_batch_invoices b ON b.invoice_id=i.id WHERE i.unit_id=$1 AND b.batch_id=ANY($2::uuid[]) ORDER BY i.period',[unitA,[published.id,extra.id]])).rows;
 assert.equal(accountInvoices.length,2);
 const imported=await importRows([entry('B-MULTI')]);const tx=imported.rows[0];
 const body={key:randomUUID(),version:1,unitId:unitA,payerId:seeded.accounts.unit_owner.id,allocations:[{invoiceId:accountInvoices[0].id,amountMinor:'4000'},{invoiceId:accountInvoices[1].id,amountMinor:'6000'}]};
 const otherUnit=invoices.find(i=>i.unit_id===unitB);
 assert.equal((await accountant.call('/finance/bank/transactions/'+tx.id+'/confirm','POST',{...body,key:randomUUID(),allocations:[{invoiceId:otherUnit.id,amountMinor:'100'}]})).status,404);
 assert.equal((await accountant.call('/finance/bank/transactions/'+tx.id+'/confirm','POST',{...body,key:randomUUID(),allocations:[{invoiceId:accountInvoices[0].id,amountMinor:'15001'}]})).data.error,'allocation_exceeds_payment');
 assert.equal((await pool.query('SELECT payment_id FROM bank_transactions WHERE id=$1',[tx.id])).rows[0].payment_id,null);
 const confirmed=await accountant.call('/finance/bank/transactions/'+tx.id+'/confirm','POST',body);assert.equal(confirmed.status,200);assert.equal(confirmed.data.creditMinor,'5000');
 assert.equal((await accountant.call('/finance/bank/transactions/'+tx.id+'/confirm','POST',body)).data.paymentId,confirmed.data.paymentId);
 const payment=confirmed.data.paymentId;
 assert.equal((await accountant.call('/finance/bank/transactions/'+tx.id+'/ignore','POST',{key:randomUUID(),version:2,reason:'Cannot hide paid deposit'})).status,409);
 assert.equal((await owner.call('/finance/credits')).data.some((r:any)=>r.id===payment),false);
 assert.equal((await owner.call('/auth/context','POST',{id:ownerContext})).status,200);
 assert.equal((await owner.call('/finance/credits')).data.find((r:any)=>r.id===payment).credit_minor,'5000');
 assert.equal((await owner.call('/finance/credits/'+payment+'/allocate','POST',{key:randomUUID(),allocations:[{invoiceId:accountInvoices[0].id,amountMinor:'1'}]})).status,403);
 const use={key:randomUUID(),allocations:[{invoiceId:accountInvoices[0].id,amountMinor:'2000'}]};
 assert.equal((await accountant.call('/finance/credits/'+payment+'/allocate','POST',use)).data.creditMinor,'3000');
 assert.equal((await accountant.call('/finance/credits/'+payment+'/allocate','POST',use)).data.creditMinor,'3000');
 const attempts=await Promise.all([1,2].map(()=>accountant.call('/finance/credits/'+payment+'/allocate','POST',{key:randomUUID(),allocations:[{invoiceId:accountInvoices[0].id,amountMinor:'2500'}]})));
 assert.deepEqual(attempts.map(r=>r.status).sort(),[200,400]);
 const credit=(await accountant.call('/finance/credits')).data.find((r:any)=>r.id===payment);assert.equal(credit.credit_minor,'500');assert.equal(credit.allocations.length,4);
 await assert.rejects(pool.query("INSERT INTO payment_allocations(organization_id,payment_id,invoice_id,amount_minor,created_by,allocation_kind) VALUES($1,$2,$3,501,$4,'credit')",[org,payment,accountInvoices[1].id,seeded.accounts.accountant.id]));
 await assert.rejects(pool.query('UPDATE payment_allocations SET amount_minor=1 WHERE payment_id=$1',[payment]));
 assert.equal((await accountant.call('/finance/credits/'+payment+'/allocate','POST',{key:randomUUID(),allocations:[{invoiceId:accountInvoices[0].id,amountMinor:'500'}]})).data.creditMinor,'0');
 assert.equal((await accountant.call('/finance/bank/transactions')).data.find((r:any)=>r.id===tx.id).status,'matched');
});
test('Full deposits can remain account credit; currency and tenant mismatches roll back all evidence-to-ledger writes',async()=>{
 const imported=await importRows([entry('B-CREDIT','3000'),entry('B-USD','1000','USD')]);
 const creditTx=imported.rows.find(r=>r.external_id==='B-CREDIT'),usd=imported.rows.find(r=>r.external_id==='B-USD');
 const body={key:randomUUID(),version:1,unitId:unitA,payerId:seeded.accounts.unit_owner.id,allocations:[]};
 const full=await accountant.call('/finance/bank/transactions/'+creditTx.id+'/confirm','POST',body);assert.equal(full.data.creditMinor,'3000');assert.equal(full.data.allocatedMinor,'0');
 assert.equal((await foreign.call('/finance/credits/'+full.data.paymentId+'/allocate','POST',{key:randomUUID(),allocations:[{invoiceId:invoices[0].id,amountMinor:'1'}]})).status,404);
 const invoice=invoices.find(i=>i.unit_id===unitA);
 assert.equal((await accountant.call('/finance/bank/transactions/'+usd.id+'/confirm','POST',{...body,key:randomUUID(),allocations:[{invoiceId:invoice.id,amountMinor:'1'}]})).data.error,'allocation_identity_mismatch');
 assert.equal((await pool.query('SELECT payment_id FROM bank_transactions WHERE id=$1',[usd.id])).rows[0].payment_id,null);
 assert.equal((await pool.query("SELECT id FROM payments WHERE reference=$1",['bank:'+usd.id])).rowCount,0);
 assert.equal((await accountant.call('/finance/bank/transactions/'+creditTx.id+'/confirm','POST',{...body,key:randomUUID(),version:2})).data.error,'bank_already_processed');
});
test('Area calculations use exact hundredths; large structured imports paginate without hiding transactions',async()=>{
 const area=await accountant.call('/finance/tariffs','POST',{name:'Phase4 exact area',amountMinor:'105',currency:'AMD',basis:'area'});assert.equal(area.status,201);
 for(const unitId of [unitA,unitB])await pool.query('INSERT INTO payer_assignments(organization_id,unit_id,payer_user_id,service_id,starts_on) VALUES($1,$2,$3,$4,$5)',[org,unitId,seeded.accounts.unit_owner.id,area.data.service_id,'2026-01-01']);
 const preview=await accountant.call('/finance/batches/preview','POST',{...batchInput(),tariffId:area.data.id});assert.equal(preview.status,200);assert.equal(preview.data.totalMinor,'3176');assert.equal(preview.data.charges.find((r:any)=>r.unitId===unitA).amountMinor,'1076');
 const rows=Array.from({length:105},(_,n)=>({...entry('B-PAGE-'+n,'100'),purpose:'X'.repeat(900)}));
 await importRows(rows);const first=(await accountant.call('/finance/bank/transactions?search=B-PAGE&limit=100&page=0')).data,second=(await accountant.call('/finance/bank/transactions?search=B-PAGE&limit=100&page=1')).data;
 assert.equal(first.length,100);assert.equal(second.length,5);assert.equal(new Set([...first,...second].map(r=>r.id)).size,105);
 assert.equal((await accountant.call('/finance/bank/transactions?limit=101')).status,400);
 const scoped=new Client();await scoped.login('accountant');
 const role=(await pool.query("INSERT INTO role_assignments(user_id,organization_id,building_id,role_key) VALUES($1,$2,$3,'accountant') RETURNING id",[seeded.accounts.accountant.id,org,building])).rows[0].id;
 assert.equal((await scoped.call('/auth/context','POST',{id:role})).status,200);
 assert.equal((await scoped.call('/finance/bank/transactions')).status,403);
 assert.equal((await scoped.call('/finance/batches/preview','POST',batchInput())).status,200);
});
test('Competing credit allocations to DIFFERENT invoices re-read money after locking; signed corrections and distinct allocation history remain compatible',async()=>{
 const draft=(await accountant.call('/finance/batches','POST',{...batchInput('2027-02-01'),key:randomUUID()})).data;
 assert.equal((await accountant.call('/finance/batches/'+draft.id+'/publish','POST',{key:randomUUID(),version:1,acceptWarnings:true})).status,200);
 const targets=(await pool.query("SELECT id FROM invoices WHERE unit_id=$1 AND status='published' AND period IN ('2027-01-01','2027-02-01') ORDER BY period",[unitA])).rows;
 const credit=(await accountant.call('/finance/credits')).data.find((r:any)=>r.credit_minor==='3000');
 const results=await Promise.all(targets.map(t=>accountant.call('/finance/credits/'+credit.id+'/allocate','POST',{key:randomUUID(),allocations:[{invoiceId:t.id,amountMinor:'2000'}]})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal(results.find(r=>r.status===400)?.data.error,'allocation_exceeds_payment');
 const adjustment={key:randomUUID(),invoiceId:targets[0].id,amountMinor:'-500',reason:'Signed correction, original invoice preserved'};
 assert.equal((await accountant.call('/finance/adjustments','POST',adjustment)).status,201);
 assert.equal((await accountant.call('/finance/adjustments','POST',adjustment)).status,201);
 await assert.rejects(pool.query("INSERT INTO adjustments(organization_id,invoice_id,amount_minor,reason,created_by) VALUES($1,$2,-10000,'Invalid reduction',$3)",[org,targets[0].id,seeded.accounts.accountant.id]));
 const original=invoices.find(i=>i.unit_id===unitA);
 const details=await accountant.call('/finance/invoices/'+original.id+'/details');assert.equal(details.status,200);
 assert.equal(details.data.payments.length,4);assert.equal(new Set(details.data.payments.map((r:any)=>r.allocation_id)).size,4);
 assert.ok(details.data.payments.every((r:any)=>r.source==='bank_import'));
});
