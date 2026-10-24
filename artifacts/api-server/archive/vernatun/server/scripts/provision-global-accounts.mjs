import bcrypt from 'bcryptjs';
import pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CONFIRM_FLAG = '--confirm-production-global-account-provision';
const CONFIRM_ENV = 'CREATE_GLOBAL_ACCOUNTS';
const EMAIL_ARGS = ['--platform-admin-email', '--support-email'];
const SAFE_FS_CODES = new Set(['EACCES', 'EEXIST', 'EIO', 'ENOENT', 'ENOSPC', 'EPERM', 'EROFS']);

export class ProvisionError extends Error {
  constructor() {
    super('Provisioning precondition failed');
    this.name = 'ProvisionError';
  }
}

export class ProvisionExecutionError extends Error {
  constructor(diagnostic) {
    super('Global account provisioning failed');
    this.name = 'ProvisionExecutionError';
    this.diagnostic = diagnostic;
  }
}

function safeIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
    ? value
    : undefined;
}

export function formatProvisionFailure(error, stage, rollbackSucceeded) {
  const rawCode = error && typeof error === 'object' && 'code' in error
    ? error.code
    : undefined;
  const sqlState = typeof rawCode === 'string' && /^[0-9A-Z]{5}$/.test(rawCode)
    ? rawCode
    : undefined;
  const filesystemCode = typeof rawCode === 'string' && SAFE_FS_CODES.has(rawCode)
    ? rawCode
    : undefined;
  const category = error instanceof ProvisionError
    ? 'validation'
    : sqlState
      ? 'database'
      : filesystemCode
        ? 'filesystem'
        : 'runtime';
  const errorClass = error instanceof Error && /^[A-Za-z0-9_$]+$/.test(error.name)
    ? error.name
    : 'NonError';
  const diagnostic = {
    status: 'failed',
    stage,
    category,
    errorClass,
  };
  if (sqlState || filesystemCode) diagnostic.code = sqlState ?? filesystemCode;
  for (const field of ['table', 'column', 'constraint']) {
    const value = safeIdentifier(error?.[field]);
    if (value) diagnostic[field] = value;
  }
  if (rollbackSucceeded !== null) diagnostic.rollbackSucceeded = rollbackSucceeded;
  return diagnostic;
}

export function provisioningSuccessSummary(roles, credentialPath) {
  return {
    status: 'created',
    roles,
    emailsSent: false,
    passwordsPrinted: false,
    privateCredentialsFile: credentialPath,
    nextSteps: [
      'Retrieve the private file inside the Coolify container.',
      'Sign in, change both passwords, and enroll MFA for platform_admin.',
    ],
  };
}

export function normalizeEmail(value) {
  const email = value?.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ProvisionError();
  }
  return email;
}

export async function provisionGlobalAccounts({
  client,
  accounts,
  credentialPath,
  expectedDatabase = 'vernatun',
  expectedSchema = 'public',
  onStage = () => {},
}) {
  let stage = 'transaction_beginning';
  let transactionOpen = false;
  let transactionCommitted = false;
  const setStage = (next) => {
    stage = next;
    onStage(next);
  };

  try {
    setStage('transaction_beginning');
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout='15s'");

    setStage('advisory_lock');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('vernatun-global-account-provision-v1'))");

    setStage('schema_validation');
    const identity = await client.query(
      'SELECT current_database() AS name, current_schema() AS schema',
    );
    if (identity.rows[0]?.name !== expectedDatabase || identity.rows[0]?.schema !== expectedSchema) {
      throw new ProvisionError();
    }
    const requiredTables = ['users', 'roles', 'role_assignments', 'audit_events'];
    const tableResult = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema=$2 AND table_name=ANY($1::text[])`,
      [requiredTables, expectedSchema],
    );
    const presentTables = new Set(tableResult.rows.map(row => row.table_name));
    if (requiredTables.some(name => !presentTables.has(name))) {
      throw new ProvisionError();
    }

    setStage('table_locking');
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');

    setStage('role_validation');
    const roleResult = await client.query(
      'SELECT key FROM roles WHERE key=ANY($1::text[])',
      [accounts.map(account => account.role)],
    );
    const presentRoles = new Set(roleResult.rows.map(row => row.key));
    if (accounts.some(account => !presentRoles.has(account.role))) {
      throw new ProvisionError();
    }

    setStage('existing_account_validation');
    const emails = accounts.map(account => account.email);
    const existing = await client.query(
      'SELECT lower(email) AS email FROM users WHERE lower(email)=ANY($1::text[]) FOR UPDATE',
      [emails],
    );
    if (existing.rowCount) throw new ProvisionError();

    const credentials = [];
    for (const account of accounts) {
      setStage('user_insertion');
      const password = randomBytes(32).toString('base64url');
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await client.query(
        `INSERT INTO users(email,name,password_hash,account_status)
         VALUES($1,$2,$3,'active') RETURNING id`,
        [account.email, account.name, passwordHash],
      );
      const userId = user.rows[0]?.id;
      if (!userId) throw new ProvisionError();

      setStage('role_assignment_insertion');
      await client.query(
        `INSERT INTO role_assignments(user_id,organization_id,role_key,active,assignment_status)
         VALUES($1,NULL,$2,true,'active')`,
        [userId, account.role],
      );

      setStage('audit_event_insertion');
      await client.query(
        `INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,details)
         VALUES(NULL,'auth.global_account.provision','user',$1,
           jsonb_build_object('method','coolify_one_time_cli','role',$2::text))`,
        [userId, account.role],
      );
      credentials.push({ role: account.role, email: account.email, password });
    }

    setStage('credentials_file_creation');
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

    setStage('file_permissions');
    await chmod(credentialPath, 0o600);

    setStage('transaction_commit');
    await client.query('COMMIT');
    transactionOpen = false;
    transactionCommitted = true;
    return provisioningSuccessSummary(accounts.map(account => account.role), credentialPath);
  } catch (error) {
    let rollbackSucceeded = null;
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
        rollbackSucceeded = true;
      } catch {
        rollbackSucceeded = false;
      }
    }
    if (!transactionCommitted) await unlink(credentialPath).catch(() => {});
    throw new ProvisionExecutionError(
      formatProvisionFailure(error, stage, rollbackSucceeded),
    );
  }
}

function option(name) {
  const prefix = `${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  let stage = 'input_validation';
  let pool;
  let client;
  try {
    if (!process.argv.includes(CONFIRM_FLAG)) throw new ProvisionError();
    const adminEmail = normalizeEmail(option(EMAIL_ARGS[0]));
    const supportEmail = normalizeEmail(option(EMAIL_ARGS[1]));
    if (adminEmail === supportEmail) throw new ProvisionError();

    stage = 'production_guard';
    if (process.env.NODE_ENV !== 'production' ||
        process.env.VERNATUN_GLOBAL_ACCOUNT_CONFIRM !== CONFIRM_ENV ||
        !process.env.DATABASE_URL) {
      throw new ProvisionError();
    }

    stage = 'database_target_validation';
    let databaseName;
    try {
      databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\/+/, ''));
    } catch {
      throw new ProvisionError();
    }
    if (databaseName !== 'vernatun') throw new ProvisionError();

    const accounts = [
      { role: 'platform_admin', email: adminEmail, name: 'Vernatun Platform Admin' },
      { role: 'support', email: supportEmail, name: 'Vernatun Support' },
    ];
    const credentialPath = `/tmp/vernatun-global-accounts-${randomUUID()}.json`;

    stage = 'database_connection';
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 10_000,
    });
    client = await pool.connect();

    const summary = await provisionGlobalAccounts({
      client,
      accounts,
      credentialPath,
      onStage: next => { stage = next; },
    });
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    const diagnostic = error instanceof ProvisionExecutionError
      ? error.diagnostic
      : formatProvisionFailure(error, stage, null);
    console.error(JSON.stringify(diagnostic));
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool?.end();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
