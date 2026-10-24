import bcrypt from 'bcryptjs';
import pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const confirmFlag = '--confirm-production-test-provision';
const databaseUrl = process.env.DATABASE_URL;
if (!process.argv.includes(confirmFlag)) {
  throw new Error(`Refusing to write: pass ${confirmFlag} only from the Coolify production API container.`);
}
if (process.env.NODE_ENV !== 'production' || !databaseUrl) {
  throw new Error('Refusing to write: NODE_ENV=production and DATABASE_URL are required.');
}
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\/+/, ''));
if (databaseName !== 'vernatun') {
  throw new Error('Refusing to write: target database name must be exactly vernatun.');
}

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(here, '../../../../../../integrations/vernatun-edge-test-lab/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const globalRoles = new Set(['platform_admin', 'support']);
const roleKeys = manifest.roles.map(({ key }) => key);
if (manifest.roles.some(({ key }) => globalRoles.has(key)) ||
    manifest.excludedGlobalRoles.some(role => !globalRoles.has(role))) {
  throw new Error('Refusing to write: the test manifest contains a global platform role.');
}
if (roleKeys.length !== 12 || new Set(roleKeys).size !== roleKeys.length) {
  throw new Error('Refusing to write: expected one unique account for each of the 12 organization-scoped roles.');
}
if (manifest.safety.physicalDevicesAndLocks !== false ||
    manifest.safety.barrierCommandMode !== 'dry-run-only' ||
    manifest.enabledModules.join(',') !== 'smart_building') {
  throw new Error('Refusing to write: unsafe test manifest settings.');
}

const credentialPath = `/tmp/vernatun-edge-test-lab-credentials-${randomUUID()}.json`;
const passwordRows = [];
let credentialsWritten = false;
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout='15s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('vernatun-edge-test-lab-v1'))");

  const requiredTables = [
    'users', 'organizations', 'buildings', 'units', 'memberships',
    'role_assignments', 'module_entitlements', 'edge_bootstrap_tokens',
  ];
  const missingTables = await client.query(
    `SELECT name FROM unnest($1::text[]) AS name WHERE to_regclass('public.' || name) IS NULL`,
    [requiredTables],
  );
  if (missingTables.rowCount) {
    throw new Error(`Required deployed schema is missing: ${missingTables.rows.map(row => row.name).join(', ')}`);
  }
  const moduleColumns = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='module_entitlements'
       AND column_name=ANY($1::text[])`,
    [['override_state', 'override_reason']],
  );
  if (moduleColumns.rowCount !== 2) {
    throw new Error('Required module override schema is missing; no test rows were written.');
  }

  const roleCheck = await client.query(
    'SELECT key FROM roles WHERE key=ANY($1::text[]) ORDER BY key',
    [roleKeys],
  );
  if (roleCheck.rowCount !== roleKeys.length) {
    throw new Error('One or more organization-scoped role keys are not deployed.');
  }

  const existingOrganization = await client.query(
    'SELECT id,name FROM organizations WHERE id=$1 OR name=$2 FOR UPDATE',
    [manifest.organization.id, manifest.organization.name],
  );
  if (existingOrganization.rowCount) {
    throw new Error('A TEST organization or reserved ID already exists. Stop and inspect it manually; this one-time script never reuses or overwrites records.');
  }
  const reservedIds = await client.query(
    `SELECT id FROM buildings WHERE id=$1
     UNION ALL SELECT id FROM units WHERE id=$2`,
    [manifest.building.id, manifest.unit.id],
  );
  if (reservedIds.rowCount) {
    throw new Error('A reserved TEST building/unit ID already exists. No records were written.');
  }

  const emails = manifest.roles.map(role =>
    role.email ?? `test.${role.key}@vernatun-edge.invalid`,
  );
  const existingUsers = await client.query('SELECT email FROM users WHERE email=ANY($1::text[])', [emails]);
  if (existingUsers.rowCount) {
    throw new Error('One or more reserved TEST emails already exist. Stop and inspect them manually; no existing account is modified.');
  }

  const { organization: org, building, unit } = manifest;
  await client.query(
    `INSERT INTO organizations(id,name,timezone,currency,is_demo)
     VALUES($1,$2,$3,$4,true)`,
    [org.id, org.name, org.timezone, org.currency],
  );
  await client.query(
    `INSERT INTO buildings(id,organization_id,name,address,is_demo)
     VALUES($1,$2,$3,$4,true)`,
    [building.id, org.id, building.name, building.address],
  );
  await client.query(
    `INSERT INTO units(id,organization_id,building_id,number,area,is_demo)
     VALUES($1,$2,$3,$4,$5,true)`,
    [unit.id, org.id, building.id, unit.number, unit.area],
  );

  const moduleStates = [
    ...manifest.enabledModules.map(module => ({ module, enabled: true, state: 'enabled' })),
    ...manifest.disabledModules.map(module => ({ module, enabled: false, state: 'disabled' })),
  ];
  for (const item of moduleStates) {
    await client.query(
      `INSERT INTO module_entitlements(organization_id,module,enabled,override_state,override_reason)
       VALUES($1,$2,$3,$4,'TEST Edge Lab: only the Edge test module is enabled')
       ON CONFLICT(organization_id,module) DO UPDATE
         SET enabled=EXCLUDED.enabled,override_state=EXCLUDED.override_state,
             override_reason=EXCLUDED.override_reason,updated_at=now()`,
      [org.id, item.module, item.enabled, item.state],
    );
  }

  const unitRoles = new Set(['unit_owner', 'renter', 'family']);
  const buildingRoles = new Set(['portfolio_owner', 'technician', 'contractor', 'security']);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  for (const role of manifest.roles) {
    const email = role.email ?? `test.${role.key}@vernatun-edge.invalid`;
    const password = `EdgeTest!9${randomBytes(24).toString('base64url')}`;
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await client.query(
      `INSERT INTO users(email,name,password_hash)
       VALUES($1,$2,$3) RETURNING id`,
      [email, role.name, passwordHash],
    );
    const userId = user.rows[0].id;
    await client.query(
      'INSERT INTO memberships(user_id,organization_id) VALUES($1,$2)',
      [userId, org.id],
    );
    await client.query(
      `INSERT INTO role_assignments(user_id,organization_id,role_key,building_id,unit_id,expires_at)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [
        userId,
        org.id,
        role.key,
        unitRoles.has(role.key) || buildingRoles.has(role.key) ? building.id : null,
        unitRoles.has(role.key) ? unit.id : null,
        expiresAt,
      ],
    );
    passwordRows.push({ email, role: role.key, password, expiresAt });
  }

  await writeFile(
    credentialPath,
    JSON.stringify({
      warning: 'Private one-time TEST credentials. Never commit or upload this file.',
      organizationId: org.id,
      accounts: passwordRows,
    }, null, 2),
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
  credentialsWritten = true;
  await client.query('COMMIT');
  console.log(JSON.stringify({
    status: 'created',
    organizationId: org.id,
    buildingId: building.id,
    unitId: unit.id,
    createdTestUsers: passwordRows.length,
    expiresAt,
    privateCredentialsFile: credentialPath,
    externalMessagesSent: false,
    invoicesOrPaymentsCreated: false,
    passesOrPhysicalDevicesCreated: false,
    edgeBootstrapTokenCreated: false,
  }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  if (credentialsWritten) await unlink(credentialPath).catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
