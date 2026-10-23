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
const admin=new pg.Client({connectionString:source});await admin.connect();if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='vernatun_test'")).rowCount)await admin.query('CREATE DATABASE vernatun_test');await admin.end();
// Each pass gets clean fixtures, without dropping or modifying any app schema.
const schema='qa_'+randomBytes(10).toString('hex');
const testAdmin=new pg.Client({connectionString:url.toString()});await testAdmin.connect();
await testAdmin.query(`CREATE SCHEMA "${schema}"`);
url.searchParams.set('options',`-c search_path=${schema},public`);
const env={...process.env,NODE_ENV:'test',DATABASE_URL:url.toString(),DEMO_SEED_ENABLED:'true',PRIVATE_FILES_TEST_RUN:schema};
// Ephemeral test-only cryptographic material; never persisted in workspace Secrets.
if(process.argv.includes('--system-only')||process.argv.includes('--payments-only')||process.argv.includes('--browser-only')||process.argv.includes('--seven-chains-only'))Object.assign(env,{
 VERNATUN_OPERATIONS_ENCRYPTION_KEY:randomBytes(32).toString('hex'),BACKUP_STORAGE_MODE:'local',
});
let status=0;
const sevenChains=[
 {name:'Приглашение пользователя',files:[['server/tests/phase1.test.ts','invitation']]},
 {name:'IAM и границы полномочий',files:[['server/tests/assignment-management.test.ts']]},
 {name:'Заявка жителя и выполнение работы',files:[['server/tests/workflow.test.ts'],['server/tests/phase2.test.ts']]},
 {name:'Начисление, публикация и банковская сверка',files:[['server/tests/business.test.ts','Calculation'],['server/tests/phase4.test.ts']]},
 {name:'Дефект и работа подрядчика',files:[['server/tests/business.test.ts','Defect assigned contractor'],['server/tests/defect-collaboration.test.ts']]},
 {name:'Пропуск и охрана',files:[['server/tests/business.test.ts','Pass verification']]},
 {name:'Собрание, голосование и протокол',files:[['server/tests/phase6.test.ts']]},
] as const;
const chainResults:{name:string;passed:number;failed:number;exitCodes:number[];startedAt:string;finishedAt?:string}[]=[];
const isSevenChains=process.argv.includes('--seven-chains-only');
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
  for(const args of setupResults){
   const child=spawnSync(process.execPath,[cli,...args],{env,stdio:'inherit'});
   if(child.status!==0){status=child.status??1;break}
  }
  if(status===0)
  for(const chain of sevenChains){
   const entry={name:chain.name,passed:0,failed:0,exitCodes:[] as number[],startedAt:new Date().toISOString()};
   chainResults.push(entry);
   for(const [file,pattern] of chain.files){
    const args=['--test',file,...(pattern?[`--test-name-pattern=${pattern}`]:[])];
    const child=spawnSync(process.execPath,[cli,...args],{env,encoding:'utf8',maxBuffer:20*1024*1024});
    const output=(child.stdout??'')+(child.stderr??'');
    process.stdout.write(output);
    entry.passed+=(output.match(/^✔ /gm)??[]).length;
    entry.failed+=(output.match(/^✖ /gm)??[]).length;
    entry.exitCodes.push(child.status??1);
    if(child.error){process.stderr.write(`${child.error.message}\n`);entry.failed++;entry.exitCodes[entry.exitCodes.length-1]=1}
    if(child.status!==0)status=child.status??1;
   }
   entry.finishedAt=new Date().toISOString();
  }
 }else for(const args of [...setupResults,...checks.filter(args=>!process.argv.includes('--core-only')||!args.some(a=>/\/(backup|storage|storage-inventory)\.test\.ts$/.test(a)))]){
  const child=spawnSync(process.execPath,[cli,...args],{env,stdio:'inherit'});
  if(child.status!==0){status=child.status??1;break}
 }
}finally{
 const cleanup=spawnSync(process.execPath,[cli,'server/tests/storage-cleanup.ts'],{env,stdio:'inherit'});
 let cleanupOk=cleanup.status===0;
 if(cleanup.status!==0)status=cleanup.status??1;
 // Only this randomly named, runner-created test schema is removed.
 try{
  await testAdmin.query(`DROP SCHEMA "${schema}" CASCADE`);
  const exists=(await testAdmin.query('SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name=$1) AS exists',[schema])).rows[0].exists;
  cleanupOk=cleanupOk&&!exists;
  if(exists)status=1;
 }catch(error){cleanupOk=false;status=1;process.stderr.write(`QA schema cleanup failed (${schema}): ${error instanceof Error?error.message:'unknown'}\n`)}
 await testAdmin.end();
 if(isSevenChains){
  const totals=chainResults.reduce((sum,chain)=>({passed:sum.passed+chain.passed,failed:sum.failed+chain.failed}),{passed:0,failed:0});
  const report=[
   '# Seven-chain isolated regression report',
   '',
   `- Run: ${new Date().toISOString()}`,
   `- Result: ${status===0&&cleanupOk?'PASS':'FAIL'}`,
   `- Target: isolated database \`vernatun_test\`, random schema \`${schema}\`; production database was not used.`,
   `- External services: no live mail, payment, or banking calls; provider integrations use existing isolated test modes.`,
   `- Tests: ${totals.passed} passed; ${totals.failed} failed.`,
   `- QA cleanup: ${cleanupOk?'PASS — runner-owned schema removed and absence verified':'FAIL — cleanup error; see test output.'}`,
   '',
   '| # | User journey | Result | Passed | Failed |',
   '|---|---|---:|---:|---:|',
   ...chainResults.map((chain,index)=>`| ${index+1} | ${chain.name} | ${chain.exitCodes.every(code=>code===0)&&chain.failed===0?'PASS':'FAIL'} | ${chain.passed} | ${chain.failed} |`),
   '',
   'This is a single ordered API/database regression run. It is not a new live external-service test or production acceptance.',
   '',
  ].join('\n');
  await writeFile('../../../vernatun/docs/SEVEN-CHAINS-REGRESSION-REPORT.md',report,'utf8');
  process.stdout.write(`\nSeven-chain regression: ${status===0&&cleanupOk?'PASS':'FAIL'}; ${totals.passed} passed, ${totals.failed} failed; cleanup ${cleanupOk?'PASS':'FAIL'}.\n`);
 }
}
process.exitCode=status;
