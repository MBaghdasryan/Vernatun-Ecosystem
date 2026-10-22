import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,rm} from 'node:fs/promises';
import {app} from '../app.js';
import {pool} from '../db.js';
import {config} from '../config.js';
import {observedJob,recordSystemEvent,safeCode} from '../system-observability.js';
import {logCsvCell} from '../system-center.js';
import {safeErrorStack,safeDatabaseFailure,apiBuildId} from '../system-diagnostics.js';
import {emailHealthMetrics} from '../system-email-health.js';
import {MemoryCacheProvider,RedisCacheProvider,cachedStorageHealth,clearHealthCache} from '../operations-cache.js';
import {pruneSystemLogs} from '../system-retention.js';
import {OperationsCipher,operationsCipher} from '../operations-encryption.js';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {sessionDevice} from '../system-sessions.js';
import {runPendingBackup,buildSnapshot,unpackSnapshot,verifyStoredBackup,verifyDatabaseComponent} from '../operations-backups.js';
import {gzipSync} from 'node:zlib';
import {backupHealthMetrics} from '../system-backup-health.js';
import {scheduleBackups,pruneScheduledBackups} from '../system-backup-policies.js';
import {backupStorage} from '../operations-backup-storage.js';
import {drillEncryptedBackup,recoverySummary} from '../operations-restore.js';
import {savePrivateFile,deletePrivateFile} from '../private-files.js';
import {validateUpdateArchive} from '../update-packages.js';
import {updatePackageStorage} from '../update-storage.js';
import {PostgresRateStore} from '../rate-limit.js';
if(config.NODE_ENV!=='test'||!new URL(config.DATABASE_URL).pathname.endsWith('/vernatun_test'))throw Error('Isolated database required');
const seeded=JSON.parse(await readFile('.local/test/demo-accounts.json','utf8'));
function zipCrc(bytes:Buffer){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function makeZip(entries:{name:string;bytes:Buffer;mode?:number}[]){
 const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const entry of entries){
  const name=Buffer.from(entry.name),checksum=zipCrc(entry.bytes),localHeader=Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50,0);localHeader.writeUInt16LE(20,4);localHeader.writeUInt16LE(0,6);localHeader.writeUInt16LE(0,8);
  localHeader.writeUInt32LE(checksum,14);localHeader.writeUInt32LE(entry.bytes.length,18);localHeader.writeUInt32LE(entry.bytes.length,22);
  localHeader.writeUInt16LE(name.length,26);localHeader.writeUInt16LE(0,28);
  local.push(localHeader,name,entry.bytes);
  const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50,0);record.writeUInt16LE(0x0314,4);record.writeUInt16LE(20,6);
  record.writeUInt16LE(0,8);record.writeUInt16LE(0,10);record.writeUInt32LE(checksum,16);
  record.writeUInt32LE(entry.bytes.length,20);record.writeUInt32LE(entry.bytes.length,24);
  record.writeUInt16LE(name.length,28);record.writeUInt16LE(0,30);record.writeUInt16LE(0,32);record.writeUInt16LE(0,34);
  record.writeUInt32LE(((entry.mode??0o100644)<<16)>>>0,38);record.writeUInt32LE(offset,42);
  central.push(record,name);offset+=localHeader.length+name.length+entry.bytes.length;
 }
 const directory=Buffer.concat(central),eocd=Buffer.alloc(22);eocd.writeUInt32LE(0x06054b50,0);eocd.writeUInt16LE(entries.length,8);
 eocd.writeUInt16LE(entries.length,10);eocd.writeUInt32LE(directory.length,12);eocd.writeUInt32LE(offset,16);
 return Buffer.concat([...local,directory,eocd]);
}
function updateZip(payloadPaths=['artifacts/api-server/dist/index.mjs','artifacts/vernatun/dist/index.html']){
 const files=payloadPaths.map((path,i)=>({path,bytes:Buffer.from(i?'<!doctype html><title>Vernatun</title>':'export default 1;')}));
 const declared=files.map(f=>({path:f.path,sha256:createHash('sha256').update(f.bytes).digest('hex'),sizeBytes:f.bytes.length}));
 const checksum=createHash('sha256').update([...declared].sort((a,b)=>a.path.localeCompare(b.path)).map(f=>`${f.path}\0${f.sha256}\n`).join('')).digest('hex');
 const manifest={packageFormatVersion:1,product:'vernatun',version:'1.0.1',fromVersions:['1.0.0'],createdAt:new Date().toISOString(),
  checksum,databaseMigrationRequired:false,restartRequired:true,minimumNodeVersion:'0.0.0',files:declared,releaseNotes:'Isolated QA package'};
 return makeZip([...files.map(f=>({name:f.path,bytes:f.bytes})),{name:'vernatun-update.json',bytes:Buffer.from(JSON.stringify(manifest))}]);
}
const server=app.listen(0,'127.0.0.1');let base='',admin:Client,support:Client,org:Client;
test('database diagnostics expose only safe missing-object identifiers',()=>{
 const pgError=(code:string,message:string)=>Object.assign(new Error(message),{code});
 assert.deepEqual(safeDatabaseFailure(pgError('42P01','relation "system_revoked_sessions" does not exist')),
  {databaseCode:'42P01',missingObject:'relation system_revoked_sessions'});
 assert.deepEqual(safeDatabaseFailure(pgError('42883','function expire_support_grants(unknown) does not exist')),
  {databaseCode:'42883',missingObject:'function expire_support_grants'});
 assert.deepEqual(safeDatabaseFailure(pgError('42P01','password=not-for-logs')),
  {databaseCode:'42P01'});
 assert.equal(safeDatabaseFailure(new Error('unrelated')),null);
});
test('Coolify preflight can recognize the canonical session primary key',async()=>{
 const tables=await pool.query<{table_name:string}>(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema=current_schema() AND table_type='BASE TABLE'
   AND table_name<>'schema_migrations' AND table_name !~ '^pg_' ORDER BY table_name`);
 assert.ok(tables.rows.some(row=>row.table_name==='session'));
 const result=await pool.query<{present:boolean}>(`
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
  ) AS present`);
 assert.equal(result.rows[0].present,true);
});
class Client{
 cookie='';csrf='';assignment='';user='';
 async call(path:string,method='GET',body?:unknown){
  const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:this.cookie,'X-CSRF-Token':this.csrf},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  const data=await r.json();if(data?.csrf)this.csrf=data.csrf;return {status:r.status,data,id:r.headers.get('X-Request-ID')};
 }
  async upload(path:string,bytes:Buffer,fileName:string,confirmation='UPDATE PACKAGE'){
   const r=await fetch(base+'/api'+path,{method:'POST',headers:{'Content-Type':'application/zip',Cookie:this.cookie,'X-CSRF-Token':this.csrf,
    'X-Update-Filename':fileName,'X-Confirmation':confirmation},body:bytes});
   if(r.headers.getSetCookie().length)this.cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
   return {status:r.status,data:await r.json()};
  }
 async login(role:string){
  const a=Object.values(seeded.accounts).find((x:any)=>x.role===role) as any;
  await this.call('/auth/session');const r=await this.call('/auth/login','POST',{email:a.email,password:a.password});assert.equal(r.status,200);
  this.assignment=r.data.contexts.find((c:any)=>c.role_key===role).id;this.user=r.data.user.id;
  assert.equal((await this.call('/auth/context','POST',{id:this.assignment})).status,200);return this;
 }
}
before(async()=>{
 await pool.query('DELETE FROM auth_rate_limits');
 await new Promise<void>(r=>server.listening?r():server.on('listening',r));base='http://127.0.0.1:'+(server.address() as any).port;
 admin=await new Client().login('platform_admin');support=await new Client().login('support');org=await new Client().login('org_admin');
});
after(async()=>{server.close();server.closeAllConnections();await new Promise(r=>setTimeout(r,100));await pool.end();
 const scope=process.env.PRIVATE_FILES_TEST_RUN;if(scope&&/^qa_[a-f0-9]{20}$/.test(scope))await rm('.local/operations-backups/'+scope,{recursive:true,force:true});
 if(scope&&/^qa_[a-f0-9]{20}$/.test(scope))await rm('.local/operations-updates/'+scope,{recursive:true,force:true});
});
test('platform-only granular rights; tenants, support and anonymous denied',async()=>{
   for(const route of ['/system/overview','/system/health','/system/logs','/system/jobs','/system/errors','/system/cache','/system/environment','/system/sessions','/system/backups','/system/api/docs','/system/api','/system/integrations','/system/webhooks','/system/modules','/system/updates']){
  assert.equal((await new Client().call(route)).status,401);
  assert.equal((await support.call(route)).status,403);
  assert.equal((await org.call(route)).status,403);
  assert.equal((await admin.call(route)).status,200);
 }
 await pool.query(`INSERT INTO iam_assignment_rules(assignment_id,permission_key,effect,reason,created_by) VALUES($1,'logs.read','deny','QA granular denial',$2)`,[admin.assignment,admin.user]);
 assert.equal((await admin.call('/system/logs')).status,403);
 assert.equal((await admin.call('/system/overview')).status,200);
 await pool.query("DELETE FROM iam_assignment_rules WHERE assignment_id=$1 AND permission_key='logs.read'",[admin.assignment]);
});
test('module registry reports bundled modules, real permission coverage, plan inclusion, and no executable extensions',async()=>{
 const r=await admin.call('/system/modules');assert.equal(r.status,200);
 assert.equal(r.data.modules.length,8);assert.ok(r.data.modules.every((m:any)=>m.type==='core'&&m.status==='installed'&&Array.isArray(m.capabilities)));
 assert.deepEqual(r.data.extensions,[]);assert.equal(r.data.extensionPolicy.arbitraryPackagesAllowed,false);
 assert.equal(r.data.extensionPolicy.installationSupported,false);
 assert.ok(r.data.modules.some((m:any)=>m.moduleId==='requests'&&m.capabilities.includes('requests.read')));
});
test('update package validation rejects unsafe paths and executable archive members',()=>{
 const traversal=validateUpdateArchive(updateZip(['../escape']),'1.0.0');
 assert.equal(traversal.valid,false);assert.ok(traversal.issues.includes('unsafe_archive_path'));
 const executable=validateUpdateArchive(makeZip([{name:'run.sh',bytes:Buffer.from('echo unsafe'),mode:0o100755}]),'1.0.0');
 assert.equal(executable.valid,false);assert.ok(executable.issues.includes('unexpected_executable'));
 const result=validateUpdateArchive(updateZip(),'1.0.0');
 assert.equal(result.valid,true);assert.equal(result.compatible,true);assert.equal(result.manifest?.version,'1.0.1');
});
test('update packages are private, validated, permission-gated, staged only with verified backup, and never installed by runtime',async()=>{
 const previous=process.env.VERNATUN_APP_VERSION;process.env.VERNATUN_APP_VERSION='1.0.0';let id:string|undefined;
 try{
  const denied=await support.call('/system/updates');assert.equal(denied.status,403);
  const password=(Object.values(seeded.accounts) as any[]).find(x=>x.role==='platform_admin').password;
  assert.equal((await admin.call('/auth/reauthenticate','POST',{password})).status,200);
  const uploaded=await admin.upload('/system/updates/upload',updateZip(),'vernatun-1.0.1.zip');
  assert.equal(uploaded.status,201);id=uploaded.data.id;assert.equal(uploaded.data.status,'validated');
  assert.equal(uploaded.data.validation.compatible,true);
  const detail=await admin.call(`/system/updates/${id}`);
  assert.equal(detail.status,200);assert.equal(detail.data.version,'1.0.1');assert.equal('bytes' in detail.data,false);
  const checked=await admin.call(`/system/updates/${id}/validate`,'POST',{});
  assert.equal(checked.status,200);assert.equal(checked.data.status,'validated');
  const stage=await admin.call(`/system/updates/${id}/stage`,'POST',{backupId:randomUUID(),confirmation:'STAGE UPDATE'});
  assert.equal(stage.status,409);assert.equal(stage.data.error,'verified_database_backup_required');
  const install=await admin.call(`/system/updates/${id}/install`,'POST',{confirmation:'INSTALL UPDATE'});
  assert.equal(install.status,409);assert.equal(install.data.status,'manual_deployment_required');
  assert.equal((await admin.call(`/system/updates/${id}`)).data.status,'validated');
 }finally{
  if(previous===undefined)delete process.env.VERNATUN_APP_VERSION;else process.env.VERNATUN_APP_VERSION=previous;
  if(id){await updatePackageStorage().remove(id).catch(()=>{});await pool.query('DELETE FROM platform_updates WHERE id=$1',[id])}
 }
});
test('API documentation and credentials are permission-gated, hashed, one-time, and organization-scoped',async()=>{
 const docs=await admin.call('/system/api/docs');
 assert.equal(docs.status,200);assert.ok(docs.data.openapi);assert.ok(docs.data.info?.title);
 assert.ok(Object.keys(docs.data.paths??{}).length>0);
 assert.ok(Object.values(docs.data.paths).some((path:any)=>Object.values(path).some((op:any)=>op.operationId)));
 const forbidden=await pool.query('SELECT id FROM organizations ORDER BY id LIMIT 1');
 const orgId=forbidden.rows[0].id;
 const password=(Object.values(seeded.accounts) as any[]).find(x=>x.role==='platform_admin').password;
 assert.equal((await admin.call('/auth/reauthenticate','POST',{password})).status,200);
 const created=await admin.call('/system/api/clients','POST',{
  name:'System API QA',description:'isolated authorization test',organizationId:orgId,
  clientType:'organization',allowedScopes:['properties.read'],allowedIps:[],confirmation:'API CLIENT',
 });
 assert.equal(created.status,201);
 const key=await admin.call(`/system/api/clients/${created.data.id}/keys`,'POST',{
  name:'QA key',scopes:['properties.read'],expiresAt:new Date(Date.now()+86400000).toISOString(),
  requestsPerMinute:30,confirmation:'API KEY',
 });
 assert.equal(key.status,201);assert.match(key.data.secret,/^vnt_/);
 const digest=createHash('sha256').update(key.data.secret).digest('hex');
 const stored=(await pool.query('SELECT key_hash FROM api_keys WHERE id=$1',[key.data.id])).rows[0].key_hash;
 assert.equal(stored,digest);
 const listed=await admin.call('/system/api');
 assert.equal(listed.status,200);assert.ok(!JSON.stringify(listed.data).includes(key.data.secret));
 assert.ok(!JSON.stringify(listed.data).includes(digest));
 const external=await fetch(base+'/api/v1/properties',{headers:{Authorization:'Bearer '+key.data.secret}});
 assert.equal(external.status,200,await external.clone().text());
 assert.ok(!JSON.stringify(await external.json()).includes(password));
 assert.equal((await admin.call(`/system/api/keys/${key.data.id}/revoke`,'POST',{confirmation:'API KEY'})).status,200);
 assert.equal((await fetch(base+'/api/v1/properties',{headers:{Authorization:'Bearer '+key.data.secret}})).status,401);
});
test('integration credentials stay encrypted and activation requires a fresh successful test',async()=>{
 const password=(Object.values(seeded.accounts) as any[]).find(x=>x.role==='platform_admin').password;
 assert.equal((await admin.call('/auth/reauthenticate','POST',{password})).status,200);
 const organizationId=(await pool.query('SELECT id FROM organizations ORDER BY id LIMIT 1')).rows[0].id;
 const created=await admin.call('/system/integrations','POST',{
  provider:'smtp',organizationId,displayName:'QA SMTP',environment:'sandbox',
  config:{host:'127.0.0.1',port:587},credentials:{username:'qa-user',password:'QA_ONLY_SECRET'},
  confirmation:'INTEGRATION',
 });
 assert.equal(created.status,201);
 const instanceId=created.data.id;
 const catalog=await admin.call('/system/integrations');
 assert.equal(catalog.status,200);
 assert.equal(catalog.data.providers.find((p:any)=>p.id==='smtp').adapterInstalled,true);
 assert.ok(catalog.data.providers.filter((p:any)=>p.id!=='smtp').every((p:any)=>!p.adapterInstalled));
 assert.ok(!JSON.stringify(catalog.data).includes('QA_ONLY_SECRET'));
 assert.ok(!JSON.stringify(catalog.data).includes('encrypted_credentials'));
 const encrypted=(await pool.query('SELECT encrypted_credentials FROM integration_instances WHERE id=$1',[instanceId])).rows[0].encrypted_credentials;
 assert.ok(encrypted && JSON.stringify(encrypted).includes('ciphertext'));
 assert.ok(!JSON.stringify(encrypted).includes('QA_ONLY_SECRET'));
 assert.equal((await admin.call(`/system/integrations/${instanceId}/activate`,'POST',{revision:1,confirmation:'INTEGRATION'})).status,409);
 const testResult=await admin.call(`/system/integrations/${instanceId}/test`,'POST',{revision:1,confirmation:'INTEGRATION'});
 assert.equal(testResult.status,200);
 assert.notEqual(testResult.data.status,'connected','private loopback addresses must not be probed');
 assert.equal((await admin.call(`/system/integrations/${instanceId}/activate`,'POST',{revision:1,confirmation:'INTEGRATION'})).status,409);
 assert.equal((await admin.call(`/system/integrations/${instanceId}`,'PUT',{
  displayName:'QA SMTP updated',config:{host:'mail.invalid',port:587},revision:1,confirmation:'INTEGRATION',
 })).status,200);
 const updated=await admin.call('/system/integrations');
 const row=updated.data.instances.find((i:any)=>i.id===instanceId);
 assert.equal(row.revision,2);assert.equal(row.enabled,false);assert.equal(row.status,'not_configured');
 assert.equal((await admin.call(`/system/integrations/${instanceId}/delete`,'POST',{revision:2,confirmation:'INTEGRATION'})).status,200);
 assert.ok(!(await admin.call('/system/integrations')).data.instances.some((i:any)=>i.id===instanceId));
});
test('outgoing webhook secret is one-time, URLs are constrained, and delivery actions are auditable',async()=>{
 const password=(Object.values(seeded.accounts) as any[]).find(x=>x.role==='platform_admin').password;
 assert.equal((await admin.call('/auth/reauthenticate','POST',{password})).status,200);
 const organizationId=(await pool.query('SELECT id FROM organizations ORDER BY id LIMIT 1')).rows[0].id;
 const unsafe=await admin.call('/system/webhooks','POST',{
  name:'Unsafe webhook',organizationId,endpoint:'http://127.0.0.1/admin',events:['request.created'],confirmation:'WEBHOOK',
 });
 assert.equal(unsafe.status,400);
 const created=await admin.call('/system/webhooks','POST',{
  name:'QA delivery',organizationId,endpoint:'https://qa.invalid/webhook',events:['request.created'],confirmation:'WEBHOOK',
 });
 assert.equal(created.status,201);assert.ok(created.data.secret);const secret=created.data.secret;
 assert.equal((await admin.call(`/system/webhooks/${created.data.id}/state`,'POST',{enabled:true,confirmation:'WEBHOOK'})).status,200);
 await pool.query(`INSERT INTO audit_events(organization_id,actor_user_id,action,entity_type,entity_id,details)
  VALUES($1,$2,'request.create','resident_request',$3,'{}'::jsonb)`,[organizationId,admin.user,randomUUID()]);
 const center=await admin.call('/system/webhooks');
 assert.equal(center.status,200);assert.ok(center.data.events.includes('request.created'));
 assert.ok(center.data.deliveries.some((d:any)=>d.eventName==='request.created'&&d.status==='pending'));
 assert.ok(!JSON.stringify(center.data).includes(secret));
 const delivery=center.data.deliveries.find((d:any)=>d.eventName==='request.created');
 await pool.query("UPDATE outgoing_webhook_deliveries SET status='dead_letter' WHERE id=$1",[delivery.id]);
 assert.equal((await admin.call(`/system/webhooks/deliveries/${delivery.id}/retry`,'POST',{confirmation:'WEBHOOK'})).status,200);
 assert.equal((await admin.call(`/system/webhooks/deliveries/${delivery.id}/cancel`,'POST',{confirmation:'WEBHOOK'})).status,200);
 const final=await admin.call('/system/webhooks');
 assert.equal(final.data.deliveries.find((d:any)=>d.id===delivery.id).status,'cancelled');
 assert.equal((await admin.call(`/system/webhooks/${created.data.id}/state`,'POST',{enabled:false,confirmation:'WEBHOOK'})).status,200);
 assert.ok((await pool.query("SELECT 1 FROM audit_events WHERE action='system.webhook.created' AND entity_id=$1",[created.data.id])).rowCount);
});
test('actual cache administration never revokes sessions and environment is allowlisted',async()=>{
 const env=await admin.call('/system/environment');assert.equal(env.status,200);
 const keys=env.data.metrics.map((x:any)=>x.key);
 assert.deepEqual(keys,['environment','node','database_engine','storage_provider','email_configuration','cache_provider','redis_configuration','session_secret','email_webhook_secret','operations_encryption']);
 assert.ok(!JSON.stringify(env.data).includes(config.SESSION_SECRET));
 const m=new MemoryCacheProvider();
 await m.set('a','key',{x:1},60);await m.set('b','key',{x:2},60);
 assert.deepEqual(await m.get('a','key'),{x:1});assert.equal(await m.clear('a'),1);
 assert.equal(await m.get('a','key'),undefined);assert.deepEqual(await m.get('b','key'),{x:2});
 await m.set('a','expired',1,-1);assert.equal(m.count('a'),0);
 const raw=new Map<string,string>();
 const redis=new RedisCacheProvider({get:async k=>raw.get(k)??null,set:async(k,v)=>raw.set(k,v),
  deletePrefix:async prefix=>{let n=0;for(const k of raw.keys())if(k.startsWith(prefix)){raw.delete(k);n++}return n}});
 await redis.set('health','a',1,60);await redis.set('other','a',2,60);
 assert.equal(await redis.clear('health'),1);assert.equal(await redis.get('other','a'),2);
 await clearHealthCache();let probes=0;
 const load=async()=>{probes++;return {status:'down' as const,value:'probe_failed'}};
 await Promise.all([cachedStorageHealth(load),cachedStorageHealth(load)]);
 assert.equal(probes,1);await cachedStorageHealth(load);assert.equal(probes,1);
 const before=await pool.query('SELECT count(*)::int AS n FROM session');
 assert.equal((await admin.call('/system/cache/clear','POST',{namespace:'all',confirmation:'wrong'})).status,400);
 const clear=await admin.call('/system/cache/clear','POST',{namespace:'all',confirmation:'CLEAR CACHE'});
 assert.equal(clear.status,200);assert.equal(clear.data.scope,'process');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM session')).rows[0].n,before.rows[0].n);
 assert.equal((await support.call('/system/cache/clear','POST',{namespace:'all',confirmation:'CLEAR CACHE'})).status,403);
 const audit=await pool.query("SELECT 1 FROM audit_events WHERE action='system.cache.clear.completed'");
 assert.ok(audit.rowCount);
});
test('session administration uses irreversible public references and resists late session resurrection',async()=>{
 const before=(await admin.call('/system/sessions?userId='+support.user)).data.items.map((s:any)=>s.ref);
 const victim=await new Client().login('support');
 const sessions=await admin.call('/system/sessions?userId='+victim.user);
 assert.equal(sessions.status,200);
 const target=sessions.data.items.find((s:any)=>!before.includes(s.ref));assert.ok(target);
 assert.match(target.ref,/^[a-f0-9]{64}$/);assert.ok(target.createdAt);assert.ok(target.lastActivityAt);
 assert.equal(target.device,'Unknown browser / Unknown device');assert.equal(target.current,false);
 assert.equal(sessionDevice('PRIVATE_TOKEN Mozilla Windows Chrome/1.2'), 'Chrome / Windows');
 const original=(await pool.query("SELECT * FROM session WHERE encode(sha256(convert_to(sid,'UTF8')),'hex')=$1",[target.ref])).rows[0];
 assert.ok(!JSON.stringify(sessions.data).includes(original.sid));
 assert.equal((await support.call('/system/sessions/revoke','POST',{sessionRef:target.ref,confirmation:'REVOKE'})).status,403);
 assert.equal((await admin.call('/system/sessions/revoke','POST',{sessionRef:target.ref,userId:victim.user,confirmation:'REVOKE'})).status,400);
 const result=await admin.call('/system/sessions/revoke','POST',{sessionRef:target.ref,confirmation:'REVOKE'});
 assert.equal(result.status,200);assert.equal(result.data.count,1);assert.equal(result.data.currentRevoked,false);
 // Simulate a request that loaded the session before revoke and saves afterward.
 await pool.query('INSERT INTO session(sid,sess,expire) VALUES($1,$2,$3)',[original.sid,original.sess,original.expire]);
 assert.equal((await victim.call('/system/overview')).status,401);
 assert.ok(!(await admin.call('/system/sessions?userId='+victim.user)).data.items.some((s:any)=>s.ref===target.ref));
 const fresh=await new Client().login('support');
 const all=await admin.call('/system/sessions/revoke','POST',{userId:fresh.user,confirmation:'REVOKE'});
 assert.equal(all.status,200);assert.ok(all.data.count>=1);
 assert.equal((await fresh.call('/system/overview')).status,401);
 // Restore the shared denial-test client with a fresh authenticated session.
 support=await new Client().login('support');
});
test('operations encryption authenticates ciphertext and binds it to a purpose and record',()=>{
 const cipher=new OperationsCipher(randomBytes(32));
 const bytes=Buffer.from('TEST_ONLY_SECRET');
 const a=cipher.seal(bytes,'backup:123'),b=cipher.seal(bytes,'backup:123');
 assert.notEqual(a.nonce,b.nonce);assert.notEqual(a.ciphertext,b.ciphertext);
 assert.ok(!JSON.stringify(a).includes('TEST_ONLY_SECRET'));
 assert.deepEqual(cipher.open(a,'backup:123'),bytes);
 assert.throws(()=>cipher.open(a,'backup:124'));
 assert.throws(()=>cipher.open(a,'integration:123'));
 assert.throws(()=>new OperationsCipher(randomBytes(32)).open(a,'backup:123'));
 assert.throws(()=>cipher.open({...a,tag:'0'.repeat(32)},'backup:123'));
 assert.throws(()=>cipher.open({...a,ciphertext:'not-base64'},'backup:123'));
 assert.throws(()=>cipher.open({...a,extra:'secret'},'backup:123'));
});
test('encrypted backup queue creates and verifies a real snapshot, protects retention and rejects corruption',async()=>{
 const overview=await admin.call('/system/backups');
 assert.equal(overview.data.provider,'local');assert.equal(overview.data.encryption,'configured');
 assert.equal((await support.call('/system/backups','POST',{kind:'configuration',confirmation:'BACKUP'})).status,403);
 assert.equal((await admin.call('/system/backups','POST',{kind:'configuration',confirmation:'wrong'})).status,400);
 const created=await admin.call('/system/backups','POST',{kind:'configuration',confirmation:'BACKUP',notes:'QA configuration'});
 assert.equal(created.status,202);const id=created.data.id;
 assert.equal((await admin.call('/system/backups','POST',{kind:'configuration',confirmation:'BACKUP'})).status,409);
 assert.equal(await runPendingBackup(),1);
 const row=(await pool.query('SELECT * FROM operations_backups WHERE id=$1',[id])).rows[0];
 assert.equal(row.status,'completed');assert.equal(row.verification,'verified');
  const health=await backupHealthMetrics();
  assert.equal(health.find(m=>m.key==='last_backup')?.value,new Date(row.finished_at).toISOString());
  assert.equal(health.find(m=>m.key==='backup_type')?.value,'configuration');
  assert.equal(health.find(m=>m.key==='backup_bytes')?.value,String(row.bytes));
  assert.equal(health.find(m=>m.key==='backup_storage')?.status,'unavailable','configuration alone is not a storage probe');
 const manifest=await verifyStoredBackup(id,row.checksum,row.provider);
 assert.equal(manifest.kind,'configuration');assert.ok(manifest.components.find(c=>c.name==='configuration.json'));
 const raw=await backupStorage().read(id);
 assert.ok(!raw.toString().includes('QA configuration'));assert.ok(!raw.toString().includes('subscription_plans'));
 const downloaded=await fetch(base+'/api/system/backups/'+id+'/download',{headers:{Cookie:admin.cookie}});
 assert.equal(downloaded.status,200);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),raw);
 assert.equal((await admin.call('/system/backups/'+id,'DELETE',{confirmation:'DELETE BACKUP'})).status,409);
 assert.equal((await admin.call('/system/backups/'+id+'/verify','POST',{})).status,200);
 await backupStorage().remove(id);await backupStorage().write(id,Buffer.from('damaged QA package'));
 assert.equal((await admin.call('/system/backups/'+id+'/verify','POST',{})).status,409);
 assert.equal((await pool.query('SELECT verification FROM operations_backups WHERE id=$1',[id])).rows[0].verification,'verification_failed');
  assert.equal((await backupHealthMetrics()).find(m=>m.key==='last_backup')?.value,null);
 assert.ok((await pool.query("SELECT 1 FROM audit_events WHERE action='system.backup.completed' AND entity_id=$1",[id])).rowCount);
});
test('database snapshot contains a custom-format dump and missing files never produce a completed backup',async()=>{
 const id='00000000-0000-4000-8000-000000000701';
 const built=await buildSnapshot(id,'database');
 const manifest=unpackSnapshot(built.bytes,id),dump=manifest.components.find(c=>c.name==='database.dump');
 assert.ok(dump);assert.equal(Buffer.from(dump.content,'base64').subarray(0,5).toString(),'PGDMP');
  await verifyDatabaseComponent(manifest);
  await assert.rejects(()=>verifyDatabaseComponent({...manifest,components:[{...dump,content:Buffer.from('PGDMP not an actual archive').toString('base64')}]}));
 assert.throws(()=>unpackSnapshot(built.bytes,'00000000-0000-4000-8000-000000000702'));
 const queued=await admin.call('/system/backups','POST',{kind:'files',confirmation:'BACKUP'});
 assert.equal(queued.status,202);
 // A referenced historical logo with missing bytes must fail, never get silently omitted.
 const orgId=(await pool.query('SELECT id FROM organizations LIMIT 1')).rows[0].id;
 const old=(await pool.query('SELECT web_branding FROM organizations WHERE id=$1',[orgId])).rows[0].web_branding;
 await pool.query("UPDATE organizations SET web_branding=web_branding||jsonb_build_object('logo_key','00000000-0000-4000-8000-000000000703.jpg') WHERE id=$1",[orgId]);
 await assert.rejects(()=>runPendingBackup(),/Backup job failed/);
 assert.equal((await pool.query('SELECT status FROM operations_backups WHERE id=$1',[queued.data.id])).rows[0].status,'failed');
 await pool.query('UPDATE organizations SET web_branding=$2 WHERE id=$1',[orgId,old]);
});
test('backup policies are opt-in, revision guarded, serialize scheduling and retain manual and newest copies',async()=>{
 const list=await admin.call('/system/backup-policies');assert.equal(list.status,200);
 assert.equal(list.data.length,5);assert.ok(list.data.every((p:any)=>!p.enabled&&!p.autoDelete));
 const body={enabled:true,frequency:'daily',provider:'local',retentionDays:30,keepLast:1,autoDelete:false,revision:1,confirmation:'BACKUP POLICY'};
 assert.equal((await support.call('/system/backup-policies/configuration','PUT',body)).status,403);
 assert.equal((await admin.call('/system/backup-policies/configuration','PUT',{...body,retentionDays:29})).status,400);
 const saved=await admin.call('/system/backup-policies/configuration','PUT',body);assert.equal(saved.status,200);
 assert.ok(Date.parse(saved.data.nextRunAt)>Date.now()+23*3600000);
 assert.equal((await admin.call('/system/backup-policies/configuration','PUT',body)).status,409);
 assert.equal(await scheduleBackups(),0);
 await pool.query("UPDATE operations_backup_policies SET next_run_at=now()-interval '3 days' WHERE kind='configuration'");
 const parallel=await Promise.all([scheduleBackups(),scheduleBackups()]);assert.equal(parallel[0]+parallel[1],1);
 assert.equal(await scheduleBackups(),0);assert.equal(await runPendingBackup(),1);
 const original=(await pool.query("SELECT id FROM operations_backups WHERE policy_kind='configuration'")).rows[0].id;
 await pool.query("UPDATE operations_backups SET created_at=now()-interval '40 days',retain_until=now()-interval '1 day' WHERE id=$1",[original]);
 assert.equal(await pruneScheduledBackups(),0,'cleanup disabled');
 const enabled=await admin.call('/system/backup-policies/configuration','PUT',{...body,autoDelete:true,revision:saved.data.revision});assert.equal(enabled.status,200);
 assert.equal(await pruneScheduledBackups(),0,'keep last verified copy');
 await pool.query("UPDATE operations_backup_policies SET next_run_at=now()-interval '1 day' WHERE kind='configuration'");
 assert.equal(await scheduleBackups(),1);assert.equal(await runPendingBackup(),1);
 await pool.query("UPDATE operations_backups SET retain_until=now()+interval '1 day' WHERE id=$1",[original]);
 assert.equal(await pruneScheduledBackups(),0,'original hold');
 await pool.query("UPDATE operations_backups SET retain_until=now()-interval '1 day' WHERE id=$1",[original]);
 assert.equal(await pruneScheduledBackups(),1);
 assert.equal((await pool.query('SELECT status FROM operations_backups WHERE id=$1',[original])).rows[0].status,'expired');
 assert.ok((await pool.query("SELECT 1 FROM operations_backups WHERE policy_kind IS NULL AND status='completed'")).rowCount,'manual copy retained');
 assert.ok((await pool.query("SELECT 1 FROM audit_events WHERE action='system.backup.expired' AND entity_id=$1",[original])).rowCount);
 assert.equal((await admin.call('/system/backup-policies/configuration','PUT',{...body,enabled:false,revision:enabled.data.revision})).status,200);
 await pool.query("UPDATE operations_backups SET verification='verification_failed' WHERE policy_kind IS NOT NULL");
});
test('email health distinguishes retained acceptance, delivery and unknown outcomes without sending',async()=>{
 const empty=await emailHealthMetrics();
 const get=(rows:any[],key:string)=>rows.find(x=>x.key===key);
 assert.equal(get(empty,'email_last_delivered').value,null);
 const scope='system-health-qa';
 const insert=async(message:string,status='accepted',evidence=true)=>{
  await pool.query(`INSERT INTO email_messages(provider,provider_scope,delivery_evidence,business_type,recipient,
   provider_message_id,transport_status,accepted_at)
   VALUES('qa',$1,$2,'other','PRIVATE_RECIPIENT@example.invalid',$3,$4,CASE WHEN $4='accepted' THEN now() ELSE NULL END)`,
  [scope,evidence,message,status]);
 };
 await insert('accepted');await insert('unknown','unknown');await insert('local','local',false);
 const accepted=await emailHealthMetrics();
 assert.ok(get(accepted,'email_last_accepted').value);
 assert.equal(get(accepted,'email_last_delivered').value,null);
 const event=async(id:string,message:string,outcome:string,age='0 hours')=>{
  await pool.query(`INSERT INTO email_delivery_events(provider,provider_scope,event_id,message_id,outcome,occurred_at)
   VALUES('qa',$1,$2,$3,$4,now()-$5::interval)`,[scope,id,message,outcome,age]);
 };
 await event('sent','accepted','sent');await event('delivered','accepted','delivered');
 await event('bounce1','accepted','bounced');await event('bounce2','accepted','bounced');
 await event('failed-old','accepted','failed','25 hours');
 await event('unmatched','not-recorded','failed');await event('local','local','failed');
 await event('complaint','accepted','complained');await event('delay','accepted','delayed');
 const r=await admin.call('/system/health');assert.equal(r.status,200);
 const metrics=r.data.metrics;
 assert.ok(get(metrics,'email_last_sent').value);assert.ok(get(metrics,'email_last_delivered').value);
 assert.equal(get(metrics,'email_bounced_24h').value,'1');
 assert.equal(get(metrics,'email_failed_24h').value,'0');
 assert.equal(get(metrics,'email_complained_24h').value,'1');
 assert.equal(get(metrics,'email_delayed_24h').value,'1');
 assert.equal(get(metrics,'email_unknown_24h').status,'degraded');
 assert.equal(r.data.status,'warning');
 assert.ok(!JSON.stringify(r.data).includes('PRIVATE_RECIPIENT'));
 // Unavailable must never be rendered as zero; this mock cannot send anything.
 const original=pool.query;
 try{
  pool.query=(()=>{throw Error('PRIVATE_DATABASE_ERROR')}) as typeof pool.query;
  assert.ok((await emailHealthMetrics()).every(m=>m.value===null&&m.status==='unavailable'));
 }finally{pool.query=original}
});
test('encrypted full-data recovery pairs SQL fingerprints and private bytes in a disposable database',async()=>{
 const orgId=(await pool.query('SELECT id FROM organizations LIMIT 1')).rows[0].id;
 const old=(await pool.query('SELECT web_branding FROM organizations WHERE id=$1',[orgId])).rows[0].web_branding;
 const key='00000000-0000-4000-8000-000000000704.jpg';
 await savePrivateFile('photos',key,Buffer.from('TEST_ONLY_RECOVERY_BYTES'),'image/jpeg');
 let id:string|undefined;
 try{
  await pool.query("UPDATE organizations SET web_branding=web_branding||jsonb_build_object('logo_key',$2::text) WHERE id=$1",[orgId,key]);
  const created=await admin.call('/system/backups','POST',{kind:'full_data',confirmation:'BACKUP'});
  assert.equal(created.status,202);id=created.data.id;assert.equal(await runPendingBackup(),1);
  assert.equal((await support.call('/system/backups/'+id+'/inspect','POST',{})).status,403);
  const summary=await admin.call('/system/backups/'+id+'/inspect','POST',{});
  assert.equal(summary.status,200);assert.equal(summary.data.files,1);
  assert.equal(summary.data.isolatedDrillSupported,true);assert.equal(summary.data.migrationMatches,true);
  assert.ok(!JSON.stringify(summary.data).includes('TEST_ONLY_RECOVERY_BYTES'));
  const row=(await pool.query('SELECT checksum,provider FROM operations_backups WHERE id=$1',[id])).rows[0];
  const snapshot=await verifyStoredBackup(id!,row.checksum,row.provider);
  assert.equal(recoverySummary({...snapshot,tables:undefined},snapshot.migration).isolatedDrillSupported,false);
  assert.equal(recoverySummary(snapshot,'999_future.sql').isolatedDrillSupported,false);
  const before=(await pool.query("SELECT datname FROM pg_database WHERE datname LIKE 'vernatun_restore_%' ORDER BY datname")).rows;
  const result=await drillEncryptedBackup(id!);
  assert.equal(result.paired,true);assert.equal(result.files,1);assert.ok(result.tables>10);
  assert.deepEqual((await pool.query("SELECT datname FROM pg_database WHERE datname LIKE 'vernatun_restore_%' ORDER BY datname")).rows,before);
  assert.equal((await pool.query("SELECT web_branding->>'logo_key' AS key FROM organizations WHERE id=$1",[orgId])).rows[0].key,key);
  // Valid encrypted package with deliberately wrong expected table digest:
  // recovery must fail after SQL restore and still remove its scratch database.
  const badId=randomUUID();const bad={...snapshot,id:badId,tables:snapshot.tables!.map((t,i)=>i===0?{...t,sha256:'0'.repeat(64)}:t)};
  const encrypted=Buffer.from(JSON.stringify(operationsCipher().seal(gzipSync(Buffer.from(JSON.stringify(bad))),'backup:'+badId)));
  const store=backupStorage();await store.write(badId,encrypted);
  await pool.query(`INSERT INTO operations_backups(id,kind,status,provider,checksum,verification)
   VALUES($1,'full_data','completed',$2,$3,'verification_failed')`,[badId,store.name,createHash('sha256').update(encrypted).digest('hex')]);
  await assert.rejects(drillEncryptedBackup(badId),/Restored table mismatch/);
  assert.deepEqual((await pool.query("SELECT datname FROM pg_database WHERE datname LIKE 'vernatun_restore_%' ORDER BY datname")).rows,before);
 }finally{
  await pool.query('UPDATE organizations SET web_branding=$2 WHERE id=$1',[orgId,old]);
  await deletePrivateFile('photos',key);
  if(id)await pool.query("UPDATE operations_backups SET verification='verification_failed' WHERE id=$1",[id]);
 }
});
test('retention is opt-in, audited, bounded and preserves recurrence after pruning',async()=>{
 const p=await admin.call('/system/log-retention');assert.equal(p.data.enabled,false);
 await pool.query(`INSERT INTO system_log_events(category,level,event,created_at)
  VALUES('system','error','retention_fixture',now()-interval '60 days'),
   ('system','error','retention_fixture',now())`);
 const group=(await admin.call('/system/errors')).data.items.find((g:any)=>g.message==='retention_fixture');
 assert.ok(group);
 const body={status:'resolved',lastEventId:group.lastEventId,occurrences:group.occurrences,revision:group.revision};
 assert.equal((await admin.call('/system/errors/'+group.fingerprint,'PATCH',body)).status,200);
 assert.equal(await pruneSystemLogs(),0);
 assert.equal((await support.call('/system/log-retention','PUT',{enabled:true,days:30,revision:p.data.revision,confirmation:'RETENTION'})).status,403);
 const enabled=await admin.call('/system/log-retention','PUT',{enabled:true,days:30,revision:p.data.revision,confirmation:'RETENTION'});
 assert.equal(enabled.status,200);
 assert.equal((await admin.call('/system/log-retention','PUT',{enabled:false,days:30,revision:p.data.revision,confirmation:'RETENTION'})).status,409);
 assert.equal(await pruneSystemLogs(),1);
 const retained=(await admin.call('/system/errors/'+group.fingerprint)).data.group;
 assert.equal(retained.occurrences,1);assert.equal(retained.status,'resolved');
 await recordSystemEvent({category:'system',level:'error',event:'retention_fixture'});
 assert.equal((await admin.call('/system/errors/'+group.fingerprint)).data.group.status,'open');
 await pool.query(`INSERT INTO system_log_events(category,level,event,created_at)
  SELECT 'system','info','old',now()-interval '60 days' FROM generate_series(1,502)`);
 assert.equal(await pruneSystemLogs(),500);assert.equal(await pruneSystemLogs(),2);
 assert.ok((await pool.query("SELECT 1 FROM audit_events WHERE action='system.logs.retention'")).rowCount);
 assert.equal((await admin.call('/system/log-retention','PUT',{enabled:false,days:30,revision:enabled.data.revision,confirmation:'RETENTION'})).status,200);
});
test('error groups retain safe evidence, resolve with concurrency guards and reopen on recurrence',async()=>{
 const event={category:'system',event:'qa_error_group',level:'error',error:'QA_FAILURE',endpoint:'/qa/:id',method:'GET',status:500};
 await recordSystemEvent({...event,actor:admin.user,contextId:admin.assignment,requestId:'11111111-1111-4111-8111-111111111111'});
 await recordSystemEvent({...event,actor:org.user,contextId:org.assignment,requestId:'22222222-2222-4222-8222-222222222222'});
 const find=async()=>{const r=await admin.call('/system/errors');assert.equal(r.status,200);return r.data.items.find((g:any)=>g.message==='QA_FAILURE')};
 const group=await find();assert.ok(group);assert.equal(group.occurrences,2);assert.equal(group.status,'open');
 assert.equal(group.affectedUsers,2);assert.equal(group.affectedOrganizations,1);
 assert.equal(group.latestRequestId,'22222222-2222-4222-8222-222222222222');
 const path='/system/errors/'+group.fingerprint;
 assert.equal((await support.call(path)).status,403);assert.equal((await org.call(path)).status,403);
 assert.equal((await admin.call('/system/errors/not-a-fingerprint')).status,400);
 assert.equal((await admin.call('/system/errors/'+ '0'.repeat(32))).status,404);
 const detail=await admin.call(path);assert.equal(detail.status,200);
 assert.equal(detail.data.events.items.length,2);assert.equal(detail.data.stackTrace,null);
 assert.equal(detail.data.applicationVersion,null);assert.equal(detail.data.environment,'test');
 const body=(g:any,status='resolved')=>({status,lastEventId:g.lastEventId,occurrences:g.occurrences,revision:g.revision});
 await pool.query(`INSERT INTO iam_assignment_rules(assignment_id,permission_key,effect,reason,created_by) VALUES($1,'logs.manage','deny','QA resolution denial',$2)`,[admin.assignment,admin.user]);
 assert.equal((await admin.call(path,'PATCH',body(group))).status,403);
 assert.equal((await admin.call(path)).status,200);
 await pool.query("DELETE FROM iam_assignment_rules WHERE assignment_id=$1 AND permission_key='logs.manage'",[admin.assignment]);
 assert.equal((await support.call(path,'PATCH',body(group))).status,403);
 const resolved=await admin.call(path,'PATCH',body(group));assert.equal(resolved.status,200);assert.equal(resolved.data.status,'resolved');
 assert.equal(resolved.data.revision,1);
 assert.ok((await admin.call('/system/errors?status=resolved')).data.items.some((g:any)=>g.fingerprint===group.fingerprint));
 assert.equal((await admin.call(path,'PATCH',body(group))).status,409);
 await recordSystemEvent(event);
 const recurred=await find();assert.equal(recurred.status,'open');assert.equal(recurred.occurrences,3);
 assert.equal((await admin.call(path,'PATCH',body(resolved.data))).status,409);
 const racing=await Promise.all([admin.call(path,'PATCH',body(recurred)),admin.call(path,'PATCH',body(recurred))]);
 assert.deepEqual(racing.map(r=>r.status).sort(),[200,409]);
 const again=await find();assert.equal(again.status,'resolved');
 const reopened=await admin.call(path,'PATCH',body(again,'open'));assert.equal(reopened.status,200);assert.equal(reopened.data.status,'open');
 const audits=await pool.query("SELECT details FROM audit_events WHERE action='system.error.status' AND details->>'fingerprint'=$1",[group.fingerprint]);
 assert.equal(audits.rowCount,3);
 assert.equal((await admin.call('/system/errors?status=other')).status,400);
 // A separate route template has its own fingerprint, and many groups paginate.
 await pool.query(`INSERT INTO system_log_events(category,level,event,endpoint) SELECT 'system','fatal','qa_many','/qa/'||i FROM generate_series(1,52) i`);
 const page=await admin.call('/system/errors');assert.equal(page.data.items.length,50);assert.equal(page.data.hasMore,true);
 assert.ok((await admin.call('/system/errors?page=2')).data.items.length>0);
});
test('event diagnostics strip secrets and preserve historical unknowns',async()=>{
 const secret='PASSWORD_TOKEN_COOKIE_AUTHORIZATION_SECRET';
 const err=new Error(secret);
 err.stack=`Error: ${secret}\n    at ${secret} (/private/${secret}/app.ts:123:4)\n    at x (https://host/${secret}/app.ts:15:4)\n    at x (/private/${secret}.ts:12:1)\n    at x (/root/app.ts?token=${secret}:15:4)\n    at x (/root/app.ts:0:1)\n    at unknown (node:internal/process/task_queues:95:5)`;
 assert.equal(safeErrorStack(err),'app.ts:123:4');
 assert.equal(safeErrorStack({stack:err.stack}),null);
 const throwing=new Error();Object.defineProperty(throwing,'stack',{get(){throw Error(secret)}});
 assert.equal(safeErrorStack(throwing),null);
 const many=new Error();many.stack='Error\n'+Array(30).fill('    at x (/app/app.ts:4:2)').join('\n');
 assert.equal(safeErrorStack(many)?.split('\n').length,12);
 await recordSystemEvent({category:'application',event:'qa_diagnostics',level:'error',error:'DIAGNOSTIC_FAILURE',exception:err});
 const logs=await admin.call('/system/logs?category=application&q=qa_diagnostics');
 const row=logs.data.items[0];assert.equal(row.stackTrace,'app.ts:123:4');assert.equal(row.environment,'test');
 assert.equal(row.applicationVersion,apiBuildId);assert.equal(apiBuildId,null,'unbundled tests must not invent a build ID');
 assert.ok(!JSON.stringify(row).includes(secret));assert.ok(!JSON.stringify(row).includes('/private'));
 const list=await admin.call('/system/errors');
 const group=list.data.items.find((g:any)=>g.message==='DIAGNOSTIC_FAILURE');
 const detail=await admin.call('/system/errors/'+group.fingerprint);
 assert.equal(detail.data.stackTrace,'app.ts:123:4');assert.equal(detail.data.environment,'test');
 // Insert a legacy-shaped row: absent metadata remains unknown, not current runtime.
 await pool.query("INSERT INTO system_log_events(category,level,event,error_code) VALUES('application','error','qa_legacy','LEGACY_DIAGNOSTIC')");
 const oldGroup=(await admin.call('/system/errors')).data.items.find((g:any)=>g.message==='LEGACY_DIAGNOSTIC');
 const legacy=await admin.call('/system/errors/'+oldGroup.fingerprint);
 assert.equal(legacy.data.environment,null);assert.equal(legacy.data.applicationVersion,null);assert.equal(legacy.data.stackTrace,null);
 await observedJob('qa_diagnostic_job',async()=>{throw err}).catch(()=>{});
 const jobLogs=await admin.call('/system/logs?job=qa_diagnostic_job&level=error');
 assert.equal(jobLogs.data.items[0].stackTrace,'app.ts:123:4');
});
test('overview observations real and unavailable values explicit',async()=>{
 const r=await admin.call('/system/overview');assert.equal(r.status,200);
 assert.equal(r.data.metrics.find((x:any)=>x.key==='database').status,'healthy');
 assert.equal(r.data.metrics.find((x:any)=>x.key==='last_backup').value,null);
 assert.equal(r.data.status,'warning');assert.ok(r.id);
 assert.ok(!JSON.stringify(r.data).includes(config.SESSION_SECRET));
});
test('request logs exclude secrets, query tokens and request bodies; filters and paging',async()=>{
 const secret='DO_NOT_LOG_password_test';
 const r=await admin.call('/system/logs?token='+secret);assert.equal(r.status,400);
 await new Promise(r=>setTimeout(r,100));
 const logs=await admin.call('/system/logs?requestId='+r.id);assert.equal(logs.status,200);
 assert.ok(logs.data.items.length);assert.ok(!JSON.stringify(logs.data).includes(secret));
 assert.equal(logs.data.items[0].status,400);
 assert.equal((await admin.call('/system/logs?user=invalid')).status,400);
 assert.equal((await admin.call('/system/logs?page=0')).status,400);
 for(let i=0;i<53;i++)await recordSystemEvent({category:'system',event:'qa_pagination'});
 const page=await admin.call('/system/logs?category=system&q=qa_pagination');assert.equal(page.data.items.length,50);assert.equal(page.data.hasMore,true);
 assert.equal((await admin.call('/system/logs?category=system&q=qa_pagination&page=2')).data.items.length,3);
 assert.equal(safeCode('password='+secret),'internal_error');
});
test('job persistence records success, failure and stale heartbeats without arbitrary execution',async()=>{
 await observedJob('qa_success',async()=>{});
 await assert.rejects(observedJob('qa_failure',async()=>{throw Object.assign(Error('sensitive message'),{code:'EQA'})}));
 await pool.query("INSERT INTO system_job_runs(id,job,status,heartbeat_at) VALUES(gen_random_uuid(),'qa_interrupted','running',now()-interval '3 minutes')");
 const r=await admin.call('/system/jobs');assert.equal(r.status,200);
 assert.equal(r.data.items.find((x:any)=>x.job==='qa_success').status,'completed');
 assert.equal(r.data.items.find((x:any)=>x.job==='qa_failure').status,'failed');
 assert.equal(r.data.items.find((x:any)=>x.job==='qa_interrupted').status,'interrupted');
 assert.ok(!JSON.stringify(r.data).includes('sensitive message'));
 assert.equal((await admin.call('/system/jobs/qa_failure/retry','POST',{})).status,404);
});
test('bounded JSON/CSV exports require both permissions, preserve filters and are audited',async()=>{
 const body={format:'json',from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+1000).toISOString(),category:'system',q:'qa_pagination'};
 assert.equal((await support.call('/system/log-exports','POST',body)).status,403);
 assert.equal((await org.call('/system/log-exports','POST',body)).status,403);
 const anonymous=new Client();await anonymous.call('/auth/session');
 assert.equal((await anonymous.call('/system/log-exports','POST',body)).status,401);
 for(const permission of ['logs.export','logs.read']){
  await pool.query(`INSERT INTO iam_assignment_rules(assignment_id,permission_key,effect,reason,created_by) VALUES($1,$3,'deny','QA export denial',$2)`,[admin.assignment,admin.user,permission]);
  assert.equal((await admin.call('/system/log-exports','POST',body)).status,403);
  await pool.query('DELETE FROM iam_assignment_rules WHERE assignment_id=$1 AND permission_key=$2',[admin.assignment,permission]);
 }
 // Permission denials do not consume the separate authorized export budget.
 const json=await admin.call('/system/log-exports','POST',body);assert.equal(json.status,200);
 assert.equal(json.data.rows,53);assert.equal(JSON.parse(json.data.content).length,53);
 assert.ok(JSON.parse(json.data.content).every((row:any)=>row.category==='system'&&row.event==='qa_pagination'));
 const csv=await admin.call('/system/log-exports','POST',{...body,format:'csv'});assert.equal(csv.status,200);
 assert.ok(csv.data.content.startsWith('\uFEFF"id","createdAt"'));assert.equal(csv.data.rows,53);
 const a=await pool.query("SELECT details FROM audit_events WHERE actor_user_id=$1 AND action='system.logs.export'",[admin.user]);
 assert.equal(a.rows.length,2);assert.equal(a.rows[0].details.rows,53);
 assert.ok(!JSON.stringify(a.rows).includes('qa_pagination'));
 assert.equal(logCsvCell(' =HYPERLINK("bad")'),'"\' =HYPERLINK(""bad"")"');
 assert.equal(logCsvCell('a,b\n"c"'),'"a,b\n""c"""');
 assert.equal((await admin.call('/system/log-exports','POST',{...body,from:body.to,to:body.from})).status,400);
 assert.equal((await admin.call('/system/log-exports','POST',{...body,from:'2000-01-01T00:00:00Z'})).status,400);
  await pool.query('DELETE FROM auth_rate_limits WHERE key=$1',[new PostgresRateStore('system-read').key(admin.user)]);
 await pool.query("INSERT INTO system_log_events(category,level,event) SELECT 'system','info','qa_export_limit' FROM generate_series(1,5001)");
 assert.equal((await admin.call('/system/log-exports','POST',{...body,to:new Date(Date.now()+1000).toISOString(),q:'qa_export_limit'})).status,413);
 assert.equal((await admin.call('/system/log-exports','POST',body)).status,429);
 const after=await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE actor_user_id=$1 AND action='system.logs.export'",[admin.user]);assert.equal(after.rows[0].n,2);
});
