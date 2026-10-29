import {pool} from './db.js';
import {readdir as listFiles,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {config} from './config.js';
import type {PoolClient} from 'pg';
import {safeDatabaseFailure} from './system-diagnostics.js';

type Migration={name:string;sql:string;checksum:string};
type MigrationPlan={
 database:string;schema:string;canCreateSchema:boolean;ledgerExists:boolean;
 applied:string[];pending:string[];drift:string[];
};
const lockId=6172921;
const expectedObjects=[
 {migration:'001_foundation.sql',name:'session',kind:'relation' as const,idempotent:false},
 {migration:'055_owner_registration_approval.sql',name:'resident_owner_access_requests',kind:'relation' as const,idempotent:false},
 {migration:'057_platform_cms.sql',name:'platform_cms_brand_settings',kind:'relation' as const,idempotent:false},
 {migration:'057_platform_cms.sql',name:'platform_cms_pages',kind:'relation' as const,idempotent:false},
 {migration:'062_platform_tasks.sql',name:'platform_tasks',kind:'relation' as const,idempotent:false},
 {migration:'064_configurable_billing_rules.sql',name:'billing_rules',kind:'relation' as const,idempotent:false},
 {migration:'064_configurable_billing_rules.sql',name:'unit_billing_parameters',kind:'relation' as const,idempotent:false},
 {migration:'064_configurable_billing_rules.sql',name:'unit_billing_resident_eligibility',kind:'relation' as const,idempotent:false},
 {migration:'064_configurable_billing_rules.sql',name:'unit_billing_service_quantities',kind:'relation' as const,idempotent:false},
 {migration:'064_configurable_billing_rules.sql',name:'unit_billing_service_applicability',kind:'relation' as const,idempotent:false},
 {migration:'064_configurable_billing_rules.sql',name:'billing_parameter_review_requests',kind:'relation' as const,idempotent:false},
 {migration:'064_configurable_billing_rules.sql',name:'billing_manual_charges',kind:'relation' as const,idempotent:false},
 {migration:'063_platform_task_discussion.sql',name:'platform_task_comments',kind:'relation' as const,idempotent:false},
 {migration:'063_platform_task_discussion.sql',name:'platform_task_attachments',kind:'relation' as const,idempotent:false},
 {migration:'013_platform_foundation.sql',name:'expire_support_grants(uuid)',kind:'function' as const,idempotent:false},
 {migration:'031_operations_sessions.sql',name:'system_revoked_sessions',kind:'relation' as const,idempotent:false},
 {migration:'032_log_retention.sql',name:'system_log_retention',kind:'relation' as const,idempotent:false},
 {migration:'033_operations_backups.sql',name:'operations_backups',kind:'relation' as const,idempotent:false},
 {migration:'034_backup_policies.sql',name:'operations_backup_policies',kind:'relation' as const,idempotent:false},
 {migration:'036_operations_integrations.sql',name:'outgoing_webhook_deliveries',kind:'relation' as const,idempotent:false},
 {migration:'037_platform_updates.sql',name:'platform_updates',kind:'relation' as const,idempotent:false},
 {migration:'038_platform_support_meetings.sql',name:'platform_support_meetings',kind:'relation' as const,idempotent:false},
 {migration:'038_platform_support_meetings.sql',name:'platform_support_meeting_events',kind:'relation' as const,idempotent:false},
 {migration:'047_update_release_pipeline.sql',name:'platform_updates_release_state',kind:'relation' as const,idempotent:false},
 {migration:'048_resident_superapp.sql',name:'resident_profiles',kind:'relation' as const,idempotent:false},
 {migration:'048_resident_superapp.sql',name:'resident_building_settings',kind:'relation' as const,idempotent:false},
 {migration:'048_resident_superapp.sql',name:'resident_product_records',kind:'relation' as const,idempotent:false},
 {migration:'048_resident_superapp.sql',name:'resident_record_marks',kind:'relation' as const,idempotent:false},
 {migration:'048_resident_superapp.sql',name:'resident_product_messages',kind:'relation' as const,idempotent:false},
 {migration:'049_resident_continuity.sql',name:'resident_email_challenges',kind:'relation' as const,idempotent:false},
 {migration:'049_resident_continuity.sql',name:'resident_direct_threads',kind:'relation' as const,idempotent:false},
 {migration:'049_resident_continuity.sql',name:'resident_direct_messages',kind:'relation' as const,idempotent:false},
 {migration:'049_resident_continuity.sql',name:'resident_direct_reads',kind:'relation' as const,idempotent:false},
 {migration:'049_resident_continuity.sql',name:'resident_saved_searches',kind:'relation' as const,idempotent:false},
 {migration:'049_resident_continuity.sql',name:'resident_ai_threads',kind:'relation' as const,idempotent:false},
 {migration:'049_resident_continuity.sql',name:'resident_ai_messages',kind:'relation' as const,idempotent:false},
 {migration:'049_resident_continuity.sql',name:'resident_service_bookings',kind:'relation' as const,idempotent:false},
 {migration:'050_resident_avatars.sql',name:'resident_avatars',kind:'relation' as const,idempotent:false},
 {migration:'051_resident_listing_photos.sql',name:'resident_listing_photos',kind:'relation' as const,idempotent:false},
 {migration:'052_resident_payer_responsibility.sql',name:'resident_payer_delegations',kind:'relation' as const,idempotent:false},
 {migration:'052_resident_payer_responsibility.sql',name:'resident_payer_policy',kind:'relation' as const,idempotent:false},
 {migration:'039_payment_foundation.sql',name:'payment_intents',kind:'relation' as const,idempotent:false},
 {migration:'039_payment_foundation.sql',name:'payment_transactions',kind:'relation' as const,idempotent:false},
 {migration:'040_edge_management.sql',name:'edge_nodes',kind:'relation' as const,idempotent:false},
 {migration:'040_edge_management.sql',name:'edge_device_access',kind:'relation' as const,idempotent:false},
 {migration:'040_edge_management.sql',name:'edge_commands',kind:'relation' as const,idempotent:false},
 {migration:'041_edge_block_scope.sql',name:'edge_blocks',kind:'relation' as const,idempotent:false},
 {migration:'041_edge_block_scope.sql',name:'edge_block_buildings',kind:'relation' as const,idempotent:false},
 {migration:'041_edge_block_scope.sql',name:'edge_node_buildings',kind:'relation' as const,idempotent:false},
];

async function migrationFiles(through?:string):Promise<Migration[]>{
 if(through&&(!/^\d{3}$/.test(through)||config.NODE_ENV!=='test'))throw new Error('Partial migration is for isolated tests only');
 const names=(await listFiles(new URL('./migrations/',import.meta.url)))
  .filter(name=>/^\d{3}_[a-z0-9_-]+\.sql$/i.test(name)&&(!through||name.slice(0,3)<=through)).sort();
 return Promise.all(names.map(async name=>{
  const sql=await readFile(new URL('./migrations/'+name,import.meta.url),'utf8');
  return {name,sql,checksum:createHash('sha256').update(sql).digest('hex')};
 }));
}

async function assertNoUntrackedTables(client:PoolClient,reason:string){
 const existing=(await client.query<{table_name:string}>(
  `SELECT table_name FROM information_schema.tables
   WHERE table_schema=current_schema() AND table_type='BASE TABLE'
    AND table_name<>'schema_migrations' AND table_name !~ '^pg_' ORDER BY table_name`)).rows;
 if(existing.length)throw new Error(`${reason}; refusing untracked schema (${existing.map(row=>row.table_name).join(', ')})`);
}

async function inspectCoolifyPlan(client:PoolClient,files:Migration[]):Promise<MigrationPlan>{
 const identity=(await client.query<{database:string;schema:string;canCreateSchema:boolean}>(
  `SELECT current_database() AS database,current_schema() AS schema,
   has_schema_privilege(current_schema(),'CREATE') AS "canCreateSchema"`)).rows[0];
 if(!identity||identity.database!=='vernatun')throw new Error('Coolify migration target must be database vernatun');
 const ledgerExists=Boolean((await client.query<{present:boolean}>(
  `SELECT to_regclass('schema_migrations') IS NOT NULL AS present`)).rows[0]?.present);
 let rows:{name:string;checksum:string}[]=[];
 if(ledgerExists){
  rows=(await client.query<{name:string;checksum:string}>(
   'SELECT name,checksum FROM schema_migrations ORDER BY name')).rows;
 }else{
  await assertNoUntrackedTables(client,'Migration ledger is missing');
 }
 if(rows.length===0){
  await assertNoUntrackedTables(client,'Migration ledger is empty');
 }
 const byName=new Map(files.map(file=>[file.name,file]));
 const applied=new Map(rows.map(row=>[row.name,row.checksum]));
 for(const row of rows)if(!byName.has(row.name))throw new Error(`Database has an unknown migration record: ${row.name}`);
 const drift:string[]=[];
 let gap=false;
 for(const file of files){
  const checksum=applied.get(file.name);
  if(checksum===undefined){gap=true;continue}
  if(gap)throw new Error(`Migration history is not a contiguous prefix; stopped at ${file.name}`);
  if(checksum!==file.checksum)throw new Error(`Migration checksum mismatch: ${file.name}`);
 }
 const appliedNames=new Set(applied.keys());
 for(const object of expectedObjects){
  const present=object.kind==='function'
   ?Boolean((await client.query<{present:boolean}>('SELECT to_regprocedure($1) IS NOT NULL AS present',[object.name])).rows[0]?.present)
   :Boolean((await client.query<{present:boolean}>('SELECT to_regclass($1) IS NOT NULL AS present',[object.name])).rows[0]?.present);
  if(appliedNames.has(object.migration)&&!present)drift.push(`Recorded ${object.migration}, but ${object.kind} ${object.name} is missing`);
  if(!appliedNames.has(object.migration)&&present&&!object.idempotent)drift.push(`${object.kind} ${object.name} exists without its migration record ${object.migration}`);
 }
 const sessionExists=Boolean((await client.query<{present:boolean}>(
  `SELECT to_regclass('session') IS NOT NULL AS present`)).rows[0]?.present);
 if(sessionExists){
  const columns=(await client.query<{column_name:string;data_type:string}>(
   `SELECT column_name,data_type FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='session'`)).rows;
  const byColumn=new Map(columns.map(column=>[column.column_name,column.data_type]));
  const missing=['sid','sess','expire'].filter(column=>!byColumn.has(column));
  if(missing.length)drift.push(`Existing session table lacks required columns: ${missing.join(', ')}`);
  if(byColumn.has('sid')&&byColumn.get('sid')!=='character varying')drift.push('Existing session table has an incompatible sid type');
  if(byColumn.has('sess')&&!['json','jsonb'].includes(byColumn.get('sess')!))drift.push('Existing session table has an incompatible sess type');
  if(byColumn.has('expire')&&byColumn.get('expire')!=='timestamp without time zone')drift.push('Existing session table has an incompatible expire type');
  const uniqueSid=Boolean((await client.query<{present:boolean}>(`
   SELECT EXISTS(
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
     ON tc.constraint_catalog=kcu.constraint_catalog AND tc.constraint_schema=kcu.constraint_schema
     AND tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema AND tc.table_name=kcu.table_name
    WHERE tc.table_schema=current_schema() AND tc.table_name='session'
     AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE') AND kcu.column_name='sid'
     AND (SELECT count(*) FROM information_schema.key_column_usage kcu2
      WHERE kcu2.constraint_catalog=tc.constraint_catalog AND kcu2.constraint_schema=tc.constraint_schema
       AND kcu2.constraint_name=tc.constraint_name AND kcu2.table_schema=tc.table_schema
       AND kcu2.table_name=tc.table_name)=1
   ) AS present`)).rows[0]?.present);
  if(!uniqueSid)drift.push('Existing session table lacks a unique key on sid');
 }
 return {
  database:identity.database,schema:identity.schema,canCreateSchema:identity.canCreateSchema,ledgerExists,
  applied:files.filter(file=>appliedNames.has(file.name)).map(file=>file.name),
  pending:files.filter(file=>!appliedNames.has(file.name)).map(file=>file.name),drift,
 };
}

function assertCoolifyEnvironment(apply:boolean){
 if(config.NODE_ENV!=='production')throw new Error('Coolify migration commands require NODE_ENV=production');
 if(apply&&process.env.VERNATUN_COOLIFY_MIGRATION_CONFIRM!=='APPLY')
  throw new Error('Set VERNATUN_COOLIFY_MIGRATION_CONFIRM=APPLY for the explicit migration step');
}

async function printCoolifyPlan(){
 assertCoolifyEnvironment(false);
 const files=await migrationFiles(),client=await pool.connect();
 try{
  const plan=await inspectCoolifyPlan(client,files);
  console.log(JSON.stringify({mode:'read_only_preflight',...plan,noWrites:true},null,2));
 }finally{client.release()}
}

async function applyCoolifyMigrations(){
 assertCoolifyEnvironment(true);
 const files=await migrationFiles(),client=await pool.connect();
 let locked=false;
 try{
  await client.query('SELECT pg_advisory_lock($1)',[lockId]);locked=true;
  let plan=await inspectCoolifyPlan(client,files);
  if(plan.drift.length)throw new Error(`Schema drift blocks automatic migration: ${plan.drift.join('; ')}`);
  if(plan.pending.length&&!plan.canCreateSchema)throw new Error('Database role lacks CREATE privilege on the current schema');
  if(!plan.ledgerExists)await client.query(
   'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz DEFAULT now())');
  plan=await inspectCoolifyPlan(client,files);
  if(plan.drift.length)throw new Error(`Schema drift blocks automatic migration: ${plan.drift.join('; ')}`);
  const byName=new Map(files.map(file=>[file.name,file]));
  for(const name of plan.pending){
   const file=byName.get(name)!;
   await client.query('BEGIN');
   try{
    await client.query(file.sql);
    await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,file.checksum]);
    await client.query('COMMIT');
    console.log('Applied migration:',name);
   }catch(error){
    await client.query('ROLLBACK');
    console.error(JSON.stringify({event:'coolify_migration_failed',migration:name,...(safeDatabaseFailure(error)??{})}));
    throw new Error(`Migration failed at ${name}; earlier committed migrations remain recorded and no data reset was attempted`);
   }
  }
  const final=await inspectCoolifyPlan(client,files);
  if(final.pending.length||final.drift.length)throw new Error('Post-migration schema verification failed');
  console.log(JSON.stringify({mode:'applied',database:final.database,appliedCount:final.applied.length,pending:final.pending,drift:final.drift},null,2));
 }finally{
  if(locked)await client.query('SELECT pg_advisory_unlock($1)',[lockId]);
  client.release();
 }
}

export async function migrate(){
 if(config.NODE_ENV==='production')throw new Error('Use the explicit Coolify migration preflight/apply commands in production');
 const through=process.argv.find(arg=>arg.startsWith('--through='))?.slice(10);
 const files=await migrationFiles(through),client=await pool.connect();
 try{
  await client.query('SELECT pg_advisory_lock($1)',[lockId]);
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz DEFAULT now())');
  for(const file of files){
   const previous=await client.query<{checksum:string}>('SELECT checksum FROM schema_migrations WHERE name=$1',[file.name]);
   if(previous.rowCount){if(previous.rows[0].checksum!==file.checksum)throw new Error(`Migration checksum mismatch: ${file.name}`);continue}
   await client.query('BEGIN');
   try{
    await client.query(file.sql);
    await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[file.name,file.checksum]);
    await client.query('COMMIT');
    console.log('Applied migration:',file.name);
   }catch(error){await client.query('ROLLBACK');throw error}
  }
 }finally{
  await client.query('SELECT pg_advisory_unlock($1)',[lockId]);
  client.release();
 }
}

async function main(){
 const coolifyPlan=process.argv.includes('--coolify-plan'),coolifyApply=process.argv.includes('--coolify-apply');
 if(coolifyPlan&&coolifyApply)throw new Error('Choose only one Coolify migration mode');
 try{
  if(coolifyPlan)await printCoolifyPlan();
  else if(coolifyApply)await applyCoolifyMigrations();
  else await migrate();
 }finally{await pool.end()}
}
try{await main()}catch(error){
 const diagnostic=safeDatabaseFailure(error);
 console.error(JSON.stringify({event:'migration_stopped',...(diagnostic??{})}));
 const hasCode=Boolean(error&&typeof error==='object'&&'code'in error);
 if(error instanceof Error&&!hasCode)console.error(error.message);
 process.exitCode=1;
}
