const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mobileRoot = path.resolve(__dirname, '..');

test('ImTun development launch uses the current Replit hosts instead of the shared API setting', t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imtun-dev-routing-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const captureFile = path.join(tempDir, 'launch.json');
  const fakePnpmPath = path.join(tempDir, 'pnpm');
  fs.writeFileSync(fakePnpmPath, `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.CAPTURE_FILE, JSON.stringify({
  args: process.argv.slice(2),
  packagerProxyUrl: process.env.EXPO_PACKAGER_PROXY_URL,
  devApiUrl: process.env.EXPO_PUBLIC_DEV_API_URL,
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
  sharedDomain: process.env.EXPO_PUBLIC_DOMAIN,
}));
`);
  fs.chmodSync(fakePnpmPath, 0o755);

  const devDomain = 'imtun-dev.replit.dev';
  const expoDomain = 'imtun-expo.replit.dev';
  const sharedProductionDomain = 'api.vernatun.io';
  const launch = spawnSync(process.execPath, [path.join(mobileRoot, 'scripts/dev.js')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${tempDir}${path.delimiter}${process.env.PATH}`,
      CAPTURE_FILE: captureFile,
      PORT: '8081',
      REPLIT_DEV_DOMAIN: devDomain,
      REPLIT_EXPO_DEV_DOMAIN: expoDomain,
      EXPO_PUBLIC_DOMAIN: sharedProductionDomain,
    },
  });

  assert.equal(launch.status, 0, launch.stderr);
  const captured = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
  assert.deepEqual(captured.args, ['exec', 'expo', 'start', '--localhost', '--port', '8081']);
  assert.equal(captured.packagerProxyUrl, `https://${expoDomain}`);
  assert.equal(captured.devApiUrl, `https://${devDomain}`);
  assert.equal(captured.apiUrl, `https://${devDomain}`);
  assert.equal(captured.sharedDomain, devDomain);

  const layout = fs.readFileSync(path.join(mobileRoot, 'app/_layout.tsx'), 'utf8');
  assert.match(
    layout,
    /const configuredApiUrl = __DEV__[\s\S]*?process\.env\.EXPO_PUBLIC_DEV_API_URL\?\.trim\(\)[\s\S]*?:\s*\(process\.env\.EXPO_PUBLIC_API_URL\?\.trim\(\)\s*\|\|\s*process\.env\.EXPO_PUBLIC_DOMAIN\?\.trim\(\)\)/,
    'the app must select EXPO_PUBLIC_DEV_API_URL for development and reserve shared URLs for release builds',
  );
});

test('release EAS profiles retain the production API URL', () => {
  const easConfig = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'eas.json'), 'utf8'));
  for (const profile of ['preview', 'production-initial', 'production']) {
    assert.equal(easConfig.build[profile].env.EXPO_PUBLIC_API_URL, 'https://api.vernatun.io');
  }
});
