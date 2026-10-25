import pg from 'pg';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const VERIFY_FLAG = '--confirm-production-global-account-verification';
const VERIFY_ENV = 'VERIFY_GLOBAL_ACCOUNTS';
const EMAIL_ARGS = ['--platform-admin-email', '--support-email'];
const EXPECTED_ROLES = ['platform_admin', 'support'];

const FAILURE_REPORT = Object.freeze({
  status: 'fail',
  accounts: Object.freeze(EXPECTED_ROLES.map(role => Object.freeze({
    role,
    status: 'fail',
  }))),
});

const ACCOUNT_CHECK_SQL = `
  WITH targets(role_key, email) AS (
    VALUES ('platform_admin'::text, $1::text), ('support'::text, $2::text)
  )
  SELECT
    t.role_key,
    (
      SELECT count(*)::int
      FROM users u
      WHERE lower(u.email) = t.email
    ) AS account_match_count,
    COALESCE((
      SELECT bool_and(u.account_status = 'active' AND NOT u.blocked)
      FROM users u
      WHERE lower(u.email) = t.email
    ), false) AS active,
    (
      SELECT count(DISTINCT a.id)::int
      FROM users u
      JOIN role_assignments a ON a.user_id = u.id
      WHERE lower(u.email) = t.email
        AND a.organization_id IS NULL
        AND a.role_key = t.role_key
        AND a.active = true
        AND a.assignment_status = 'active'
        AND a.starts_at <= now()
        AND (a.expires_at IS NULL OR a.expires_at > now())
    ) AS global_role_count,
    COALESCE((
      SELECT bool_and(m.enabled AND m.secret_encrypted IS NOT NULL)
      FROM users u
      JOIN mfa_credentials m ON m.user_id = u.id
      WHERE lower(u.email) = t.email
    ), false) AS mfa_enabled
  FROM targets t
  ORDER BY t.role_key
`;

function normalizeEmail(value) {
  if (typeof value !== 'string') throw new Error('Invalid verification input');
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Invalid verification input');
  }
  return email;
}

function validateAccounts(accounts) {
  if (!Array.isArray(accounts) || accounts.length !== EXPECTED_ROLES.length) {
    throw new Error('Invalid verification input');
  }

  const byRole = new Map();
  for (const account of accounts) {
    if (!account || !EXPECTED_ROLES.includes(account.role) || byRole.has(account.role)) {
      throw new Error('Invalid verification input');
    }
    byRole.set(account.role, normalizeEmail(account.email));
  }

  if (EXPECTED_ROLES.some(role => !byRole.has(role)) ||
      new Set(byRole.values()).size !== EXPECTED_ROLES.length) {
    throw new Error('Invalid verification input');
  }
  return byRole;
}

function passFail(value) {
  return value ? 'pass' : 'fail';
}

function reportFromRows(rows) {
  const rowByRole = new Map(rows.map(row => [row.role_key, row]));
  const accounts = EXPECTED_ROLES.map(role => {
    const row = rowByRole.get(role);
    const found = Number(row?.account_match_count) === 1;
    const checks = {
      account: passFail(found),
      active: passFail(found && row.active === true),
      globalRole: passFail(found && Number(row.global_role_count) === 1),
    };
    if (role === 'platform_admin') checks.mfa = passFail(found && row.mfa_enabled === true);

    const status = Object.values(checks).every(value => value === 'pass') ? 'pass' : 'fail';
    return { role, status, checks };
  });

  return {
    status: accounts.every(account => account.status === 'pass') ? 'pass' : 'fail',
    accounts,
  };
}

export async function verifyGlobalAccounts({
  client,
  accounts,
  expectedDatabase = 'vernatun',
  expectedSchema = 'public',
}) {
  if (!client || typeof client.query !== 'function') throw new Error('Invalid verification input');
  const emailByRole = validateAccounts(accounts);
  let transactionOpen = false;
  try {
    await client.query('BEGIN READ ONLY');
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout='15s'");

    const identity = await client.query(
      'SELECT current_database() AS name, current_schema() AS schema',
    );
    if (identity.rows[0]?.name !== expectedDatabase ||
        identity.rows[0]?.schema !== expectedSchema) {
      throw new Error('Database target mismatch');
    }

    const results = await client.query(ACCOUNT_CHECK_SQL, EXPECTED_ROLES.map(role => emailByRole.get(role)));
    return reportFromRows(results.rows);
  } finally {
    if (transactionOpen) await client.query('ROLLBACK');
  }
}

function failReport() {
  return JSON.parse(JSON.stringify(FAILURE_REPORT));
}

function option(name) {
  const prefix = `${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  let pool;
  let client;
  let report = failReport();
  try {
    if (!process.argv.includes(VERIFY_FLAG) ||
        process.env.NODE_ENV !== 'production' ||
        process.env.VERNATUN_GLOBAL_ACCOUNT_VERIFY !== VERIFY_ENV ||
        !process.env.DATABASE_URL) {
      throw new Error('Verification precondition failed');
    }

    const platformAdminEmail = normalizeEmail(option(EMAIL_ARGS[0]));
    const supportEmail = normalizeEmail(option(EMAIL_ARGS[1]));
    if (platformAdminEmail === supportEmail) throw new Error('Invalid verification input');

    let databaseName;
    try {
      databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\/+/, ''));
    } catch {
      throw new Error('Invalid database target');
    }
    if (databaseName !== 'vernatun') throw new Error('Invalid database target');

    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 10_000,
    });
    client = await pool.connect();
    report = await verifyGlobalAccounts({
      client,
      accounts: [
        { role: 'platform_admin', email: platformAdminEmail },
        { role: 'support', email: supportEmail },
      ],
    });
  } catch {
    // Deliberately omit error text, SQL details, addresses, and connection data.
  } finally {
    client?.release();
    await pool?.end().catch(() => {});
  }

  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'pass') process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
