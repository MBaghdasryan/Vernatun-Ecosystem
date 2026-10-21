# Lockfile verification

This workspace pins pnpm 9.15.9 in `package.json`. Coolify's Nixpacks install
phase and the GitHub Actions lockfile workflow both run a frozen install with
that version.

Run the same check locally with:

```sh
corepack pnpm run check:lockfile
```

The check succeeds only when the workspace manifests, package-manager settings,
and `pnpm-lock.yaml` agree. A stale lockfile or configuration mismatch causes
pnpm to exit with an error; the check never updates the lockfile. Regenerate the
lockfile with pnpm 9.15.9 and commit the result when dependencies or relevant
settings change.
