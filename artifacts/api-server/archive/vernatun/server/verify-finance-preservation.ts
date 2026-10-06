import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pool} from './db.js';
import {config} from './config.js';
if(config.NODE_ENV==='production')throw new Error('Development-only verification');
const [mode,path]=process.argv.slice(2);
if(!['capture','verify'].includes(mode)||!/^\/tmp\/phase4-[a-z-]+\.json$/.test(path??''))throw new Error('Invalid verification arguments');
// Only digests/counts leave PostgreSQL: no names, account numbers, credentials,
// statement contents or private objects are placed in temporary evidence.
const projections:Record<string,string>={
 invoices:'*',invoice_lines:'*',payments:'*',adjustments:'*',charges:'*',tariffs:'*',payer_assignments:'*',units:'*',
 payment_allocations:'id,organization_id,payment_id,invoice_id,amount_minor,created_by,created_at',
};
try{
 const snapshot:Record<string,unknown>={};
 for(const [table,columns] of Object.entries(projections)){
  snapshot[table]=(await pool.query(`SELECT count(*)::int AS count,md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,'[]')) AS digest FROM (SELECT ${columns} FROM ${table}) t`)).rows[0];
 }
 if(mode==='capture')await writeFile(path,JSON.stringify(snapshot));
 else{assert.deepEqual(snapshot,JSON.parse(await readFile(path,'utf8')));console.log('Preserved counts and legacy-field digests for '+Object.keys(projections).length+' financial tables; no ledger mutation or private bytes touched')}
}finally{await pool.end()}
