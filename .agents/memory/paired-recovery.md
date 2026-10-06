---
name: Paired private-file recovery
description: Why database checkpoints alone cannot recover Vernatun documents and photos.
---

Treat recovery as one matched SQL-and-private-bytes snapshot. Do not promise
that database rollback restores App Storage or enable production recovery as
part of a development drill.

**Why:** Replit's official documentation describes separate PostgreSQL recovery
and irreversible App Storage deletion. The assigned recovery scope explicitly
requires isolated verification without publishing or changing working data.

**How to apply:** Check current official recovery/storage documentation before
making platform guarantees. Preserve original business keys and permissions;
verify allowed and denied downloads in isolation. The application retention
policy is at least 30 days, independent of Replit database retention. A backup
in the live bucket is not protection against loss of that bucket; a separately
approved independent copy is required for that guarantee.

Verify backup recovery using the working schema layout, not only randomized
test schemas.

**Why:** A successful isolated-schema integration suite did not establish that
a backup of the default schema could actually be restored into a fresh
database. The real development snapshot drill exposed that difference.

**How to apply:** Before relying on a recovery claim or modifying working
data, drill a snapshot of its actual schema and verify all table fingerprints
in a separately allocated target. Do not treat synthetic fixture tests as a
substitute for that drill.
