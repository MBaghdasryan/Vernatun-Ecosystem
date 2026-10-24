import bcrypt from 'bcryptjs';
import pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, unlink, writeFile } from 'node:fs/promises';

const CONFIRM_FLAG = '--confirm-production-global-account-provision';
const CONFIRM_ENV = 'CREATE_GLOBAL_ACCOUNTS';
const EMAIL_ARGS = ['--platform-admin-email', '--support-email'];

class ProvisionError extends Error {}

function option(name) {
  const prefix = `${name}=`;
  const match = process.argv.find(argument => argument.startsWith(prefix));
  return match?.slice(prefix.length);
}

function normalizeEmail(value) {
  const email = value?.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ProvisionError(`A valid value is required for ${EMAIL_ARGS.join(' and ')}.`);
  }
  return email;
}

async function main() {
  if (!process.argv.includes(CONFIRM_FLAG)) {
    throw new ProvisionError(
      `Usage: ${EMAIL_ARGS[0]}=<email> ${EMAIL_ARGS[1]}=<email> ${CONFIRM_FLAG}`,
    );
  }
  const adminEmail = normalizeEmail(option(EMAIL_ARGS[0]));
  const supportEmail = normalizeEmail(option(EMAIL_ARGS[1]));
  if (adminEmail === supportEmail) {
    throw new ProvisionError('The platform admin and support accounts must use different email addresses.');
  }
  if (process.env.NODE_ENV !== 'production' ||
      process.env.VERNATUN_GLOBAL_ACCOUNT_CONFIRM !== CONFIRM_ENV ||
      !process.env.DATABASE_URL) {
    throw new ProvisionError(
      `Refusing provisioning: production mode, DATABASE_URL, and VERNATUN_GLOBAL_ACCOUNT_CONFIRM=${CONFIRM_ENV} are required.`,
    );
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\/+/, ''));
  } catch {
    throw new ProvisionError('Refusing provisioning: DATABASE_URL is invalid.');
  }
  if (databaseName !== 'vernatun') {
    throw new ProvisionError('Refusing provisioning: database name must be exactly vernatun.');
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000 });
  let client;
  let transactionOpen = false;
  let transactionCommitted = false;
  let credentialsWritten = false;
  const credentialPath = `/tmp/vernatun-global-accounts-${randomUUID()}.json`;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('vernatun-global-account-provision-v1'))");

    const identity = await client.query('SELECT current_database() AS name, current_schema() AS schema');
    if (identity.rows[0]?.name !== 'vernatun' || identity.rows[0]?.schema !== 'public') {
      throw new ProvisionError('Refusing provisioning: connected database/schema identity is not Vernatun production.');
    }

    const requiredTables = ['users', 'roles', 'role_assignments', 'audit_events'];
    const tableResult = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name=ANY($1::text[])`,
      [requiredTables],
    );
    const presentTables = new Set(tableResult.rows.map(row => row.table_name));
    const missingTables = requiredTables.filter(name => !presentTables.has(name));
    if (missingTables.length) {
      throw new ProvisionError(`Required deployed schema is missing: ${missingTables.join(', ')}.`);
    }

    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    const roleResult = await client.query(
      "SELECT key FROM roles WHERE key=ANY($1::text[])",
      [['platform_admin', 'support']],
    );
    const presentRoles = new Set(roleResult.rows.map(row => row.key));
    if (!presentRoles.has('platform_admin') || !presentRoles.has('support')) {
      throw new ProvisionError('Required global roles are missing; no accounts were created.');
    }

    const existing = await client.query(
      'SELECT lower(email) AS email FROM users WHERE lower(email)=ANY($1::text[]) FOR UPDATE',
      [[adminEmail, supportEmail]],
    );
    if (existing.rowCount) {
      throw new ProvisionError(
        'At least one requested email already has an account; nothing was changed. Use the separate recovery process only if appropriate.',
      );
    }

    const accounts = [
      { role: 'platform_admin', email: adminEmail, name: 'Vernatun Platform Admin' },
      { role: 'support', email: supportEmail, name: 'Vernatun Support' },
    ];
    const credentials = [];
    for (const account of accounts) {
      const password = randomBytes(32).toString('base64url');
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await client.query(
        `INSERT INTO users(email,name,password_hash,account_status)
         VALUES($1,$2,$3,'active') RETURNING id`,
        [account.email, account.name, passwordHash],
      );
      const userId = user.rows[0]?.id;
      if (!userId) throw new ProvisionError('A user record was not returned; provisioning was stopped.');
      await client.query(
        `INSERT INTO role_assignments(user_id,organization_id,role_key,active,assignment_status)
         VALUES($1,NULL,$2,true,'active')`,
        [userId, account.role],
      );
      await client.query(
        `INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,details)
         VALUES(NULL,'auth.global_account.provision','user',$1,jsonb_build_object('method','coolify_one_time_cli','role',$2))`,
        [userId, account.role],
      );
      credentials.push({ role: account.role, email: account.email, password });
    }

    await writeFile(
      credentialPath,
      JSON.stringify({
        warning: 'Private one-time credentials. Never commit, log, or send this file in chat.',
        emailSent: false,
        accounts: credentials,
        createdAt: new Date().toISOString(),
      }, null, 2),
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    credentialsWritten = true;
    await chmod(credentialPath, 0o600);

    await client.query('COMMIT');
    transactionOpen = false;
    transactionCommitted = true;
    console.log(JSON.stringify({
      status: 'created',
      roles: accounts.map(account => account.role),
      emailsSent: false,
      passwordsPrinted: false,
      privateCredentialsFile: credentialPath,
      nextSteps: ['Retrieve the private file inside the Coolify container.', 'Sign in, change both passwords, and enroll MFA for platform_admin.'],
    }, null, 2));
  } catch (error) {
    if (transactionOpen) await client?.query('ROLLBACK').catch(() => {});
    if (credentialsWritten && !transactionCommitted) await unlink(credentialPath).catch(() => {});
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

main().catch(error => {
  if (error instanceof ProvisionError) {
    console.error(error.message);
  } else {
    console.error('Global account provisioning failed; credentials and database details were not printed.');
  }
  process.exitCode = 1;
});
