import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pool} from './db.js';
import {config} from './config.js';
// Development migration evidence contains counts/digests, never row contents,
// credentials, object keys or private bytes. No seed or data mutation.
if(config.NODE_ENV==='production')throw new Error('Development-only verification');
const [mode,path]=process.argv.slice(2);
if(!['capture','verify'].includes(mode)||!/^\/tmp\/phase3-[a-z-]+\.json$/.test(path??''))throw new Error('Invalid verification arguments');
const projections:Record<string,string>={
 users:'*',memberships:'*',role_assignments:'*',units:'*',assets:'*',invoices:'*',
 request_photos:'*',documents:'*',work_reports:'*',request_messages:'*',
 resident_requests:'id,organization_id,unit_id,author_user_id,subject,description,status,version',
 maintenance_plans:'id,organization_id,asset_id,title,due_on,completed_at,completed_by,report',
 work_orders:'id,request_id,technician_id,assigned_by,status,checklist,report,version',
 leases:'id,organization_id,unit_id,renter_id,starts_on,ends_on,amount_minor,currency,created_by',
};
try{
 const snapshot:Record<string,unknown>={};
 for(const [table,columns] of Object.entries(projections)){
  snapshot[table]=(await pool.query(`SELECT count(*)::int AS count,md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,'[]')) AS digest FROM (SELECT ${columns} FROM ${table}) t`)).rows[0];
 }
 if(mode==='capture')await writeFile(path,JSON.stringify(snapshot));
 else{assert.deepEqual(snapshot,JSON.parse(await readFile(path,'utf8')));console.log('Preserved counts and legacy-field digests for '+Object.keys(projections).length+' tables; no private bytes touched')}
}finally{await pool.end()}
