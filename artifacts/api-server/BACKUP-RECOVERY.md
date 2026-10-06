# Coordinated backup and recovery

## Verified platform capabilities

Official Replit documentation checked on 2026-10-06:

- [Data recovery](https://docs.replit.com/features/data-and-storage/data-recovery):
  development database rollback is checkpoint-based, with up to seven days.
  Production supports point-in-time recovery and scheduled daily database
  backups. Core supports up to seven days; Pro/Enterprise up to 28 days,
  initially seven. These are PostgreSQL recovery facilities.
- [App Storage](https://docs.replit.com/features/data-and-storage/object-storage):
  persistent GCS-backed bytes, project-exclusive buckets shared between
  development and production. **Deleting objects or buckets is irreversible**;
  the documentation explicitly advises making backups first.

Neither page promises a coordinated database + App Storage restore. Do not
assume a checkpoint, Publish operation or PostgreSQL restore also restores
file bytes. We did not enable or inspect a production backup schedule.

## Policy

Keep each **complete paired snapshot for at least 30 days after creation**.
The manifest records `createdAt` and `retainUntil` (creation + 30 days).
Recommended operating frequency: daily and before destructive maintenance;
run a restore drill monthly and before any real recovery.

This is an explicit application policy, not a claim that Replit's database
retention is 30 days. No daily job, bucket lifecycle rule or automatic pruning
has been enabled. Until automation is separately approved, an operator must
create copies and retain them; the code never deletes completed old backups.
After expiry, delete a complete snapshot only after verifying a newer complete
snapshot and its successful drill; retain incident/legal holds. Partial copies
are not backups, regardless of their age.

A sibling prefix in the same private bucket protects against accidental
deletion of live objects, **not deletion of the bucket/project or loss of
access**. An independently stored, encrypted complete copy is required for
that stronger disaster-recovery guarantee. No external destination is
configured. Backups contain sensitive documents, password hashes, sessions,
MFA secrets and business data: never make them public, commit them to Git,
attach them to chat, or serve them over HTTP.

## Contents and consistency

`backup:create` captures the current application schema, including metadata,
users, roles, context assignments, visibility, sessions, audit history, foreign
keys, functions, triggers and sequences. `pg_dump` uses an exported repeatable
read snapshot. The transaction takes SHARE locks on all schema tables and
per-file advisory locks used by uploads/reviewed cleanup. This blocks writes
while capturing the set. A five-second lock timeout aborts instead of waiting
indefinitely. Run in a quiet maintenance window: active writers/cleanup can
cause an abort (including a detected deadlock); retry only once they finish.
Do not run schema migrations or out-of-band bucket deletion during capture.
The transaction has a 15-minute idle limit.

Only referenced bytes from `request_photos`, `file_attachments`, `documents`
are copied. Each file is read at its recorded GCS generation. Missing bytes,
invalid keys, conflicting media types or checksum failures reject the set.
Objects are create-only. Backup writes are downloaded and checked with SHA-256.
No metadata rows or source bytes are modified. Failed new copies are cleaned
only within their own random backup prefix; if cleanup also fails, the partial
prefix has no valid completion manifest and is not recoverable as a snapshot.

Inside the existing private directory, a snapshot contains:

```text
vernatun-backups/backup_<random 20 hex>/
  database.dump
  files/photos/<original UUID key, including .jpg>
  files/documents/<original UUID key>
  manifest.json
```

`manifest.json` is written **last**, after SQL snapshot capture completes.
It records schema, source storage scope hash, file kinds, original keys,
media types, custom private-object metadata, source generations, byte lengths,
SHA-256 hashes, full-table row counts/hashes and retention dates.
It contains no database connection string or sidecar credentials.
The backup prefix is outside live-file inventory/cleanup.

The SQL dump omits database ownership and SQL role grants for portable isolated
restoration. **Application** access rights are preserved as table data and
rechecked by existing HTTP handlers. Source bucket IAM is neither exported nor
relaxed; no public ACL or download link is created. If a deployment later uses
custom SQL roles or RLS policies, provision those roles explicitly in the
approved target and verify their grants before cutover.

## Create one development snapshot

Prerequisites: PostgreSQL client tools compatible with the server (`pg_dump`,
`pg_restore`), existing sidecar App Storage access, the API environment, and
permission to create a separate database for the drill. Use the existing
environment/Secrets flow; never put credentials in command arguments or logs.

```sh
pnpm --filter @workspace/api-server run backup:create
```

Save the returned backup ID and retention deadline in a restricted operational
record. Verify the complete manifest exists. Do not manually add a manifest
to an incomplete copy. This command rejects production. It is not a seed,
migration, publication, scheduling command or automatic backup of live data.
For a large dataset, plan capacity: SQL and file downloads are buffered in
memory, and a drill buffers the whole file set; use a sized maintenance runner
or implement streaming before data exceeds its memory budget.

## Isolated drill

```sh
pnpm --filter @workspace/api-server run backup:drill backup_<20 hex>
pnpm --filter @workspace/api-server run test:backup
```

The drill validates the manifest and every byte **before** allocating targets,
then creates a fresh `vernatun_restore_<random>` database from `template0`.
It restores SQL in one transaction with `--exit-on-error`, retaining the
original schema. It compares all table hashes and the exact referenced-file
set, and restores original keys in `vernatun-test/qa_<random>/`. The prefix is
private and distinct from live data. Cache control remains `private, no-store`.
Each restored object's hash is checked again.

There is no supplied target URL or live-prefix option. The drill never changes
the working database or source objects, opens a public endpoint, or publishes.
After inspection it closes the target connections and removes only the
runner-created database/files. If cleanup fails, the command fails rather
than reporting success; identify those runner-created resources before an
operator removes them, never delete `public` in the application database.

The automated integration suite additionally starts loopback-only HTTP
servers against synthetic runner-owned data. It verifies:

- real PDF/JPEG recovery after deliberately removing a test-source file;
- original UUID keys and complete metadata equality;
- staff/resident/unit-owner document visibility;
- request/defect photo scopes, cross-organization denial, anonymous denial;
- revoked contractor assignment taking effect after restore;
- private download headers and exact returned bytes;
- repeatable restore into different targets, corrupted dump rejection;
- duplicate/traversal manifest rejection and missing-source backup failure;
- unchanged source SQL table fingerprints.

The suite passed against real PostgreSQL/App Storage on 2026-10-06. Only test
fixtures were removed to simulate loss. No real working files were deleted.

## Real incident procedure — separate approval required

1. Stop uploads, metadata writes and cleanup in the affected environment.
   Record the incident and take a rescue copy of its current state; do not
   delete rows to hide missing files.
2. Select a complete **paired** snapshot from before the loss. Do not mix
   a newer SQL restore point with older object bytes or vice versa. Preserve
   the matching code/migration version and bucket configuration.
3. Validate manifest, SQL/file checksums and retention; run the isolated drill.
   Identify the source DB/storage environment from the restricted operations
   record and manifest scope. A development snapshot is not a production copy.
4. Obtain explicit approval for a production recovery target and downtime.
   Provision a fresh database and private storage destination with existing
   server-only permissions. Restore SQL and bytes to that destination **before**
   switching the app; preserve every UUID/storage key and directory kind.
   Do not restore into the currently running database/prefix.
5. Verify all referenced files, all table counts/hashes and authenticated
   allowed/denied downloads using the matching application version.
   Provision necessary database ownership/roles separately; keep the bucket
   private. Never expose sidecar credentials or generate public file URLs.
6. Switch the database/private storage configuration only after those checks
   pass and approval is recorded. Reconcile sessions/CSRF, restart the app,
   verify authorized downloads, and resume writes/cleanup. Publishing is a
   separate action requiring permission.
7. Keep the previous database/storage intact for rollback. Roll back both
   targets together if validation fails; do not combine mismatched versions.

The delivered commands implement capture and a disposable drill, **not**
production promotion or connection switching. This task has not performed
steps 1–7 on working data or configured a production restore target.
