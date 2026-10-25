import 'dotenv/config';
import pg from 'pg';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const cli=createRequire(import.meta.url).resolve('tsx/cli');
if(process.env.NODE_ENV==='production')throw new Error('Tests cannot run against production');
const source=process.env.DATABASE_URL;if(!source)throw new Error('DATABASE_URL is required');
const url=new URL(source);url.pathname='/vernatun_test';
const isSevenChains=process.argv.includes('--seven-chains-only');
const admin=new pg.Client({connectionString:source});await admin.connect();if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='vernatun_test'")).rowCount)await admin.query('CREATE DATABASE vernatun_test');await admin.end();
// Each pass gets clean fixtures, without dropping or modifying any app schema.
const schemas=Array.from({length:isSevenChains?7:1},()=>`qa_${randomBytes(10).toString('hex')}`);
const schema=schemas[0];
const urlForSchema=(name:string)=>{const target=new URL(url);target.searchParams.set('options',`-c search_path=${name},public`);return target.toString()};
const testAdmin=new pg.Client({connectionString:url.toString()});await testAdmin.connect();
const createdSchemas:string[]=[];
const env={...process.env,NODE_ENV:'test',DATABASE_URL:urlForSchema(schema),DEMO_SEED_ENABLED:'true',PRIVATE_FILES_TEST_RUN:schema};
// Ephemeral test-only cryptographic material; never persisted in workspace Secrets.
if(process.argv.includes('--system-only')||process.argv.includes('--payments-only')||process.argv.includes('--browser-only')||process.argv.includes('--seven-chains-only')||process.argv.includes('--edge-only'))Object.assign(env,{
 VERNATUN_OPERATIONS_ENCRYPTION_KEY:randomBytes(32).toString('hex'),BACKUP_STORAGE_MODE:'local',
});
let status=0;
const sevenChains:readonly {name:string;files:readonly (readonly [string,string?])[]}[]=[
 {name:'Приглашение пользователя',files:[['server/tests/security.test.ts','Organization onboarding links|Revoked invitation|Expired invitation'],['server/tests/phase1.test.ts','invitation']]},
 {name:'IAM и границы полномочий',files:[['server/tests/assignment-management.test.ts']]},
 {name:'Заявка жителя и выполнение работы',files:[['server/tests/workflow.test.ts'],['server/tests/phase2.test.ts']]},
 {name:'Начисление, публикация и банковская сверка',files:[['server/tests/business.test.ts','Calculation'],['server/tests/phase4.test.ts']]},
 {name:'Дефект и работа подрядчика',files:[['server/tests/business.test.ts','Defect assigned contractor'],['server/tests/defect-collaboration.test.ts']]},
 {name:'Пропуск и охрана',files:[['server/tests/business.test.ts','Pass verification']]},
 {name:'Собрание, голосование и протокол',files:[['server/tests/phase6.test.ts']]},
];
const chainResults:{name:string;passed:number;failed:number;exitCodes:number[];startedAt:string;finishedAt?:string}[]=[];
const checks=process.argv.includes('--browser-only')
 ? [['server/tests/browser-sandbox.ts',...(process.argv.includes('--payments-qa')?['--payments-qa']:[])]]
  : process.argv.includes('--payments-only')
  ? [['--test','server/tests/payments.test.ts']]
 : isSevenChains
 ? []
 : process.argv.includes('--system-only')
 ? [['--test','server/tests/system-center.test.ts']]
 : process.argv.includes('--readiness-only')
 ? [['--test','server/tests/handover-readiness.test.ts']]
 : process.argv.includes('--unit-plans-only')
 ? [['--test','server/tests/unit-plans.test.ts']]
 : process.argv.includes('--availability-only')
 ? [['--test','server/tests/staff-availability.test.ts']]
 : process.argv.includes('--defect-collaboration-only')
 ? [['--test','server/tests/defect-collaboration.test.ts']]
 : process.argv.includes('--role-dashboards-only')
 ? [['--test','server/tests/role-dashboards.test.ts']]
 : process.argv.includes('--platform-support-meetings-only')
 ? [['--test','server/tests/platform-support-meetings.test.ts']]
 : process.argv.includes('--iam-only')
 ? [['--test','server/tests/assignment-management.test.ts']]
  : process.argv.includes('--global-account-provisioning-only')
  ? [['--test','server/tests/global-account-provisioning.test.mjs']]
 : process.argv.includes('--edge-only')
 ? [['--test','server/tests/edge.test.ts']]
 : process.argv.includes('--phase8-only')
 ? [['--test','server/tests/phase8.test.ts']]
 : process.argv.includes('--offline-only')
 ? [['--test','server/tests/offline.test.ts']]
 : process.argv.includes('--phase7-only')
 ? [['--test','server/tests/phase7.test.ts']]
 : process.argv.includes('--inventory-only')
 ? [['--test','server/tests/storage-inventory.test.ts']]
 : process.argv.includes('--delivery-only')
 ? [['--test','server/tests/email-providers.test.ts'],['--test','server/tests/email-delivery.test.ts'],['--test','server/tests/phase1.test.ts']]
 : process.argv.includes('--phase1-only')
 ? [['--test','server/tests/phase1.test.ts']]
 : process.argv.includes('--imtun-only')
 ? [['--test','server/tests/imtun.test.ts']]
 : process.argv.includes('--hayat-only')
 ? [['--test','server/tests/hayat.test.ts']]
 : process.argv.includes('--phase2-only')
 ? [['--test','server/tests/phase2.test.ts']]
 : process.argv.includes('--phase3-only')
 ? [['--test','server/tests/maintenance-calendar.test.ts'],['--test','server/tests/phase3.test.ts']]
 : process.argv.includes('--phase5-only')
 ? [['--test','server/tests/phase5.test.ts']]
  : process.argv.includes('--phase6-files-only')
  ? [['--test','server/tests/backup.test.ts'],['--test','server/tests/storage.test.ts'],['--test','server/tests/storage-inventory.test.ts']]
  : process.argv.includes('--phase6-only')
 ? [['--test','server/tests/phase6.test.ts']]
 : process.argv.includes('--phase4-only')
 ? [['--test','server/tests/phase4.test.ts']]
 : process.argv.includes('--backup-only')
 ? [['--test','server/tests/backup.test.ts']]
 : process.argv.includes('--storage-only')
 ? [['--test','server/tests/storage.test.ts'],['--test','server/tests/storage-inventory.test.ts']]
 : [['--test','server/tests/security.test.ts'],['--test','server/tests/phase1.test.ts'],['--test','server/tests/hayat.test.ts'],['--test','server/tests/imtun.test.ts'],['--test','server/tests/workflow.test.ts'],['--test','server/tests/phase2.test.ts'],['--test','server/tests/offline.test.ts'],['--test','server/tests/business.test.ts'],['--test','server/tests/services.test.ts'],['--test','server/tests/lifecycle.test.ts'],['--test','server/tests/backup.test.ts'],['--test','server/tests/storage.test.ts'],['--test','server/tests/storage-inventory.test.ts']];
if(checks.some(args=>args.includes('server/tests/phase1.test.ts'))){
 if(!checks.some(args=>args.includes('server/tests/email-providers.test.ts')))checks.splice(1,0,['--test','server/tests/email-providers.test.ts']);
 if(!checks.some(args=>args.includes('server/tests/email-delivery.test.ts')))checks.splice(2,0,['--test','server/tests/email-delivery.test.ts']);
}
if(checks.some(args=>args.includes('server/tests/security.test.ts'))){
  checks.push(['--test','server/tests/payments.test.ts']);
 checks.push(['--test','server/tests/system-center.test.ts']);
 checks.push(['--test','server/tests/handover-readiness.test.ts']);
 checks.push(['--test','server/tests/unit-plans.test.ts']);
 checks.push(['--test','server/tests/assignment-management.test.ts']);
 checks.push(['--test','server/tests/defect-collaboration.test.ts']);
 checks.push(['--test','server/tests/staff-availability.test.ts']);
 checks.push(['--test','server/tests/maintenance-calendar.test.ts'],['--test','server/tests/phase3.test.ts']);
 checks.push(['--test','server/tests/phase4.test.ts']);
 checks.push(['--test','server/tests/phase5.test.ts']);
 checks.push(['--test','server/tests/phase6.test.ts']);
}
try{
 for(const name of schemas){await testAdmin.query(`CREATE SCHEMA "${name}"`);createdSchemas.push(name)}
 const setup=process.argv.includes('--system-only')
  ? [['server/migrate.ts','--through=027'],['server/seed.ts'],['server/seed-modules.ts'],['server/iam-preservation.ts','--capture'],['server/migrate.ts'],['server/iam-preservation.ts']]
  : process.argv.includes('--readiness-only')
  ? [['server/migrate.ts','--through=026'],['server/seed.ts'],['server/seed-modules.ts'],['server/iam-preservation.ts','--capture'],['server/migrate.ts'],['server/iam-preservation.ts']]
  : process.argv.includes('--unit-plans-only')
  ? [['server/migrate.ts','--through=025'],['server/seed.ts'],['server/seed-modules.ts'],['server/iam-preservation.ts','--capture'],['server/migrate.ts'],['server/iam-preservation.ts']]
  : process.argv.includes('--availability-only')
  ? [['server/migrate.ts','--through=024'],['server/seed.ts'],['server/seed-modules.ts'],['server/iam-preservation.ts','--capture'],['server/migrate.ts'],['server/iam-preservation.ts']]
  : process.argv.includes('--iam-only')
  ? [['server/migrate.ts','--through=023'],['server/seed.ts'],['server/seed-modules.ts'],['server/iam-preservation.ts','--capture'],['server/migrate.ts'],['server/iam-preservation.ts']]
  : [['server/migrate.ts'],['server/seed.ts'],['server/seed-modules.ts']];
 const setupResults=[...setup];
 if(isSevenChains){
  for(const [index,chain] of sevenChains.entries()){
   const entry:typeof chainResults[number]={name:chain.name,passed:0,failed:0,exitCodes:[],startedAt:new Date().toISOString()};
   chainResults.push(entry);
   const chainEnv={...env,DATABASE_URL:urlForSchema(schemas[index]),PRIVATE_FILES_TEST_RUN:schemas[index]};
   for(const args of setupResults){
    const child=spawnSync(process.execPath,[cli,...args],{env:chainEnv,stdio:'inherit'});
    if(child.status!==0){status=child.status??1;entry.failed++;entry.exitCodes.push(child.status??1);break}
   }
   if(entry.exitCodes.length===0)
   for(const [file,pattern] of chain.files){
    const args=['--test',...(pattern?[`--test-name-pattern=${pattern}`]:[]),file];
    const child=spawnSync(process.execPath,[cli,...args],{env:chainEnv,encoding:'utf8',maxBuffer:20*1024*1024});
    const output=(child.stdout??'')+(child.stderr??'');
    process.stdout.write(output);
    const passed=Number(output.match(/(?:ℹ|#)\s+pass\s+(\d+)/)?.[1]??0);
    const failed=Number(output.match(/(?:ℹ|#)\s+fail\s+(\d+)/)?.[1]??0);
    entry.passed+=passed;
    entry.failed+=failed;
    entry.exitCodes.push(child.status??1);
    if(child.status===0&&passed===0){entry.failed++;entry.exitCodes[entry.exitCodes.length-1]=1;status=1}
    if(child.error){process.stderr.write(`${child.error.message}\n`);entry.failed++;entry.exitCodes[entry.exitCodes.length-1]=1}
    if(child.status!==0)status=child.status??1;
   }
   entry.finishedAt=new Date().toISOString();
  }
 }else for(const args of [...setupResults,...checks.filter(args=>!process.argv.includes('--core-only')||!args.some(a=>/\/(backup|storage|storage-inventory)\.test\.ts$/.test(a)))]){
  const child=spawnSync(process.execPath,[cli,...args],{env,stdio:'inherit'});
  if(child.status!==0){status=child.status??1;break}
 }
}catch(error){status=1;if(isSevenChains)process.stderr.write('Seven-chain runner failed before completion; owned-schema cleanup will continue.\n');else throw error}finally{
 let cleanupOk=true;
 let privateFilesCleaned=true;
 const removedSchemas:string[]=[];
 // Only the random schemas created by this runner in vernatun_test are removed.
 for(const name of createdSchemas){
  const schemaEnv={...env,DATABASE_URL:urlForSchema(name),PRIVATE_FILES_TEST_RUN:name};
  try{
   const cleanup=spawnSync(process.execPath,[cli,'server/tests/storage-cleanup.ts'],{env:schemaEnv,stdio:'inherit'});
   if(cleanup.status!==0){cleanupOk=false;privateFilesCleaned=false;status=cleanup.status??1}
  }catch{cleanupOk=false;privateFilesCleaned=false;status=1}
  try{
   await testAdmin.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
   const exists=(await testAdmin.query('SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name=$1) AS exists',[name])).rows[0].exists;
   cleanupOk=cleanupOk&&!exists;
   if(exists)status=1;
   else removedSchemas.push(name);
  }catch(error){cleanupOk=false;status=1;process.stderr.write(`QA schema cleanup failed (${name}): ${error instanceof Error?error.message:'unknown'}\n`)}
 }
 try{await testAdmin.end()}catch{cleanupOk=false;status=1}
 if(isSevenChains){
  const totals=chainResults.reduce((sum,chain)=>({passed:sum.passed+chain.passed,failed:sum.failed+chain.failed}),{passed:0,failed:0});
  const notRun=sevenChains.length-chainResults.length;
  const report=[
   '# Seven-chain isolated regression report',
   '',
   `- Run: ${new Date().toISOString()}`,
   `- Result: ${status===0&&cleanupOk?'PASS':'FAIL'}`,
   '- Target: isolated database `vernatun_test`; each journey receives its own random schema. CI supplies disposable PostgreSQL and configures no production credentials.',
   '- External services: `NODE_ENV=test` selects the development outbox; this CI job does not provide mail, payment, banking, or production secrets.',
   `- Tests: ${totals.passed} passed; ${totals.failed} failed; ${notRun} chains not run.`,
   `- QA cleanup: ${cleanupOk?'PASS':'FAIL'} — database schemas ${removedSchemas.length}/${createdSchemas.length} removed and absence verified; private files ${privateFilesCleaned?'cleaned':'not fully cleaned'}.`,
   '- Repeat from workspace root: `corepack pnpm --filter @workspace/api-server run test:seven-chains`.',
   '',
   '| # | User journey | Result | Passed | Failed |',
   '|---|---|---:|---:|---:|',
   ...sevenChains.map((chain,index)=>{const result=chainResults[index];const state=!result?'NOT RUN':!result.finishedAt?'FAIL':result.exitCodes.every(code=>code===0)&&result.failed===0?'PASS':'FAIL';return `| ${index+1} | ${chain.name} | ${state} | ${result?.passed??0} | ${result?.failed??0} |`}),
   '',
   '## Executed coverage',
   '',
   ...sevenChains.map(chain=>`- ${chain.name}: ${chain.files.map(([file,pattern])=>`\`${file}\`${pattern?` (name filter: ${pattern})`:''}`).join('; ')}.`),
   '',
   'This is one ordered API/database regression run. Each journey receives fresh fixtures in its own schema, avoiding cross-test role/data contamination. It is not new browser or production acceptance.',
   '',
  ].join('\n');
  await writeFile('../../../vernatun/docs/SEVEN-CHAINS-REGRESSION-REPORT.md',report,'utf8');
  process.stdout.write(`\nSeven-chain regression: ${status===0&&cleanupOk?'PASS':'FAIL'}; ${totals.passed} passed, ${totals.failed} failed, ${notRun} chains not run; cleanup ${cleanupOk?'PASS':'FAIL'} (${createdSchemas.length}/${createdSchemas.length} owned schemas removed and verified).\n`);
 }
}
process.exitCode=status;
