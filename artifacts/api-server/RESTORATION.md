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
These generated credential files are historical, not authoritative for accounts
subsequently imported from an export.

On 2026-10-06, with the user's explicit approval, the attached database export
was compared against development and merged additively: 194 missing rows in
21 tables were inserted. All exported schema columns already existed. Existing
roles/permissions and migration timestamps were preserved; no existing row was
overwritten or deleted. The imported accounts retain the export's password
hashes. All imported rows and preservation of pre-existing rows were verified
within the same transaction. A paired development snapshot was captured and
successfully restored in isolation before the merge. The export contained no
document/photo metadata or file bytes; excluded security/session tables were
not populated, and no seed was rerun.
The API workflow runs from this artifact's directory; the development outbox and
legacy migration source paths remain relative to this working directory.

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

The development-only password-reset outbox still requires email delivery setup
before production use.

## Persistent private files

App Storage holds file bytes under `PRIVATE_OBJECT_DIR`; PostgreSQL keeps the
original UUID storage keys, authors, scope, visibility and other metadata. No
schema changes are required. The original multipart-free raw upload and download
API contracts are unchanged. Uploads remain server-mediated so image decoding,
size limits, CSRF and current business permissions cannot be bypassed. Download
authorization is recalculated on every request before any bytes are fetched.
There are no public storage routes or returned signed download URLs.

The Replit sidecar supplies storage authentication; never create credential
files. `PRIVATE_OBJECT_DIR` is required in development and deployment; the
provisioned bucket configuration must be retained for production. Do not use a
public search path for these files. Missing storage configuration or service
failures are errors, never a fallback to local disk. Photo keys are scoped to
`vernatun/photos/`, document keys to `vernatun/documents/` inside the private
directory. Tests use a separate `vernatun-test/` prefix and clean only their own
runner-created objects.

### Transfer existing files before first use of the updated server

Run from the artifact package:

- `pnpm --filter @workspace/api-server run storage:migrate` — read-only preflight.
- `pnpm --filter @workspace/api-server run storage:migrate --apply` — copy bytes
  and verify SHA-256 after transfer; repeatable, never overwrite differing bytes.
- Add `--source-root /path/to/.local` if the source directory is elsewhere.
  It must contain `private-photos/` and `private-documents/`.

The command checks all three tables (`request_photos`, `file_attachments`,
`documents`), refuses to proceed if referenced bytes are absent both locally and
remotely, keeps all local source files and never changes SQL rows. A mismatch
stops migration. Restore a missing file from its original backup, then rerun; do
not delete its database row to silence the error. Run the same preflight against
the intended database and bucket before separately authorized publication.

The existing post-merge setup now transfers and verifies development files after
the already-approved SQL migrations and before workflow reconciliation. It does
not publish, seed accounts or modify production. Production file transfer must
be run explicitly against its intended storage/database, not the dev-only
post-merge script.

The API suite exercises real App Storage, original role/scope restrictions,
PDF/JPEG byte equality, legacy transfer and metadata preservation, repeatable
transfer, missing/conflicting bytes, and authenticated downloads after killing
and starting a new server process. Fixtures stay in the isolated test database.

## Paired PostgreSQL / private-file backups

The maintained source is actually at
`artifacts/api-server/archive/vernatun/server/` (relative to this document:
`archive/vernatun/server/`), not the workspace-root `archive/` directory.

See [BACKUP-RECOVERY.md](BACKUP-RECOVERY.md) for the operating procedure,
retention policy, verified drill and limits. Available commands:

- `pnpm --filter @workspace/api-server run backup:create` — explicitly create
  one paired **development** snapshot. Briefly blocks application writes;
  does not update application rows or live file bytes.
- `pnpm --filter @workspace/api-server run backup:drill <backup_id>` — verify
  that snapshot in a newly generated database and isolated private file prefix,
  then remove only those temporary resources.
- `pnpm --filter @workspace/api-server run test:backup` — real PostgreSQL /
  App Storage recovery and HTTP permission checks with runner-owned fixtures.

These commands are not run on server startup or post-merge. No schedule or
production backup configuration has been enabled. Both commands reject
`NODE_ENV=production`; they cannot be used as a production cutover shortcut.
