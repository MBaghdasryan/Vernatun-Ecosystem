/** Hash-only development migration proof; never writes business data or raw rows. */
import {pool} from './db.js';
import {config} from './config.js';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
if(config.NODE_ENV!=='development')throw new Error('Development only');
const path=resolve('../../.local/qa/phase6-preservation.json');
const names=['users','organizations','memberships','role_assignments','buildings','units','ownerships','meetings','agenda_items','votes','documents','support_cases','support_messages','invoices','payments','payment_allocations','adjustments','leases','occupancies','defects','defect_history','work_orders','resident_requests'];
const compare=process.argv.includes('--compare'),baseline:any=compare?JSON.parse(await readFile(path,'utf8')):{capturedAt:new Date().toISOString(),tables:{}};
const checked:any={};
try{
 for(const name of names){
 const cols=compare?baseline.tables[name].columns:(await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position",[name])).rows.map(r=>r.column_name);
 if(!cols.length)throw new Error('Missing baseline table '+name);
 const columns=cols.map((s:string)=>'"'+s.replaceAll('"','""')+'"').join(',');
 const r=(await pool.query(`SELECT count(*)::text AS count,encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') AS digest FROM(SELECT ${columns} FROM "${name}")t`)).rows[0];
 checked[name]={...r,columns:cols};
 if(compare&&(r.count!==baseline.tables[name].count||r.digest!==baseline.tables[name].digest))throw new Error('Business preservation mismatch: '+name);
 }
 await mkdir(resolve(path,'..'),{recursive:true});
 if(compare){baseline.verifiedAt=new Date().toISOString();baseline.verified=true;await writeFile(path,JSON.stringify(baseline,null,2));console.log('Preserved original columns/counts/digests:',names.length)}
 else{baseline.tables=checked;await writeFile(path,JSON.stringify(baseline,null,2));console.log('Captured hash-only original-column baseline:',names.length)}
}finally{await pool.end()}
