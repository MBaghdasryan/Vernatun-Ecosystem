import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { cp, rm, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });
  // Public, non-secret identity of this exact API build (not a release/semver).
  const buildId = 'api-' + randomUUID();
  const sourceNames = (await readdir(path.join(artifactDir, 'archive/vernatun/server')))
    .filter(name => /^[a-zA-Z0-9_-]+\.ts$/.test(name));

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    define: {
      __VERNATUN_BUILD_ID__: JSON.stringify(buildId),
      __VERNATUN_SOURCE_NAMES__: JSON.stringify([...sourceNames, 'index.ts', 'index.mjs']),
    },
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });
  await esbuild({
    entryPoints: {
      migrate: path.resolve(artifactDir, "archive/vernatun/server/migrate.ts"),
    },
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    external: ["pg", "dotenv"],
    define: {
      __VERNATUN_BUILD_ID__: JSON.stringify(buildId),
    },
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
globalThis.require = __bannerCrReq(import.meta.url);
    `,
    },
    sourcemap: "linked",
    logLevel: "info",
  });
  const sourceMigrations = path.join(artifactDir, "archive/vernatun/server/migrations");
  const packagedMigrations = path.join(distDir, "migrations");
  await cp(sourceMigrations, packagedMigrations, { recursive: true });
  const migrationFiles = async directory => (await readdir(directory))
    .filter(name => /^\d{3}_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();
  const [sourceMigrationNames, packagedMigrationNames] = await Promise.all([
    migrationFiles(sourceMigrations),
    migrationFiles(packagedMigrations),
  ]);
  if (JSON.stringify(sourceMigrationNames) !== JSON.stringify(packagedMigrationNames)) {
    throw new Error("The API release package is missing one or more SQL migrations.");
  }
  await cp(
    path.join(artifactDir, "COOLIFY-USER-MANAGEMENT-RELEASE-RU.md"),
    path.join(distDir, "COOLIFY-USER-MANAGEMENT-RELEASE-RU.md"),
  );
}

// Importers must not start dist/index.mjs until the new bundle exists.
// A fire-and-forget promise let the managed owner import the previous build.
await buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
