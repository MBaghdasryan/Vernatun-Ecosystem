---
name: Archived-script execution
description: Working-directory behavior when executing legacy scripts nested inside a pnpm workspace package.
---

For an unregistered legacy project nested inside a workspace package, `pnpm exec` can execute from the owning package directory rather than the directory selected by shell `cd`.

**Why:** A legacy test runner with archive-relative paths was resolved from the outer API package and failed before running. Direct Node execution from the archive directory preserved the expected working directory.

**How to apply:** When legacy scripts depend on relative paths, preserve their original working directory and invoke their runtime directly instead of relying on `pnpm exec` to retain that directory. Do not relocate the restored scripts solely to work around this behavior.
