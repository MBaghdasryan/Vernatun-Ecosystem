# Coolify production billing migration plan

## Scope and current state

This is a read-only preparation plan, not authorization to run a production migration.

- Target: the Vernatun Coolify PostgreSQL database `vernatun`.
- In Replit development, migration 064 retains its originally applied checksum. Migration 065 has been applied there and the `billing_manual_charges` table was verified.
- No production migration or production deployment was run during preparation.
- Current source checksums:
  - `064_configurable_billing_rules.sql`: `0c4a26748e3afbdbeff59401bac919fd6cfa851f5ab52368f03c543a557ff72f`
  - `065_billing_manual_charge_revisions.sql`: `883adc7527652d67dbc5295f35b90c4b42c265b003f13f38648f379757b91a66`

The live production ledger and its pending list are not available from this Replit workspace. Read them from the Coolify API container; do not assume which migrations are pending.

The latest Coolify preflight shared by the operator stopped at `063_platform_task_notifications.sql`. The release contains a later-added `063_platform_task_discussion.sql`, which alphabetical sorting placed before the already-applied notification migration. The migration runner now preserves the historical order: notifications first, then discussion. After deploying this runner, the expected pending sequence is discussion, 064, and 065 if the production ledger and schema are otherwise unchanged; confirm this with the new plan output.

## Prepare the Coolify release

The migration-lineage correction and migration 065 must first be included in the API source revision used by Coolify. Build/deploy that API package without applying database changes; this plan does not deploy it. Then verify the packaged files below before querying the production ledger.

## Read-only Coolify preflight

First confirm that the API build currently deployed to Coolify contains the migration runner and both SQL files:

```bash
cd /app/artifacts/api-server
test -s dist/migrate.mjs
test -s dist/migrations/064_configurable_billing_rules.sql
test -s dist/migrations/065_billing_manual_charge_revisions.sql
sha256sum dist/migrations/064_configurable_billing_rules.sql \
  dist/migrations/065_billing_manual_charge_revisions.sql
```

The hashes must match the values above. If the files are absent or either hash differs, stop and deploy/rebuild the reviewed API package before planning.

Run the built-in read-only plan:

```bash
cd /app/artifacts/api-server
NODE_ENV=production node dist/migrate.mjs --coolify-plan
```

The output must identify database `vernatun`, show no checksum mismatch, no history gap, and `drift: []`. Review the complete `pending` list. Stop if it includes an unrelated migration, an unknown migration, or any migration whose effect has not been separately reviewed. Do not edit `schema_migrations` or rewrite an applied migration to make the plan pass.

## Before any later apply

1. Create a fresh PostgreSQL backup outside the Coolify container and outside the database volume.
2. Verify the backup archive and restore it into a separate disposable database. A successful `pg_dump` alone is not restore verification.
3. Schedule a maintenance window and stop the Vernatun API resource before applying.
4. Re-run `--coolify-plan`; compare its exact pending list with the reviewed list.
5. Obtain separate explicit approval before running the apply command. This plan does not grant that approval.

No backup destination is configured in this workspace, so a backup command and location must come from the operator's verified external backup process rather than an assumed container path.

## Later validation

After an approved apply, run the same `--coolify-plan` command again. It must show `pending: []` and `drift: []`. Then confirm the expected schema objects and migration records exist, restart the API, and perform a billing preview in Vernatun OS without publishing an invoice. Never validate this migration by changing a real resident invoice or initiating a real payment.
