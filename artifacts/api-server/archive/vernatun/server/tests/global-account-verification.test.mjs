import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { verifyGlobalAccounts } from '../scripts/verify-global-accounts.mjs';

const adminEmail = 'private-admin@example.test';
const supportEmail = 'private-support@example.test';
const databaseUrl = 'postgresql://private-user:private-db-password@127.0.0.1/vernatun_test';
const scriptPath = fileURLToPath(new URL('../scripts/verify-global-accounts.mjs', import.meta.url));

function fixtureRows({ adminMfa = true, adminActive = true } = {}) {
  return [
    {
      role_key: 'platform_admin',
      account_match_count: 1,
      active: adminActive,
      global_role_count: 1,
      mfa_enabled: adminMfa,
    },
    {
      role_key: 'support',
      account_match_count: 1,
      active: true,
      global_role_count: 1,
      mfa_enabled: false,
    },
  ];
}

function fakeClient(rows, identity = { name: 'vernatun', schema: 'public' }) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql === 'SELECT current_database() AS name, current_schema() AS schema') {
        return { rows: [identity] };
      }
      if (sql.includes('WITH targets(role_key, email)')) return { rows };
      return { rows: [] };
    },
  };
}

test('verification is read-only and reports expected roles without account or credential data', async () => {
  const client = fakeClient(fixtureRows());
  const report = await verifyGlobalAccounts({
    client,
    accounts: [
      { role: 'platform_admin', email: adminEmail },
      { role: 'support', email: supportEmail },
    ],
  });

  assert.deepEqual(report, {
    status: 'pass',
    accounts: [
      {
        role: 'platform_admin',
        status: 'pass',
        checks: { account: 'pass', active: 'pass', globalRole: 'pass', mfa: 'pass' },
      },
      {
        role: 'support',
        status: 'pass',
        checks: { account: 'pass', active: 'pass', globalRole: 'pass' },
      },
    ],
  });

  const serialized = JSON.stringify(report);
  for (const privateValue of [
    adminEmail,
    supportEmail,
    databaseUrl,
    'private-db-password',
    'password_hash',
    'recovery_hashes',
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }

  assert.equal(client.calls[0].sql, 'BEGIN READ ONLY');
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
  assert.deepEqual(client.calls.find(call => call.sql.includes('WITH targets(role_key, email)')).params, [
    adminEmail,
    supportEmail,
  ]);
  assert.ok(client.calls.every(({ sql }) =>
    !/^\s*(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE)\b/i.test(sql)));
});

test('admin MFA or inactive account makes the verification fail', async () => {
  const noMfa = await verifyGlobalAccounts({
    client: fakeClient(fixtureRows({ adminMfa: false })),
    accounts: [
      { role: 'platform_admin', email: adminEmail },
      { role: 'support', email: supportEmail },
    ],
  });
  assert.equal(noMfa.status, 'fail');
  assert.equal(noMfa.accounts[0].checks.mfa, 'fail');
  assert.equal(noMfa.accounts[1].status, 'pass');

  const inactiveAdmin = await verifyGlobalAccounts({
    client: fakeClient(fixtureRows({ adminActive: false })),
    accounts: [
      { role: 'platform_admin', email: adminEmail },
      { role: 'support', email: supportEmail },
    ],
  });
  assert.equal(inactiveAdmin.accounts[0].checks.active, 'fail');
  assert.equal(inactiveAdmin.status, 'fail');

  const ambiguousAdmin = await verifyGlobalAccounts({
    client: fakeClient([
      {
        role_key: 'platform_admin',
        account_match_count: 2,
        active: true,
        global_role_count: 1,
        mfa_enabled: true,
      },
      {
        role_key: 'support',
        account_match_count: 1,
        active: true,
        global_role_count: 1,
        mfa_enabled: false,
      },
    ]),
    accounts: [
      { role: 'platform_admin', email: adminEmail },
      { role: 'support', email: supportEmail },
    ],
  });
  assert.equal(ambiguousAdmin.accounts[0].checks.account, 'fail');
  assert.equal(ambiguousAdmin.status, 'fail');
});

test('production verification guard fails without echoing addresses or database credentials', () => {
  const result = spawnSync(process.execPath, [
    scriptPath,
    `--platform-admin-email=${adminEmail}`,
    `--support-email=${supportEmail}`,
    '--confirm-production-global-account-verification',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      VERNATUN_GLOBAL_ACCOUNT_VERIFY: 'VERIFY_GLOBAL_ACCOUNTS',
      DATABASE_URL: databaseUrl,
    },
  });

  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'fail');
  assert.equal(result.stderr, '');
  for (const privateValue of [adminEmail, supportEmail, databaseUrl, 'private-db-password']) {
    assert.equal(result.stdout.includes(privateValue), false);
    assert.equal(result.stderr.includes(privateValue), false);
  }
});
