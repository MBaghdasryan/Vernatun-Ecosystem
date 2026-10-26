const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');

function load(file, modules) {
  const source = fs.readFileSync(path.join(__dirname, '../lib', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => { assert.ok(modules[name], name); return modules[name]; }, Date, Set, JSON, Array, Number, Promise, Uint8Array });
  return exports;
}
function profiles() {
  const values = new Map();
  const h = load('savedProfiles.ts', {
    '@react-native-async-storage/async-storage': { getItem: async k => values.get(k) ?? null, setItem: async (k, v) => values.set(k, v) },
  });
  return { ...h, values };
}
function security({ platform = 'ios', biometric = true } = {}) {
  const values = new Map();
  let bioCalls = 0;
  const h = load('localSecurity.ts', {
    'react-native': { Platform: { OS: platform } },
    'expo-secure-store': {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
      isAvailableAsync: async () => true,
      getItemAsync: async k => values.get(k) ?? null,
      setItemAsync: async (k, v, options) => { assert.equal(options.keychainAccessible, 'device-only'); values.set(k, v); },
      deleteItemAsync: async k => values.delete(k),
    },
    'expo-crypto': {
      CryptoDigestAlgorithm: { SHA256: 'sha256' },
      digestStringAsync: async (algorithm, value) => crypto.createHash(algorithm).update(value).digest('hex'),
      getRandomBytesAsync: async size => new Uint8Array(crypto.randomBytes(size)),
    },
    'expo-local-authentication': {
      hasHardwareAsync: async () => biometric,
      isEnrolledAsync: async () => biometric,
      authenticateAsync: async options => { assert.equal(options.disableDeviceFallback, true); assert.equal(options.biometricsSecurityLevel, 'strong'); bioCalls++; return { success: true }; },
    },
  });
  return { ...h, values, bioCalls: () => bioCalls };
}
test('saved profiles whitelist identity hints and drop credentials, scope and tokens', async () => {
  const h = profiles();
  await h.rememberSavedProfile({ email: 'Resident@Example.test', name: 'Resident', password: 'never-store', token: 'never-store', unitId: 'private-unit' });
  const saved = JSON.parse([...h.values.values()][0]);
  assert.deepEqual(saved, [{ email: 'resident@example.test', name: 'Resident' }]);
});
test('account hints are bounded, deduplicated and removable', async () => {
  const h = profiles();
  for (let n = 0; n < 7; n++) await h.rememberSavedProfile({ email: `resident${n}@example.test`, name: '' });
  assert.equal((await h.getSavedProfiles()).length, 5);
  await h.rememberSavedProfile({ email: 'RESIDENT6@example.test', name: 'Updated' });
  assert.equal((await h.getSavedProfiles()).length, 5);
  assert.equal((await h.getSavedProfiles())[0].name, 'Updated');
  await h.removeSavedProfile('resident6@example.test');
  assert.equal((await h.getSavedProfiles()).length, 4);
});
test('corrupt account hint storage cannot become an authenticated identity', async () => {
  const h = profiles();
  h.values.set('imtun.account-hints.v1', '{bad');
  assert.equal((await h.getSavedProfiles()).length, 0);
  await assert.rejects(h.rememberSavedProfile({ email: 'bad', name: '' }), /INVALID_ACCOUNT_HINT/);
});
test('native PIN uses device-only secure storage, not plaintext PIN', async () => {
  const h = security(); await h.enrollLocalPin('user-1', '493726', false);
  const stored = [...h.values.values()][0];
  assert.equal(stored.includes('493726'), false);
  assert.equal(await h.verifyLocalPin('user-1', '493726'), true);
  assert.equal(await h.verifyLocalPin('user-1', '111111'), false);
});
test('web cannot enroll a pretend secure local PIN', async () => {
  const h = security({ platform: 'web' });
  assert.equal(await h.localLockAvailable(), false);
  await assert.rejects(h.enrollLocalPin('user-1', '493726', false), /UNAVAILABLE/);
});
test('PIN is per authenticated user, invalid PIN format rejected', async () => {
  const h = security();
  await assert.rejects(h.enrollLocalPin('user-1', '123', false), /SIX_DIGITS/);
  await h.enrollLocalPin('user-1', '493726', false);
  assert.equal(await h.readLocalLock('user-2'), null);
  assert.equal(await h.verifyLocalPin('user-2', '493726'), false);
});
test('enrollment cannot overwrite existing protection without verification', async () => {
  const h = security(); await h.enrollLocalPin('user-1', '493726', false);
  await assert.rejects(h.enrollLocalPin('user-1', '111111', true), /ALREADY_ENABLED/);
  assert.equal(await h.verifyLocalPin('user-1', '493726'), true);
});
test('PIN failures persist and throttle further attempts including correct PIN', async () => {
  const h = security(); await h.enrollLocalPin('user-1', '493726', false);
  for (let i = 0; i < 5; i++) assert.equal(await h.verifyLocalPin('user-1', '111111'), false);
  const row = await h.readLocalLock('user-1'); assert.equal(row.failures, 5); assert.ok(row.retryAt > Date.now());
  await assert.rejects(h.verifyLocalPin('user-1', '493726'), /RATE_LIMITED/);
});
test('corrupt secure enrollment fails explicitly, not as disabled lock', async () => {
  const h = security(); h.values.set('imtun.local-lock.v1.user-1', '{"version":1}');
  await assert.rejects(h.readLocalLock('user-1'), /UNREADABLE/);
});
test('biometrics require both enrollment and local hardware', async () => {
  const h = security(); await h.enrollLocalPin('user-1', '493726', false);
  assert.equal(await h.verifyLocalBiometric('user-1', 'Unlock'), false);
  assert.equal(h.bioCalls(), 0);
  const absent = security({ biometric: false });
  await assert.rejects(absent.enrollLocalPin('user-1', '493726', true), /BIOMETRIC_UNAVAILABLE/);
});
test('enabled biometrics invoke OS strong authentication without device fallback', async () => {
  const h = security(); await h.enrollLocalPin('user-1', '493726', true);
  assert.equal(await h.verifyLocalBiometric('user-1', 'Unlock'), true);
  assert.equal(h.bioCalls(), 1);
});
test('disabling app lock requires correct PIN and affects only that user', async () => {
  const h = security(); await h.enrollLocalPin('user-1', '493726', false); await h.enrollLocalPin('user-2', '837492', false);
  await assert.rejects(h.disableLocalLock('user-1', '000000'), /INCORRECT/);
  await h.disableLocalLock('user-1', '493726');
  assert.equal(await h.readLocalLock('user-1'), null);
  assert.ok(await h.readLocalLock('user-2'));
});
