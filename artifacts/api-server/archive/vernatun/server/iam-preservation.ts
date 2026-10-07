import {pool} from './db.js';
import {config} from './config.js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
if(config.NODE_ENV==='production')throw new Error('Development or isolated test only');
const tables=['users','role_assignments','memberships','organizations','buildings','units','ownerships','invoices','payments','payment_allocations','documents','resident_requests','work_orders'];
const label=config.NODE_ENV==='test'?process.env.PRIVATE_FILES_TEST_RUN:'development';
if(!label||!(/^(development|qa_[a-f0-9]{20})$/).test(label))throw new Error('Invalid preservation scope');
const path=`.local/iam-preservation-${label}.json`;
const result:Record<string,unknown>={};
try{
 for(const table of tables){
  result[table]=(await pool.query(`SELECT count(*)::int AS count,
   md5(COALESCE(string_agg((to_jsonb(t)-ARRAY['account_status','assignment_status','profile_id'])::text,'|'
   ORDER BY (to_jsonb(t)-ARRAY['account_status','assignment_status','profile_id'])::text),'')) AS digest FROM ${table} t`)).rows[0];
 }
 if(process.argv.includes('--capture')){
  await mkdir('.local',{recursive:true});await writeFile(path,JSON.stringify(result),{mode:0o600});
  console.log('Captured legacy-field fingerprints for',tables.length,'tables');
 }else{
  const previous=JSON.parse(await readFile(path,'utf8'));
  if(JSON.stringify(previous)!==JSON.stringify(result))throw new Error('Existing data changed; inspect preservation fingerprints before proceeding');
  console.log('PASS: all legacy-field counts and fingerprints preserved across IAM migration');
 }
}finally{await pool.end()}
