---
name: Archived-script execution
description: Working-directory behavior when executing legacy scripts nested inside a pnpm workspace package.
---

For an unregistered legacy project nested inside a workspace package, `pnpm exec` can execute from the owning package directory rather than the directory selected by shell `cd`.

**Why:** A legacy test runner with archive-relative paths was resolved from the outer API package and failed before running. Direct Node execution from the archive directory preserved the expected working directory.

**How to apply:** When legacy scripts depend on relative paths, preserve their original working directory and invoke their runtime directly instead of relying on `pnpm exec` to retain that directory. Do not relocate the restored scripts solely to work around this behavior.

Run full remote-storage/backup QA as a background process and wait for its completion rather than using one foreground shell's five-minute limit.

**Why:** App Storage restore/deletion checks can exceed that total limit even when completed test cases pass. Forced termination can prevent the runner's finally cleanup from running.

**How to apply:** Distinguish an interrupted suite from a failing assertion. After interruption, prove the exact runner-owned test schema/files before cleanup; never drop arbitrary test schemas or touch application data.

Serialize isolated API and browser harness runs until their fixture-output files are also run-scoped.

**Why:** Separate database schemas do not isolate a shared generated credential file. Seeding a second harness can replace credentials while the first browser still needs them.

**How to apply:** Finish and gracefully clean up the browser sandbox before starting another seeded suite; database isolation alone is not sufficient.
