---
name: Migration lineage
description: Check upstream deployment history before assigning a migration number or aligning local names.
---

Check the GitHub deployment branch as well as the workspace before choosing the next migration number. Preserve upstream migration bytes and names; do not reuse a number just because its file is absent locally.

**Why:** The workspace once had a pipeline migration under an earlier duplicate number while GitHub already reserved its later number. Assigning resident changes from the local listing alone collided with that upstream history.

**How to apply:** Compare exact checksums before restoring upstream names. A controlled development-only filename reconciliation may change ledger names only when old/new contents match exactly and target entries are absent. Never silently rename production history, rewrite its checksums, add dummy migrations, or hide unexpected existing tables with broad `IF NOT EXISTS`.
