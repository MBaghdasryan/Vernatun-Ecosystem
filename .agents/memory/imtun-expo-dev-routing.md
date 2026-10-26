---
name: ImTun Expo development routing
description: Keep local Expo Go sessions on the Replit development API rather than the shared production API.
---

The shared `EXPO_PUBLIC_DOMAIN` may point at Vernatun's production API. The ImTun development workflow must explicitly set its API base to `REPLIT_DEV_DOMAIN` and its Expo Go proxy to `REPLIT_EXPO_DEV_DOMAIN`; do not infer these from `EXPO_PUBLIC_DOMAIN` or use the misspelled `REPL_DEV_DOMAIN`.

**Why:** A Replit preview inherited the shared production host, so an Expo Go session could authenticate against the wrong environment. Runtime-managed Replit domain names are distinct from the shared app environment.

**How to apply:** When editing or restarting the local Expo workflow, verify the generated Expo Go URL uses `REPLIT_EXPO_DEV_DOMAIN` and the API client uses `REPLIT_DEV_DOMAIN`. Keep production EAS profiles on their explicit production API URL.
