# Vernatun restoration

The API under `/api` runs the original Passport Local, PostgreSQL session,
CSRF, role/scope, module, MFA and business handlers from the supplied source
archive. Source lives in `archive/vernatun/server/`; its OpenAPI document is
`archive/vernatun/server/openapi.json`. The existing frontend consumes that
contract directly; do not replace it with the template health-only contract.

## Development data

The archive contains no database backup or real user export. With explicit user
approval, its 12 original migrations and both demo scripts were applied to the
development database. This creates 15 **new demo accounts**, all 14 roles and a
second organization's administrator, with newly generated random passwords.

Credentials are local only, owner-readable and gitignored:
`artifacts/api-server/.local/demo-accounts.md` and `.json`.
Never serve these files over HTTP, include them in a build, or log their contents.
The API workflow must run from this artifact's directory because the original
private file and development outbox paths are relative to its working directory.

## Commands

- `pnpm --filter @workspace/api-server run db:migrate` — approved development
  migrations, checksum checked and idempotent; refuses production.
- `NODE_ENV=development DEMO_SEED_ENABLED=true pnpm --filter @workspace/api-server run db:seed`
  — **only after explicit permission**; preserves an existing demo seed.
- `pnpm --filter @workspace/api-server run test:api` — archived integration tests
  in a fresh runner-owned schema in the separate `vernatun_test` database;
  cleans up only that temporary schema afterwards, never touches app data.
- `pnpm --filter @workspace/api-server exec tsx --test ../vernatun/src/portal/client.test.ts`
  — transport/CSRF regression tests without a database.
- `pnpm run typecheck` — workspace check.

No workflow startup or post-merge script seeds users. Post-merge applies the SQL
migrations to development only, instead of pushing the template's empty Drizzle
schema. Do not run `lib/db` schema push against this restored database.

## Production boundaries

`DATABASE_URL`, a stable `SESSION_SECRET` (32+ characters) and explicit HTTPS
`APP_ORIGIN` are required. The development origin defaults to the Replit
development domain; it is never used as a production fallback. Trust one proxy
hop so original secure production cookies and per-client rate limits work.
Use the managed Publish schema flow for production, never startup DDL or the
development migration command. Demo seed is prohibited in production.

The restored source keeps its original private file storage and development-only
password-reset outbox. This task does not configure persistent production object
storage or email delivery. Those require separate setup before production use.
