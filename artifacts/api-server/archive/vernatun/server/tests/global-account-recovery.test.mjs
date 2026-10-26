import assert from 'node:assert/strict';
import {readFile,rm,stat} from 'node:fs/promises';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const databaseUrl=process.env.DATABASE_URL;
if(process.env.NODE_ENV!=='test'||!databaseUrl||new URL(databaseUrl).pathname!=='/vernatun_test')
 throw new Error('Global account recovery integration tests require isolated vernatun_test');

const client=new pg.Client({connectionString:databaseUrl});
const suffix=randomUUID().replaceAll('-','');
const scriptPath=fileURLToPath(new URL('../scripts/recover-global-account.mjs',import.meta.url));
const email=(name)=>`${name}-${suffix}@example.test`;
const passwordHash=(name)=>`old-hash-${name}-${suffix}`;
const users={
 admin:{email:email('selected-admin'),password_hash:passwordHash('admin'),role:'platform_admin'},
 support:{email:email('selected-support'),password_hash:passwordHash('support'),role:'support'},
 bystander:{email:email('unselected-admin'),password_hash:passwordHash('bystander'),role:'platform_admin'},
 blocked:{email:email('blocked-admin'),password_hash:passwordHash('blocked'),role:'platform_admin',blocked:true},
 organizational:{email:email('organization-only-admin'),password_hash:passwordHash('org'),role:'org_admin',organization:true},
 wrongRole:{email:email('wrong-global-role'),password_hash:passwordHash('wrong'),role:'support'},
 multipleRoles:{email:email('multiple-global-roles'),password_hash:passwordHash('multiple'),role:'platform_admin',extraGlobalRole:'support'},
 inactive:{email:email('revoked-admin'),password_hash:passwordHash('inactive'),role:'platform_admin',inactiveAssignment:true},
};

async function snapshot(userId){
 const user=await client.query('SELECT id,email,password_hash,blocked,account_status,must_change_password FROM users WHERE id=$1',[userId]);
 const assignments=await client.query(`SELECT role_key,organization_id,active,assignment_status FROM role_assignments
  WHERE user_id=$1 ORDER BY role_key,organization_id NULLS FIRST`,[userId]);
 const mfa=await client.query('SELECT secret_encrypted,enabled,last_counter,recovery_hashes FROM mfa_credentials WHERE user_id=$1',[userId]);
 const sessions=await client.query(`SELECT sid,sess FROM session WHERE sess->'passport'->>'user'=$1 ORDER BY sid`,[userId]);
 const resets=await client.query('SELECT token_hash,used_at FROM password_resets WHERE user_id=$1 ORDER BY token_hash',[userId]);
 const audit=await client.query(`SELECT action,details FROM audit_events WHERE entity_type='user' AND entity_id=$1
  AND action='auth.password.recovery' ORDER BY id`,[userId]);
 return {user:user.rows,assignments:assignments.rows,mfa:mfa.rows,sessions:sessions.rows,resets:resets.rows,audit:audit.rows};
}

function runRecovery(accountEmail,role,{testMode=true,removeTestGate=false,forceTestGateInProduction=false}={}){
 const env={...process.env,NODE_ENV:testMode?'test':'production',DATABASE_URL:databaseUrl};
 if(testMode)env.VERNATUN_ACCOUNT_RECOVERY_TEST_MODE='1';
 else {
  delete env.VERNATUN_ACCOUNT_RECOVERY_TEST_MODE;
  env.VERNATUN_ACCOUNT_RECOVERY_CONFIRM='RESET_GLOBAL_ACCOUNT';
 }
 if(removeTestGate)delete env.VERNATUN_ACCOUNT_RECOVERY_TEST_MODE;
 if(forceTestGateInProduction)env.VERNATUN_ACCOUNT_RECOVERY_TEST_MODE='1';
 return spawnSync(process.execPath,[scriptPath,`--email=${accountEmail}`,`--role=${role}`,
  '--confirm-production-account-recovery'],{encoding:'utf8',env,maxBuffer:1024*1024});
}

await client.connect();
try{
 const identity=(await client.query('SELECT current_database() AS database,current_schema() AS schema')).rows[0];
 assert.equal(identity.database,'vernatun_test');
 assert.match(identity.schema,/^qa_[a-f0-9]{20}$/);
 let organizationId;
 const [createdOrg]=await client.query(
  "INSERT INTO organizations(name) VALUES($1) RETURNING id",[`${suffix} isolated recovery organization`],
 ).then(result=>result.rows);
 organizationId=createdOrg.id;

 for(const [key,account] of Object.entries(users)){
  account.id=randomUUID();
  await client.query(`INSERT INTO users(id,email,name,password_hash,blocked)
   VALUES($1,$2,$3,$4,$5)`,[account.id,account.email,`Isolated ${key}`,account.password_hash,account.blocked??false]);
  if(account.organization){
   await client.query('INSERT INTO memberships(user_id,organization_id) VALUES($1,$2)',[account.id,organizationId]);
   await client.query(`INSERT INTO role_assignments(user_id,organization_id,role_key)
    VALUES($1,$2,$3)`,[account.id,organizationId,account.role]);
  }else{
   await client.query(`INSERT INTO role_assignments(user_id,organization_id,role_key,active)
    VALUES($1,NULL,$2,$3)`,[account.id,account.role,!account.inactiveAssignment]);
   if(account.extraGlobalRole)await client.query(
    `INSERT INTO role_assignments(user_id,organization_id,role_key) VALUES($1,NULL,$2)`,
    [account.id,account.extraGlobalRole],
   );
  }
  await client.query(`INSERT INTO mfa_credentials(user_id,secret_encrypted,enabled,last_counter,recovery_hashes)
   VALUES($1,$2,true,17,ARRAY['test-recovery-hash'])`,[account.id,`test-encrypted-mfa-${key}`]);
  await client.query(`INSERT INTO session(sid,sess,expire) VALUES($1,$2::json,now()+interval '1 hour')`,
   [`recovery-${key}-${suffix}`,JSON.stringify({passport:{user:account.id}})]);
  await client.query(`INSERT INTO password_resets(user_id,token_hash,expires_at)
   VALUES($1,$2,now()+interval '1 hour')`,[account.id,randomBytes(32).toString('hex')]);
 }
 // Include a second session to ensure all and only the selected user's sessions are revoked.
 await client.query(`INSERT INTO session(sid,sess,expire) VALUES($1,$2::json,now()-interval '1 day')`,
  [`recovery-admin-expired-${suffix}`,JSON.stringify({passport:{user:users.admin.id}})]);
 const unselectedBefore=await Promise.all([users.bystander,users.blocked,users.organizational,
  users.wrongRole,users.multipleRoles,users.inactive].map(user=>snapshot(user.id)));

 await test('recovery CLI only resets one active exact-role global account and protects its credentials',async t=>{
  let platformAdminAfterRecovery;
  for(const selected of [users.admin,users.support]){
   await t.test(`${selected.role} success revokes only its sessions, keeps MFA and audits`,async()=>{
    const before=await snapshot(selected.id);
    const result=runRecovery(selected.email,selected.role);
    let privateFile;
    try{
     assert.equal(result.status,0,result.stderr);
     assert.equal(result.signal,null);
     assert.equal(result.stderr.includes(process.env.DATABASE_URL),false);
     assert.equal(result.stderr.includes(selected.password_hash),false);
     const summary=JSON.parse(result.stdout);
     privateFile=summary.privateCredentialsFile;
     assert.equal(summary.status,'password_reset');
     assert.equal(summary.role,selected.role);
     assert.equal(summary.passwordPrinted,false);
     assert.equal(summary.mfaChanged,false);
     assert.equal(summary.sessionsRevoked,before.sessions.length);
     assert.match(privateFile,/^\/tmp\/vernatun-global-account-recovery-(platform_admin|support)-[0-9a-f-]{36}\.json$/);
     const mode=(await stat(privateFile)).mode&0o777;
     assert.equal(mode,0o600);
     const credential=JSON.parse(await readFile(privateFile,'utf8'));
     assert.equal(credential.role,selected.role);
     assert.equal(credential.accountEmail,selected.email);
     assert.ok(credential.password.length>=32);
     assert.equal(result.stdout.includes(credential.password),false);
     assert.equal(result.stderr.includes(credential.password),false);
     assert.notEqual(credential.password,selected.password_hash);
     const after=await snapshot(selected.id);
     assert.notEqual(after.user[0].password_hash,selected.password_hash);
     assert.equal(await bcrypt.compare(credential.password,after.user[0].password_hash),true);
      assert.equal(after.user[0].must_change_password,true,'recovered accounts must be blocked until the password is changed');
     assert.deepEqual(after.mfa,before.mfa,'recovery must leave the enabled MFA secret and counters unchanged');
     assert.equal(after.sessions.length,0);
     assert.equal(before.sessions.length,selected===users.admin?2:1);
      const revokedRefs=before.sessions.map(row=>createHash('sha256').update(row.sid).digest('hex'));
      const revocations=await client.query('SELECT ref FROM system_revoked_sessions WHERE ref=ANY($1::text[])',[revokedRefs]);
      assert.equal(revocations.rowCount,revokedRefs.length,'every pre-recovery session must have a tombstone against late saves');
     assert.equal(after.resets.length,before.resets.length);
     assert.ok(after.resets.every(row=>row.used_at!==null),'outstanding reset links must be invalidated');
     assert.equal(after.audit.length,before.audit.length+1);
     assert.equal(after.audit.at(-1).action,'auth.password.recovery');
     assert.equal(after.audit.at(-1).details.role,selected.role);
     assert.equal(JSON.stringify(after.audit).includes(credential.password),false);
     if(selected===users.admin)platformAdminAfterRecovery=after;
     else assert.deepEqual(await snapshot(users.admin.id),platformAdminAfterRecovery,
      'recovering support must not modify the platform administrator');
    }finally{
     if(!privateFile){
      const match=result.stdout.match(/"privateCredentialsFile"\s*:\s*"([^"]+)"/);
      if(match&&/^\/tmp\/vernatun-global-account-recovery-(platform_admin|support)-[0-9a-f-]{36}\.json$/.test(match[1]))
       privateFile=match[1];
     }
     if(privateFile&&/^\/tmp\/vernatun-global-account-recovery-(platform_admin|support)-[0-9a-f-]{36}\.json$/.test(privateFile))
      await rm(privateFile,{force:true});
    }
   });
  }

  await t.test('unknown, blocked, organization-scoped, wrong-role, multi-role, and revoked targets are unchanged',async()=>{
   const cases=[
    {account:users.blocked,role:'platform_admin'},
    {account:users.organizational,role:'platform_admin'},
    {account:users.wrongRole,role:'platform_admin'},
    {account:users.multipleRoles,role:'platform_admin'},
    {account:users.inactive,role:'platform_admin'},
   ];
   for(const item of cases){
    const before=await snapshot(item.account.id);
    const result=runRecovery(item.account.email,item.role);
    assert.notEqual(result.status,0,`unexpected recovery success for ${item.account.email}`);
    assert.equal(result.stdout.trim(),'');
    assert.equal(result.stderr.includes(item.account.password_hash),false);
    assert.equal(result.stderr.includes(process.env.DATABASE_URL),false);
    assert.equal(result.stderr.includes(item.account.email),false);
    assert.deepEqual(await snapshot(item.account.id),before,`${item.account.role} target must remain byte-for-byte unchanged`);
   }
   const missingEmail=email('missing-account');
   const missing=runRecovery(missingEmail,'platform_admin');
   assert.notEqual(missing.status,0);
   assert.equal(missing.stdout.trim(),'');
   assert.equal((await client.query('SELECT 1 FROM users WHERE email=$1',[missingEmail])).rowCount,0);
   for(const [index,account] of [users.bystander,users.blocked,users.organizational,
    users.wrongRole,users.multipleRoles,users.inactive].entries())
    assert.deepEqual(await snapshot(account.id),unselectedBefore[index]);
  });

  await t.test('production mode refuses the isolated test database; test mode requires the explicit test-only gate',async()=>{
   for(const options of [{testMode:false},{testMode:false,forceTestGateInProduction:true},{testMode:true,removeTestGate:true}]){
    const result=runRecovery(users.admin.email,'platform_admin',options);
    assert.notEqual(result.status,0);
    assert.equal(result.stdout.trim(),'');
    assert.equal(result.stderr.includes(users.admin.email),false);
    assert.equal(result.stderr.includes(process.env.DATABASE_URL),false);
   }
   assert.deepEqual(await snapshot(users.admin.id),await snapshot(users.admin.id));
  });
 });
}finally{
 await client.end();
}
