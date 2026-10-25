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

After a worker interruption, previous successful tool/helper messages are not proof that all edits and temporary evidence still exist.

**Why:** Some earlier route wiring and UI edits were absent on reopening, and temporary test logs disappeared after a worker recycle.

**How to apply:** Check specific source markers and service status before continuing. Restore only the existing services; do not seed/reset data or repeat migrations to compensate for a lost worker.

Keep preservation evidence that must survive QA outside temporary directories;
store only counts/digests, never raw rows or credentials.

**Why:** The same worker loss removed the temporary before-migration digest
baseline. An earlier successful comparison remained valid, but could not be
repeated afterward.

**How to apply:** Do not regenerate a missing baseline from current data and
claim it proves before/after preservation. Record the evidence gap explicitly.

Published application files are not a durable in-place update target. Keep
uploaded release packages in private App Storage and send them as immutable
artifacts through a separately configured deployment pipeline; never extract or
execute a package inside the running service. A release is supported only when
that pipeline verifies a current backup and migration baseline, checks health,
and can restore the prior immutable image without reverting database data.

**Why:** Replit's published runtime filesystem is discarded across restart,
redeploy, and republish, so a successful local file replacement could disappear
or diverge from the next deployment. Coolify image rollback restores application
code but does not reverse migrations or recover persistent data.

**How to apply:** Separate package upload/validation/staging from installation.
Require a verified backup before staging and recheck it with the migration state
immediately before dispatch. Keep installation unavailable until the release
pipeline endpoint and callback are configured; never treat staging as release.
