import bcrypt from 'bcryptjs';
import pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, unlink, writeFile } from 'node:fs/promises';

const CONFIRM_FLAG = '--confirm-production-account-recovery';
const CONFIRM_ENV = 'RESET_GLOBAL_ACCOUNT';
const TEST_MODE_ENV = 'VERNATUN_ACCOUNT_RECOVERY_TEST_MODE';
const ALLOWED_ROLES = new Set(['platform_admin', 'support']);

class RecoveryError extends Error {}

function option(name) {
  const prefix = `${name}=`;
  const match = process.argv.find(argument => argument.startsWith(prefix));
  return match?.slice(prefix.length);
}

async function main() {
  const email = option('--email')?.trim().toLowerCase();
  const role = option('--role');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !role || !ALLOWED_ROLES.has(role) || !process.argv.includes(CONFIRM_FLAG)) {
    throw new RecoveryError(
      `Usage: --email=<existing-account-email> --role=platform_admin|support ${CONFIRM_FLAG}`,
    );
  }
  const isolatedTestMode = process.env.NODE_ENV === 'test' &&
    process.env[TEST_MODE_ENV] === '1';
  if (!process.env.DATABASE_URL || (!isolatedTestMode &&
      (process.env.NODE_ENV !== 'production' ||
       process.env.VERNATUN_ACCOUNT_RECOVERY_CONFIRM !== CONFIRM_ENV))) {
    throw new RecoveryError(
      `Refusing recovery: production mode, DATABASE_URL, and VERNATUN_ACCOUNT_RECOVERY_CONFIRM=${CONFIRM_ENV} are required.`,
    );
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\/+/, ''));
  } catch {
    throw new RecoveryError('Refusing recovery: DATABASE_URL is invalid.');
  }
  const expectedDatabase = isolatedTestMode ? 'vernatun_test' : 'vernatun';
  if (databaseName !== expectedDatabase) {
    throw new RecoveryError(`Refusing recovery: database name must be exactly ${expectedDatabase}.`);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000 });
  let client;
  let transactionOpen = false;
  let transactionCommitted = false;
  let credentialsWritten = false;
  const credentialPath = `/tmp/vernatun-global-account-recovery-${role}-${randomUUID()}.json`;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('vernatun-global-account-recovery-v1'))");

    const identity = await client.query(
      'SELECT current_database() AS name, current_schema() AS schema',
    );
    const validSchema = isolatedTestMode
      ? /^qa_[a-f0-9]{20}$/.test(identity.rows[0]?.schema ?? '')
      : identity.rows[0]?.schema === 'public';
    if (identity.rows[0]?.name !== expectedDatabase || !validSchema) {
      throw new RecoveryError('Refusing recovery: connected database/schema identity is not permitted.');
    }

    const userResult = await client.query(
      `SELECT id, blocked, account_status
       FROM users
       WHERE lower(email)=$1
       FOR UPDATE`,
      [email],
    );
    if (userResult.rowCount !== 1) {
      throw new RecoveryError('No existing account matched the supplied email; no account was created.');
    }
    const user = userResult.rows[0];
    if (user.blocked || user.account_status !== 'active') {
      throw new RecoveryError('The account is blocked or inactive; recovery stopped without changing it.');
    }

    const assignment = await client.query(
      `SELECT id,role_key
       FROM role_assignments
       WHERE user_id=$1 AND organization_id IS NULL
         AND active=true AND assignment_status='active'
         AND starts_at<=now() AND (expires_at IS NULL OR expires_at>now())
       FOR UPDATE`,
      [user.id],
    );
    if (assignment.rowCount !== 1 || assignment.rows[0]?.role_key !== role) {
      throw new RecoveryError(
        `The account does not have exactly one active global ${role} assignment; no change was made.`,
      );
    }

    const password = randomBytes(32).toString('base64url');
    const passwordHash = await bcrypt.hash(password, 12);
    await client.query('UPDATE users SET password_hash=$1 WHERE id=$2', [passwordHash, user.id]);
    await client.query(
      'UPDATE password_resets SET used_at=COALESCE(used_at,now()) WHERE user_id=$1 AND used_at IS NULL',
      [user.id],
    );
    const revokedSessions = await client.query(
      `DELETE FROM session
       WHERE sess->'passport'->>'user'=$1`,
      [user.id],
    );
    await client.query(
      `INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,details)
       VALUES(NULL,'auth.password.recovery','user',$1::text,
        jsonb_build_object('method','coolify_one_time_cli','role',$2::text))`,
      [user.id, role],
    );

    await writeFile(
      credentialPath,
      JSON.stringify({
        warning: 'Private one-time recovery credential. Never commit, log, or send this file in chat.',
        role,
        accountEmail: email,
        password,
        mfaChanged: false,
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
      status: 'password_reset',
      role,
      sessionsRevoked: revokedSessions.rowCount,
      mfaChanged: false,
      passwordPrinted: false,
      privateCredentialsFile: credentialPath,
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
  if (error instanceof RecoveryError) {
    console.error(error.message);
  } else {
    console.error('Account recovery failed; no password or database details were printed.');
  }
  process.exitCode = 1;
});
