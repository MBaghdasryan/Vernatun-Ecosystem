import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import {
 formatProvisionFailure,
 provisionGlobalAccounts,
 provisioningSuccessSummary,
} from '../scripts/provision-global-accounts.mjs';
import { verifyGlobalAccounts } from '../scripts/verify-global-accounts.mjs';

const databaseUrl=process.env.DATABASE_URL;
if(process.env.NODE_ENV!=='test'||!databaseUrl||new URL(databaseUrl).pathname!=='/vernatun_test'){
 throw new Error('Global account provisioning integration tests require isolated vernatun_test');
}

const client=new pg.Client({connectionString:databaseUrl});
const suffix=randomUUID().replaceAll('-','');
const directory=await mkdtemp(join(tmpdir(),'vernatun-global-account-provision-test-'));
const accounts=[
 {role:'platform_admin',email:`platform-${suffix}@example.test`,name:'Test Platform Admin'},
 {role:'support',email:`support-${suffix}@example.test`,name:'Test Support'},
];
const queryUsers=async emails=>(await client.query(
 'SELECT id,email,password_hash,account_status FROM users WHERE lower(email)=ANY($1::text[]) ORDER BY lower(email)',
 [emails.map(email=>email.toLowerCase())],
)).rows;
const makePath=name=>join(directory,`${name}.json`);
const scriptPath=fileURLToPath(new URL('../scripts/provision-global-accounts.mjs',import.meta.url));

await client.connect();
try{
 await test('global account provisioning is atomic, diagnosed safely, and creates correct roles',async t=>{
  const identity=(await client.query('SELECT current_database() AS database,current_schema() AS schema')).rows[0];

  await t.test('reproduces PostgreSQL 42P18 on the uncast audit role parameter',async()=>{
   await client.query('BEGIN');
   try{
    await assert.rejects(client.query(
     `INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,details)
      VALUES(NULL,'auth.global_account.provision','user',$1,
       jsonb_build_object('method','coolify_one_time_cli','role',$2))`,
     [randomUUID(),'platform_admin'],
    ),error=>error.code==='42P18');
   }finally{
    await client.query('ROLLBACK');
   }
  });

  await t.test('creates both users, global roles, audit rows and a private credential file',async()=>{
   const path=makePath('success');
   let lastStage;
   const summary=await provisionGlobalAccounts({
    client,accounts,credentialPath:path,
    expectedDatabase:identity.database,expectedSchema:identity.schema,
    onStage:stage=>{lastStage=stage;},
   });
   assert.equal(lastStage,'transaction_commit');
   assert.deepEqual(summary.roles,['platform_admin','support']);
   assert.equal(summary.emailsSent,false);
   assert.equal(summary.passwordsPrinted,false);

   const file=JSON.parse(await readFile(path,'utf8'));
   assert.equal(file.emailSent,false);
   assert.deepEqual(file.accounts.map(account=>account.role),['platform_admin','support']);
   assert.deepEqual(file.accounts.map(account=>account.email),accounts.map(account=>account.email));
   const fileMode=(await stat(path)).mode&0o777;
   assert.equal(fileMode,0o600);

   const users=await queryUsers(accounts.map(account=>account.email));
   assert.equal(users.length,2);
   assert.deepEqual(users.map(user=>user.account_status),['active','active']);
   for(const user of users){
    const credential=file.accounts.find(account=>account.email===user.email);
    assert.ok(credential?.password);
    assert.equal(await bcrypt.compare(credential.password,user.password_hash),true);
   }

   const assignments=(await client.query(
    `SELECT u.email,a.role_key,a.organization_id,a.active,a.assignment_status
       FROM role_assignments a JOIN users u ON u.id=a.user_id
      WHERE lower(u.email)=ANY($1::text[]) ORDER BY lower(u.email)`,
    [accounts.map(account=>account.email)],
   )).rows;
   assert.deepEqual(assignments.map(row=>row.role_key),['platform_admin','support']);
   assert.ok(assignments.every(row=>row.organization_id===null&&row.active&&row.assignment_status==='active'));

    const admin=users.find(user=>user.email===accounts[0].email);
    assert.ok(admin);
    await client.query(
     'INSERT INTO mfa_credentials(user_id,secret_encrypted,enabled) VALUES($1,$2,true)',
     [admin.id,'test-only-encrypted-secret'],
    );
    try{
     const verification=await verifyGlobalAccounts({
      client,accounts,
      expectedDatabase:identity.database,
      expectedSchema:identity.schema,
     });
     assert.equal(verification.status,'pass');
     assert.deepEqual(verification.accounts.map(account=>account.role),['platform_admin','support']);
     assert.equal(verification.accounts[0].checks.mfa,'pass');
     const verificationOutput=JSON.stringify(verification);
     for(const account of accounts)assert.equal(verificationOutput.includes(account.email),false);
     assert.equal(verificationOutput.includes('password_hash'),false);
    }finally{
     await client.query('DELETE FROM mfa_credentials WHERE user_id=$1',[admin.id]);
    }

   const audit=(await client.query(
    `SELECT action,entity_id,actor_user_id,details
       FROM audit_events
      WHERE action='auth.global_account.provision'
        AND entity_id=ANY($1::text[])
      ORDER BY details->>'role'`,
    [users.map(user=>user.id)],
   )).rows;
   assert.equal(audit.length,2);
   assert.ok(audit.every(row=>row.actor_user_id===null&&row.action==='auth.global_account.provision'));
   assert.deepEqual(audit.map(row=>row.details.role),['platform_admin','support']);

   const successLog=JSON.stringify(provisioningSuccessSummary(summary.roles,path));
   for(const credential of file.accounts)assert.equal(successLog.includes(credential.password),false);
  });

  await t.test('duplicate email aborts before inserting the other account',async()=>{
   const existingEmail=accounts[0].email;
   const freshEmail=`fresh-${suffix}@example.test`;
   const path=makePath('duplicate');
   await assert.rejects(provisionGlobalAccounts({
    client,
    accounts:[
     {role:'platform_admin',email:existingEmail,name:'Duplicate Admin'},
     {role:'support',email:freshEmail,name:'Fresh Support'},
    ],
    credentialPath:path,
    expectedDatabase:identity.database,expectedSchema:identity.schema,
   }),error=>error.diagnostic?.stage==='existing_account_validation'&&error.diagnostic.rollbackSucceeded===true);
   assert.equal((await queryUsers([freshEmail])).length,0);
   await assert.rejects(readFile(path),error=>error.code==='ENOENT');
  });

  await t.test('unexpected assignment failure rolls back both users and removes the credentials file',async()=>{
   const failingAccounts=[
    {role:'platform_admin',email:`rollback-admin-${suffix}@example.test`,name:'Rollback Admin'},
    {role:'support',email:`rollback-support-${suffix}@example.test`,name:'Rollback Support'},
   ];
   const path=makePath('rollback');
   await client.query(`
    CREATE FUNCTION qa_reject_support_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
     IF NEW.role_key='support' THEN
      RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='qa_reject_support_assignment';
     END IF;
     RETURN NEW;
    END $$`);
   await client.query(`
    CREATE TRIGGER qa_reject_support_assignment
    BEFORE INSERT ON role_assignments
    FOR EACH ROW EXECUTE FUNCTION qa_reject_support_assignment()`);
   try{
    await assert.rejects(provisionGlobalAccounts({
     client,accounts:failingAccounts,credentialPath:path,
     expectedDatabase:identity.database,expectedSchema:identity.schema,
    }),error=>{
     assert.equal(error.diagnostic?.stage,'role_assignment_insertion');
     assert.equal(error.diagnostic?.category,'database');
     assert.equal(error.diagnostic?.code,'23514');
     assert.equal(error.diagnostic?.constraint,'qa_reject_support_assignment');
     assert.equal(error.diagnostic?.rollbackSucceeded,true);
     return true;
    });
   }finally{
    await client.query('DROP TRIGGER IF EXISTS qa_reject_support_assignment ON role_assignments');
    await client.query('DROP FUNCTION IF EXISTS qa_reject_support_assignment()');
   }
   assert.equal((await queryUsers(failingAccounts.map(account=>account.email))).length,0);
   await assert.rejects(readFile(path),error=>error.code==='ENOENT');
  });

  await t.test('failure diagnostics expose SQLSTATE and safe identifiers, never error text',async()=>{
   const plaintext='test-only-password-must-not-be-logged';
   const error=Object.assign(new Error(plaintext),{
    code:'42P18',table:'audit_events',column:'details',constraint:'audit_details_check',
   });
   const record=formatProvisionFailure(error,'audit_event_insertion',true);
   const serialized=JSON.stringify(record);
   assert.equal(record.stage,'audit_event_insertion');
   assert.equal(record.category,'database');
   assert.equal(record.code,'42P18');
   assert.equal(record.table,'audit_events');
   assert.equal(record.column,'details');
   assert.equal(record.constraint,'audit_details_check');
   assert.equal(record.rollbackSucceeded,true);
   assert.equal(serialized.includes(plaintext),false);
   assert.equal(serialized.includes('DATABASE_URL'),false);

   const fileError=formatProvisionFailure(Object.assign(new Error(plaintext),{code:'EACCES'}),'file_permissions',true);
   assert.equal(fileError.category,'filesystem');
   assert.equal(fileError.code,'EACCES');
   assert.equal(JSON.stringify(fileError).includes(plaintext),false);
  });

  await t.test('production CLI refuses a test database even when confirmation flags are supplied',async()=>{
   const result=spawnSync(process.execPath,[
    scriptPath,
    '--platform-admin-email=guard@example.test',
    '--support-email=support-guard@example.test',
    '--confirm-production-global-account-provision',
   ],{
    encoding:'utf8',
    env:{
     ...process.env,
     NODE_ENV:'test',
     VERNATUN_GLOBAL_ACCOUNT_CONFIRM:'CREATE_GLOBAL_ACCOUNTS',
    },
   });
   assert.equal(result.status,1);
   const diagnostic=JSON.parse(result.stderr.trim());
   assert.equal(diagnostic.stage,'production_guard');
   assert.equal(diagnostic.category,'validation');
   assert.equal(result.stderr.includes('guard@example.test'),false);
   assert.equal(result.stderr.includes(process.env.DATABASE_URL),false);
  });
 });
}finally{
 await client.end();
 await rm(directory,{recursive:true,force:true});
}
