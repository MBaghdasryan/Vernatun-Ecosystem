---
name: Expo workspace dependency recovery
description: Safely restore missing Expo packages and align SDK dependencies in the pnpm monorepo.
---

When Expo cannot resolve a dependency that is already present in its package manifest and lockfile, check the app's actual `node_modules` link and installed package before editing source or adding the dependency again. Restore links for the full workspace with the pinned Corepack pnpm and frozen lockfile; a filtered forced install recreated the root `node_modules` here and temporarily left unrelated workspace dependencies unavailable. Run Expo's SDK compatibility check and Doctor, then restart the managed Expo workflow and verify an actual bundle or preview.

Expo's `install --fix` can use the global `pnpm` executable instead of the repository-pinned Corepack version. Review the manifest/lockfile diff and reconcile the full workspace using Corepack afterward.

**Why:** Expo's missing-module symptom was caused by incomplete installed links, not a missing dependency declaration; changing dependency lists alone would not have fixed Metro and risked altering the shared lock.

**How to apply:** Use this sequence for pnpm workspace Expo startup failures: inspect manifest/lock and installed links → reconcile all workspaces with the frozen lockfile → check SDK versions → restart and test Metro. Avoid filtered `--force` installs unless intentionally rebuilding the whole workspace dependency tree.
