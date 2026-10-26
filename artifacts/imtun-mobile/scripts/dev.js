const { spawn, spawnSync } = require('node:child_process');

const devDomain = process.env.REPLIT_DEV_DOMAIN?.trim();
const expoDomain = process.env.REPLIT_EXPO_DEV_DOMAIN?.trim();
if (!devDomain || !expoDomain) {
  throw new Error('Replit development and Expo domains must be set for the ImTun development server.');
}

if (process.env.REPLIT_EXPO_SESSION_SECRET) {
  spawnSync(
    'pnpm',
    ['exec', 'create-launch', 'login', '--session', process.env.REPLIT_EXPO_SESSION_SECRET],
    { stdio: 'inherit' },
  );
}

const child = spawn(
  'pnpm',
  ['exec', 'expo', 'start', '--localhost', '--port', process.env.PORT],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      EXPO_PACKAGER_PROXY_URL: `https://${expoDomain}`,
      EXPO_PUBLIC_DEV_API_URL: `https://${devDomain}`,
      EXPO_PUBLIC_API_URL: `https://${devDomain}`,
      EXPO_PUBLIC_DOMAIN: devDomain,
      EXPO_PUBLIC_REPL_ID: process.env.REPL_ID,
      REACT_NATIVE_PACKAGER_HOSTNAME: devDomain,
    },
  },
);

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
