# Private file inventory and cleanup

This is an operator-only command, not a web endpoint or scheduled deletion.
Deploy the upload-locking changes before using cleanup. Do not run against a
bucket shared by another database: every live reference must be visible in the
selected database and schema. Do not run while restoring files or changing the
storage/database configuration.

## Preview first

From the workspace root:

```sh
pnpm --filter @workspace/api-server storage:inventory --report /tmp/private-files-report.json
```

The report lists managed photos/documents with size, creation/update times,
generation, and status (`referenced`, `recent`, `candidate`).
Unknown names or incomplete metadata are counted as ignored and cannot be removed.
Only the exact application's private prefix is scanned, never public objects or
legacy local files. The default grace period is **72 hours**, and the minimum is
**24 hours**. Increase it with `--grace-hours 168`, for example.
Preview does not write database rows, object metadata or file bytes.
Report files are created with owner-only permissions and are never overwritten.
Treat the report as sensitive operational data and review the candidate list.

## Apply the reviewed report

Deletion is irreversible. Back up important files first. Only after inspecting
the report, explicitly run:

```sh
pnpm --filter @workspace/api-server storage:inventory --apply /tmp/private-files-report.json --confirm-delete
```

Apply considers only candidates in that report. For each one it checks the
current prefix, references in all private-file tables (including task attachments),
age, generation and metageneration again.
It never edits or removes application metadata to make a file eligible.
Per-object PostgreSQL locks protect uploads from object creation through commit;
table locks also protect concurrent inserts/updates by other database writers.
Busy objects/tables are skipped without waiting. Generation preconditions prevent
deleting replacement bytes. Changed objects need a fresh report.

The result counts deleted, missing, referenced, recent, changed and busy objects.
Unexpected storage/database errors stop the run; earlier deletions remain deleted.
Reapplying the same report is safe: deleted objects are counted as missing.
Create and review a new inventory to reconsider skipped or newly orphaned objects.
If an upload fails or its commit response is lost, its bytes are deliberately left
for later inventory rather than risking deletion of a committed upload.

## Tests

```sh
pnpm --filter @workspace/api-server test:storage
```

Tests use a separate database/schema and a random `vernatun-test` subprefix for
each run. Time is advanced in memory to exercise aging; object metadata is not
modified to make objects old.
