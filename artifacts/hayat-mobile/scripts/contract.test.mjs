import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appJson = JSON.parse(await readFile(new URL('../app.json', import.meta.url), 'utf8'));
const api = await readFile(new URL('../api.ts', import.meta.url), 'utf8');
const screen = await readFile(new URL('../app/index.tsx', import.meta.url), 'utf8');

test('HAYAT has a separate Android package and URL scheme from ImTun', () => {
  assert.equal(appJson.expo.android.package, 'com.vernatun.hayat.contractor');
  assert.equal(appJson.expo.scheme, 'hayatcontractor');
  assert.equal(appJson.expo.slug, 'hayat-contractor');
});

test('contractor app only calls existing server-authorized HAYAT and defect routes', () => {
  assert.match(api, /\/auth\/session/);
  assert.match(api, /\/auth\/login/);
  assert.match(api, /\/auth\/context/);
  assert.match(api, /\/hayat\/queue/);
  assert.match(api, /\/defects\/.*\/transition/);
  assert.match(api, /X-CSRF-Token/);
  assert.match(api, /credentials:\s*'include'/);
  assert.match(screen, /role_key\s*===\s*["']contractor["']/);
  assert.match(screen, /context\.role_key === ["']contractor["'] && context\.permissions\.includes\(["']defects\.assigned["']\)/);
  assert.match(screen, /key:\s*createIdempotencyKey\(\)/);
  assert.match(screen, /version:\s*row\.version/);
  assert.match(screen, /useInfiniteQuery/);
});
