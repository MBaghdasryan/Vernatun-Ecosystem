---
name: Managed runtime ownership
description: Avoid orphan listeners and artifact-relative command mistakes during managed restarts.
---

Managed artifact commands run inside the artifact directory, not the workspace root. Prefer one direct Node owner per service over shell → pnpm → watcher/server chains, with graceful shutdown and parent-death handling.

**Why:** Web/API remained healthy while managed restarts failed with occupied ports: old launcher grandchildren retained their listeners after the workflow owner exited. A root-relative replacement command also failed because the manager's working directory was the artifact.

**How to apply:** Keep the existing managed service names and production model. Verify both listener health and reproducible managed restart. Identify a development process by command and directory before retiring it; do not kill an unknown listener or replace data merely because a port is occupied.

An imported build script must await its build at module top level (or expose an awaited promise). Awaiting import alone does not wait for a fire-and-forget build.

**Why:** The owner could import the previous bundle while a fresh build was still running: TCP/health checks passed but new authenticated routes returned 404.

**How to apply:** After changing startup/build ordering, check an authenticated new route as well as process and health status; do not infer fresh-code readiness from a healthy old listener.
