import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pool} from './db.js';
import {config} from './config.js';
if(config.NODE_ENV==='production')throw new Error('Development-only verification');
const [mode,path]=process.argv.slice(2);
if(!['capture','verify'].includes(mode)||!/^\/tmp\/phase5-[a-z-]+\.json$/.test(path??''))throw new Error('Invalid verification arguments');
const projections:Record<string,string>={
 organizations:'id,name,timezone,currency,is_demo,created_at,contact_email,contact_phone,brand_color,subscription_enforced',
 support_cases:'id,organization_id,created_by,assigned_to,subject,body,status,reply,created_at',
 onboarding_steps:'id,organization_id,assigned_to,title,due_on,completed_at',
 users:'*',memberships:'*',role_assignments:'*',units:'*',meters:'*',leases:'*',documents:'*',import_jobs:'*',
 invoices:'*',invoice_lines:'*',payments:'*',payment_allocations:'*',adjustments:'*',payment_accounts:'*',
};
try{
 const snapshot:Record<string,unknown>={};
  for(const [table,columns] of Object.entries(projections))snapshot[table]=(await pool.query(`SELECT count(*)::int AS count,md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS digest FROM (SELECT ${columns} FROM ${table}) t`)).rows[0];
 if(mode==='capture')await writeFile(path,JSON.stringify(snapshot));
 else{assert.deepEqual(snapshot,JSON.parse(await readFile(path,'utf8')));console.log('Preserved legacy counts/digests for '+Object.keys(projections).length+' business tables; no private bytes touched')}
}finally{await pool.end()}
