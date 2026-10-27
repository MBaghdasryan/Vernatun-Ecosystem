const expoDevHost = process.env.REPLIT_EXPO_DEV_DOMAIN?.trim();
if (!expoDevHost) {
  throw new Error('REPLIT_EXPO_DEV_DOMAIN must be set to check the Android development bundle.');
}

const hostUrl = new URL(`https://${expoDevHost}`);
if (
  hostUrl.protocol !== 'https:' ||
  hostUrl.hostname !== expoDevHost ||
  hostUrl.pathname !== '/' ||
  hostUrl.search ||
  hostUrl.hash
) {
  throw new Error('REPLIT_EXPO_DEV_DOMAIN must be a hostname, not a URL or path.');
}

const manifestUrl = new URL('/', hostUrl);
manifestUrl.searchParams.set('platform', 'android');
manifestUrl.searchParams.set('dev', 'true');
manifestUrl.searchParams.set('hot', 'false');
manifestUrl.searchParams.set('lazy', 'true');

const manifestResponse = await fetch(manifestUrl, {
  headers: {
    accept: 'application/expo+json, application/json',
    'expo-platform': 'android',
    'expo-protocol-version': '1',
  },
  redirect: 'manual',
  signal: AbortSignal.timeout(30_000),
});

if (manifestResponse.status !== 200) {
  throw new Error(`Android Expo manifest returned HTTP ${manifestResponse.status}.`);
}

let manifest;
try {
  manifest = await manifestResponse.json();
} catch {
  throw new Error('Android Expo manifest did not contain valid JSON.');
}

if (typeof manifest.launchAsset?.url !== 'string') {
  throw new Error('Android Expo manifest did not include a launch bundle URL.');
}

let bundleUrl;
try {
  bundleUrl = new URL(manifest.launchAsset.url);
} catch {
  throw new Error('Android Expo manifest included an invalid launch bundle URL.');
}

if (bundleUrl.protocol !== 'https:' || bundleUrl.hostname !== expoDevHost) {
  throw new Error('Android launch bundle URL does not use the current Replit Expo development host.');
}

const bundleResponse = await fetch(bundleUrl, {
  redirect: 'manual',
  signal: AbortSignal.timeout(60_000),
});

if (bundleResponse.status !== 200) {
  throw new Error(`Android launch bundle returned HTTP ${bundleResponse.status}.`);
}

const bundle = await bundleResponse.arrayBuffer();
if (bundle.byteLength === 0) {
  throw new Error('Android launch bundle response was empty.');
}

console.log(
  `Android Expo manifest and launch bundle are reachable on the Replit development host (${bundle.byteLength} bytes).`,
);
