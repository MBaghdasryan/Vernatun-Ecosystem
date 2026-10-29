---
name: Migration lineage
description: Check upstream deployment history before assigning a migration number or aligning local names.
---

Check the GitHub deployment branch as well as the workspace before choosing the next migration number. Preserve upstream migration bytes and names; do not reuse a number just because its file is absent locally.

Also compare the development database migration ledger: different feature branches can reserve the same number even when their local migration directories look current.

When a migration recreates a view, preserve the latest definition's full behavior, not just its columns and joins. Earlier definitions can silently drop later ordering or evidence rules.

**Why:** The workspace once had a pipeline migration under an earlier duplicate number while GitHub already reserved its later number. Assigning resident changes from the local listing alone collided with that upstream history.

**Why:** The applied development ledger can contain a migration that was not visible in the feature branch where another migration was being added.

**Why:** Replacing a delivery view with an older definition regressed event-priority behavior even though the view still compiled and returned the same columns.

**How to apply:** Compare exact checksums before restoring upstream names. A controlled development-only filename reconciliation may change ledger names only when old/new contents match exactly and target entries are absent. Never silently rename production history, rewrite its checksums, add dummy migrations, or hide unexpected existing tables with broad `IF NOT EXISTS`.

**How to apply:** Before assigning a number or applying it, compare GitHub, the local migration directory, and the target database ledger. If any source reserves that number, choose the next available one; never rewrite applied history.

**How to apply:** Search later migrations and behavioral tests for the most recent view definition before replacing it; add assertions for the semantics that must remain stable.
