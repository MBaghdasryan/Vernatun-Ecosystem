import path from 'path';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

function apkDevDownloads(): Plugin {
  return {
    name: 'vernatun-apk-development-downloads',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const filename = decodeURIComponent((req.url ?? '').split('?')[0]).split('/').pop();
        if (
          filename !== 'ImTun_app_by_Vernatun.apk' &&
          filename !== 'Hayat_app_by_Vernatun.apk'
        ) {
          next();
          return;
        }
        const filePath = path.resolve(import.meta.dirname, 'public/downloads', filename);
        try {
          const file = await stat(filePath);
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.statusCode = 405;
            res.setHeader('Allow', 'GET, HEAD');
            res.end();
            return;
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/vnd.android.package-archive');
          res.setHeader('Content-Length', String(file.size));
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Cache-Control', 'no-cache');
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          createReadStream(filePath).pipe(res);
        } catch {
          res.statusCode = 404;
          res.end('APK not found');
        }
      });
    },
  };
}

function appsMetadataPage(): Plugin {
  return {
    name: 'vernatun-apps-metadata-page',
    apply: 'build',
    async closeBundle() {
      const publicDir = path.resolve(import.meta.dirname, 'dist/public');
      const appHtml = await readFile(path.join(publicDir, 'index.html'), 'utf8');
      const metadata = [
        '<title>Vernatun Apps — Download ImTun &amp; HAYAT</title>',
        '<meta name="description" content="Download the official Android applications of the Vernatun Smart Living Ecosystem. ImTun for residents and HAYAT for property management teams."/>',
        '<link rel="canonical" href="https://vernatun.io/apps"/>',
        '<meta property="og:type" content="website"/>',
        '<meta property="og:url" content="https://vernatun.io/apps"/>',
        '<meta property="og:title" content="Vernatun Apps — Download ImTun &amp; HAYAT"/>',
        '<meta property="og:description" content="Download the official Android applications of the Vernatun Smart Living Ecosystem. ImTun for residents and HAYAT for property management teams."/>',
        '<meta property="og:image" content="https://vernatun.io/assets/vernatun-original.png"/>',
      ].join('');
      const appsHtml = appHtml
        .replace(/<title>.*?<\/title>/i, '')
        .replace(/<meta name="description"[^>]*>/i, '')
        .replace(/<meta property="og:[^"]+"[^>]*>/gi, '')
        .replace('</head>', `${metadata}</head>`);
      const appsDir = path.join(publicDir, 'apps');
      await mkdir(appsDir, { recursive: true });
      await writeFile(path.join(appsDir, 'index.html'), appsHtml);
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    apkDevDownloads(),
    appsMetadataPage(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
