---
name: Corepack version pinning
description: Replit workspace behavior when the globally installed pnpm differs from the packageManager pin.
---

When validating a pinned pnpm version, invoke it through Corepack rather than the unrelated globally installed pnpm. A global pnpm can try to install or switch itself to the project pin before running commands.

**Why:** In this workspace, pnpm 10 attempted a local version switch before running the check and hit the environment's Node thread limit. Corepack correctly selected the pinned pnpm 9.15.9.

**How to apply:** Use `corepack pnpm ...` for local checks that must follow `packageManager`; CI should install its exact pnpm version explicitly. Keep the package manifest pin and Nixpacks/CI commands aligned.

Native Node thread-creation assertions, `Cannot fork`, and esbuild `EPIPE` across
unrelated services can be symptoms of the global pnpm version-switch recursion
exhausting the shared process/thread budget, rather than defects in those services.

**Why:** Repeated global-pnpm switch processes exhausted this workspace's resources;
checks passed again once the version-switch resource pressure was removed.

**How to apply:** Check shared process pressure before treating simultaneous native
startup failures as code regressions. Use Corepack in post-merge automation as well
as interactive checks.
