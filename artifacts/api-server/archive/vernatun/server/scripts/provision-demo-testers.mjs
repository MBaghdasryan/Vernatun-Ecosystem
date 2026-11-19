import bcrypt from 'bcryptjs';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { stdin, stdout } from 'node:process';

const confirmation = '--confirm-production-demo-testers';
const databaseUrl = process.env.DATABASE_URL;
const accounts = [
  { email: 'bnakich@vernatun.io', name: 'Demo Resident', role: 'unit_owner' },
  { email: 'partner@vernatun.io', name: 'Demo HAYAT Partner', role: 'contractor' },
];
const organizationName = 'Vernatun Demo Residence';

if (!process.argv.includes(confirmation)) {
  throw new Error(`Refusing to write. Pass ${confirmation} only from the Coolify production API container.`);
}
if (process.env.NODE_ENV !== 'production' || !databaseUrl) {
  throw new Error('Refusing to write: production mode and DATABASE_URL are required.');
}
if (decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\/+/, '')) !== 'vernatun') {
  throw new Error('Refusing to write: target database name must be exactly vernatun.');
}
if (!stdin.isTTY || !stdout.isTTY) {
  throw new Error('Refusing to read passwords without a private interactive terminal.');
}

async function readPassword(label) {
  stdout.write(`${label} password (12+ characters, hidden): `);
  const originalRawMode = stdin.isRaw ?? false;
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  const value = await new Promise((resolve, reject) => {
    let password = '';
    const finish = (error) => {
      stdin.off('data', onData);
      stdin.setRawMode(originalRawMode);
      stdout.write('\n');
      error ? reject(error) : resolve(password);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') return finish(new Error('Password entry cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') password = password.slice(0, -1);
        else password += character;
      }
    };
    stdin.on('data', onData);
  });
  if (Buffer.byteLength(value, 'utf8') < 12 || Buffer.byteLength(value, 'utf8') > 72) {
    throw new Error(`${label} must be between 12 and 72 UTF-8 bytes.`);
  }
  return value;
}

const passwords = [
  await readPassword(accounts[0].email),
  await readPassword(accounts[1].email),
];
if (passwords[0] === passwords[1]) {
  throw new Error('Use different passwords for the resident and HAYAT partner accounts.');
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 8000 });
let client;
try {
  client = await pool.connect();
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout='15s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('vernatun-public-demo-testers-v1'))");

  const required = [
    'users', 'organizations', 'buildings', 'units', 'memberships',
    'role_assignments', 'module_entitlements', 'ownerships',
    'resident_profiles', 'resident_building_settings', 'notification_preferences',
    'resident_requests', 'defects', 'invoices', 'announcements',
  ];
  const missing = await client.query(
    `SELECT name FROM unnest($1::text[]) AS name
     WHERE to_regclass('public.' || name) IS NULL`,
    [required],
  );
  if (missing.rowCount) {
    throw new Error(`Required migrations are missing: ${missing.rows.map(row => row.name).join(', ')}`);
  }

  const roles = await client.query(
    "SELECT key FROM roles WHERE key IN ('unit_owner','contractor')",
  );
  if (roles.rowCount !== 2) throw new Error('Resident and contractor roles are not available.');

  const collisions = await client.query(
    `SELECT email FROM users WHERE email=ANY($1::text[])
     UNION ALL
     SELECT 'organization:' || id::text FROM organizations
      WHERE lower(name)=lower($2)`,
    [accounts.map(account => account.email), organizationName],
  );
  if (collisions.rowCount) {
    throw new Error('A demo email or organization already exists. No records were changed; inspect it before proceeding.');
  }

  const organizationId = randomUUID();
  const buildingId = randomUUID();
  const unitId = randomUUID();
  const [residentHash, partnerHash] = await Promise.all(passwords.map(password => bcrypt.hash(password, 12)));
  const resident = (await client.query(
    `INSERT INTO users(email,name,password_hash,locale)
     VALUES($1,$2,$3,'hy') RETURNING id`,
    [accounts[0].email, accounts[0].name, residentHash],
  )).rows[0];
  const partner = (await client.query(
    `INSERT INTO users(email,name,password_hash,locale)
     VALUES($1,$2,$3,'hy') RETURNING id`,
    [accounts[1].email, accounts[1].name, partnerHash],
  )).rows[0];

  await client.query(
    `INSERT INTO organizations(id,name,timezone,currency,is_demo,subscription_enforced,
      company_type,default_language,status,address)
     VALUES($1,$2,'Asia/Yerevan','AMD',true,false,'management_company','hy','active',
      'Synthetic demo data only — no real residents or physical devices')`,
    [organizationId, organizationName],
  );
  await client.query(
    `INSERT INTO buildings(id,organization_id,name,address,is_demo)
     VALUES($1,$2,'DEMO · Building 01','Synthetic demo address — no physical access',true)`,
    [buildingId, organizationId],
  );
  await client.query(
    `INSERT INTO units(id,organization_id,building_id,number,area,is_demo)
     VALUES($1,$2,$3,'DEMO · 101',56.4,true)`,
    [unitId, organizationId, buildingId],
  );

  for (const userId of [resident.id, partner.id]) {
    await client.query('INSERT INTO memberships(user_id,organization_id) VALUES($1,$2)', [userId, organizationId]);
  }
  await client.query(
    `INSERT INTO role_assignments(user_id,organization_id,role_key,building_id,unit_id)
     VALUES($1,$2,'unit_owner',$3,$4),($5,$2,'contractor',$3,NULL)`,
    [resident.id, organizationId, buildingId, unitId, partner.id],
  );
  await client.query(
    `INSERT INTO ownerships(organization_id,unit_id,user_id,starts_on,share_basis_points)
     VALUES($1,$2,$3,(now() AT TIME ZONE 'Asia/Yerevan')::date,10000)`,
    [organizationId, unitId, resident.id],
  );
  await client.query(
    `INSERT INTO resident_profiles(user_id,allow_messages)
     VALUES($1,true)`,
    [resident.id],
  );
  await client.query(
    `INSERT INTO resident_building_settings(building_id,organization_id,directory,discussions,chat,marketplace,services,updated_by)
     VALUES($1,$2,true,true,true,true,true,$3)`,
    [buildingId, organizationId, resident.id],
  );
  await client.query(
    `INSERT INTO notification_preferences(user_id,email_enabled,in_app_enabled)
     VALUES($1,false,true),($2,false,true)`,
    [resident.id, partner.id],
  );

  const modules = [
    ['requests', true], ['finance', true], ['handover', true], ['access', true],
    ['community', true], ['maintenance', true], ['meters', true], ['documents', true],
    ['smart_building', false],
  ];
  for (const [module, enabled] of modules) {
    await client.query(
      `INSERT INTO module_entitlements(organization_id,module,enabled,override_state,override_reason)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (organization_id,module) DO UPDATE SET
         enabled=EXCLUDED.enabled,
         override_state=EXCLUDED.override_state,
         override_reason=EXCLUDED.override_reason,
         updated_at=now()`,
      [
        organizationId,
        module,
        enabled,
        enabled ? 'enabled' : 'disabled',
        enabled
          ? 'Public demo: synthetic records only'
          : 'Public demo: no Edge, camera, barrier, or physical-device actions',
      ],
    );
  }

  await client.query(
    `INSERT INTO resident_requests(organization_id,building_id,unit_id,author_user_id,
      subject,description,status,source,priority,is_demo)
     VALUES($1,$2,$3,$4,'DEMO · Kitchen faucet check',
      'Synthetic request for testing the resident request flow. No real service visit is scheduled.',
      'new','resident_app','normal',true)`,
    [organizationId, buildingId, unitId, resident.id],
  );
  await client.query(
    `INSERT INTO defects(organization_id,unit_id,subject,location,description,contractor_id,due_on,created_by)
     VALUES($1,$2,'DEMO · Window adjustment','Living room',
      'Synthetic partner task. This record is not connected to a real apartment or contractor.',
      $3,(now() AT TIME ZONE 'Asia/Yerevan')::date+14,$4)`,
    [organizationId, unitId, partner.id, resident.id],
  );
  await client.query(
    `INSERT INTO invoices(organization_id,unit_id,payer_user_id,period,amount_minor,currency,status,is_demo)
     VALUES($1,$2,$3,date_trunc('month',now())::date,2450000,'AMD','published',true)`,
    [organizationId, unitId, resident.id],
  );
  await client.query(
    `INSERT INTO announcements(organization_id,building_id,title,body,published,created_by)
     VALUES($1,$2,'DEMO · Water maintenance notice',
      'Synthetic announcement for testing. There is no real interruption or scheduled maintenance.',
      true,$3)`,
    [organizationId, buildingId, partner.id],
  );
  await client.query(
    `INSERT INTO audit_events(organization_id,actor_user_id,action,entity_type,entity_id,details)
     VALUES($1,NULL,'demo.test_accounts.provision','organization',$1::text,
       '{"source":"coolify","synthetic_data":true,"external_messages_sent":false}')`,
    [organizationId],
  );

  await client.query('COMMIT');
  console.log(JSON.stringify({
    status: 'created',
    organization: organizationName,
    organizationId,
    building: 'DEMO · Building 01',
    unit: 'DEMO · 101',
    accounts: [
      { email: accounts[0].email, product: 'ImTun', role: 'unit_owner' },
      { email: accounts[1].email, product: 'HAYAT', role: 'contractor' },
    ],
    enabledModules: modules.filter(([, enabled]) => enabled).map(([module]) => module),
    disabledModules: ['smart_building'],
    passwordValuesPrinted: false,
    externalMessagesSent: false,
    paymentsOrProvidersCreated: false,
    edgeOrPhysicalDevicesCreated: false,
  }, null, 2));
} catch (error) {
  if (client) await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client?.release();
  await pool.end();
}
