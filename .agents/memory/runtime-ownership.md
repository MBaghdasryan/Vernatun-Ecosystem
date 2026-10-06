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

Browser QA can be interrupted independently of application correctness.

**Why:** During a long acceptance run, a browser worker was lost, the preview
returned 502, and both managed services were NOT_STARTED. Restoring the existing
services recovered a fresh anonymous login capture without any code changes;
an old browser context still reported a failed resource.

**How to apply:** Check service status and the exact failed resource before
changing ports or application code. Restore the existing managed services once,
verify a fresh capture and public asset responses, then resume only unfinished
checks with the mutation guard reinstalled. A previous context's 502 alone does
not establish an application defect.

Keep preservation evidence that must survive QA outside temporary directories;
store only counts/digests, never raw rows or credentials.

**Why:** The same worker loss removed the temporary before-migration digest
baseline. An earlier successful comparison remained valid, but could not be
repeated afterward.

**How to apply:** Do not regenerate a missing baseline from current data and
claim it proves before/after preservation. Record the evidence gap explicitly.
