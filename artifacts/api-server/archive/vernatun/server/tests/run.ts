import 'dotenv/config';
import pg from 'pg';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
const cli=createRequire(import.meta.url).resolve('tsx/cli');
if(process.env.NODE_ENV==='production')throw new Error('Tests cannot run against production');
const source=process.env.DATABASE_URL;if(!source)throw new Error('DATABASE_URL is required');
const url=new URL(source);url.pathname='/vernatun_test';
const admin=new pg.Client({connectionString:source});await admin.connect();if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='vernatun_test'")).rowCount)await admin.query('CREATE DATABASE vernatun_test');await admin.end();
// Each pass gets clean fixtures, without dropping or modifying any app schema.
const schema='qa_'+randomBytes(10).toString('hex');
const testAdmin=new pg.Client({connectionString:url.toString()});await testAdmin.connect();
await testAdmin.query(`CREATE SCHEMA "${schema}"`);
url.searchParams.set('options',`-c search_path=${schema},public`);
const env={...process.env,NODE_ENV:'test',DATABASE_URL:url.toString(),DEMO_SEED_ENABLED:'true',PRIVATE_FILES_TEST_RUN:schema};
let status=0;
const checks=process.argv.includes('--phase1-only')
 ? [['--test','server/tests/phase1.test.ts']]
 : process.argv.includes('--imtun-only')
 ? [['--test','server/tests/imtun.test.ts']]
 : process.argv.includes('--hayat-only')
 ? [['--test','server/tests/hayat.test.ts']]
 : process.argv.includes('--backup-only')
 ? [['--test','server/tests/backup.test.ts']]
 : process.argv.includes('--storage-only')
 ? [['--test','server/tests/storage.test.ts'],['--test','server/tests/storage-inventory.test.ts']]
 : [['--test','server/tests/security.test.ts'],['--test','server/tests/phase1.test.ts'],['--test','server/tests/hayat.test.ts'],['--test','server/tests/imtun.test.ts'],['--test','server/tests/workflow.test.ts'],['--test','server/tests/business.test.ts'],['--test','server/tests/services.test.ts'],['--test','server/tests/lifecycle.test.ts'],['--test','server/tests/backup.test.ts'],['--test','server/tests/storage.test.ts'],['--test','server/tests/storage-inventory.test.ts']];
try{
 for(const args of [['server/migrate.ts'],['server/seed.ts'],['server/seed-modules.ts'],...checks.filter(args=>!process.argv.includes('--core-only')||!args.some(a=>/\/(backup|storage|storage-inventory)\.test\.ts$/.test(a)))]){
  const child=spawnSync(process.execPath,[cli,...args],{env,stdio:'inherit'});
  if(child.status!==0){status=child.status??1;break}
 }
}finally{
 const cleanup=spawnSync(process.execPath,[cli,'server/tests/storage-cleanup.ts'],{env,stdio:'inherit'});
 if(cleanup.status!==0)status=cleanup.status??1;
 // Only this randomly named, runner-created test schema is removed.
 await testAdmin.query(`DROP SCHEMA "${schema}" CASCADE`);await testAdmin.end();
}
process.exitCode=status;
