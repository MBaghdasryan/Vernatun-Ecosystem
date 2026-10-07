# Update system — deployment boundary

Status: package upload/validation/staging/history are **not implemented** in this
increment. Runtime replacement of application code is **not supported by current
deployment**. The project still uses managed Replit publishing.

The eventual Update Center must validate the manifest, package type, allowed
paths, checksums and compatibility before staging anything. It must reject
traversal, symlinks and archive expansion abuse. Uploading a package must not
execute its contents or install database migrations.

Before application/database change, a real matching data backup must be
confirmed and recorded, not inferred from a successful SQL dump alone.
Existing paired snapshot/isolated restore tools are the starting point.

On the current deployment, validated packages should reach **Manual deployment
required**. A deployment-provider-specific adapter is needed before any
installation button can claim to apply a release.

Application rollback and database/private-file recovery are separate operations.
Neither a checkpoint nor an application rollback proves a matching database and
private-byte recovery. No destructive restore, production migration, process
restart endpoint or publishing action was added by Phase 1.
