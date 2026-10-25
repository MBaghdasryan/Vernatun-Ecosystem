# Vernatun release pipeline contract

The Operations Center never extracts a release into the running service. It
hands the validated ZIP to a separate HTTPS release runner, which builds and
deploys an immutable container image through Coolify. Configure these values
only after the runner and the target Coolify resources are ready:

- `VERNATUN_RELEASE_PIPELINE_URL` — HTTPS endpoint that accepts one release job.
- `VERNATUN_RELEASE_PIPELINE_TOKEN` — pipeline bearer token, stored as a secret
  on the API service and in the runner's secret store. Use at least 32 characters.
- `VERNATUN_RELEASE_CALLBACK_URL` — public HTTPS base ending in
  `/api/system/updates`, for example `https://api.example.org/api/system/updates`.
  The API appends `/{updateId}/pipeline-result`.

The API reports only whether the pipeline is configured. It never returns any
endpoint token or callback token.

## Dispatch request

The API sends a `POST` with `Authorization: Bearer <pipeline-token>`,
`Idempotency-Key`, and the following headers:

| Header | Meaning |
| --- | --- |
| `X-Vernatun-Action` | `deploy` or `rollback` |
| `X-Vernatun-Update-Id` | Update record UUID |
| `X-Vernatun-Job-Id` | Stable UUID for this dispatch; also the idempotency key |
| `X-Vernatun-Callback-Url` | Per-update callback URL |
| `X-Vernatun-Callback-Token` | Random one-release callback credential |
| `X-Vernatun-Artifact-SHA256` | ZIP checksum already verified by the API |
| `X-Vernatun-Backup-Id` | Completed, verified backup selected during staging |
| `X-Vernatun-Schema-Version` | Migration baseline checked immediately before dispatch |

For `deploy`, the body is the exact ZIP bytes (`application/zip`). The version
and migration flag are in `X-Vernatun-Version` and
`X-Vernatun-Migrations-Required`. For `rollback`, the body is JSON containing
the current and target image digests, backup UUID, schema version and original
artifact checksum.

The receiver must deduplicate by `Idempotency-Key`, verify the ZIP checksum,
and return HTTP `202` with `{"jobId":"<same UUID>"}` only after it has durably
accepted the job. A 4xx response means it rejected the request. A timeout, 5xx,
redirect or malformed acceptance response is treated as uncertain; the API
does not automatically resend it.

## Required deployment sequence

1. Treat each accepted ZIP as immutable. Validate its manifest again and build
   an OCI image identified by `repository@sha256:<digest>`. Retain the previous
   image and its immutable reference. Never deploy a mutable `latest` reference.
2. Before changing the active Coolify resource, confirm the supplied backup is
   still completed and verified. Check the exact database migration baseline
   and run `pnpm --filter @workspace/api-server run db:migrate:coolify:plan`.
   Stop on unknown migration history, checksum drift or schema drift.
3. If the manifest requires migrations, apply only the pending migrations from
   the reviewed release using the explicit Coolify migration step. The runner
   must set `VERNATUN_COOLIFY_MIGRATION_CONFIRM=APPLY` only for that job and
   confirm the resulting schema state before switching the image. Do not seed,
   reset or restore the live database.
4. Point the Coolify application resources at the immutable image, trigger the
   deployment, and wait for configured container health checks. Also verify the
   public API and web health endpoints. A process start alone is not success.
5. On any failed check, restore the previously recorded image using the
   Coolify rollback/deployment API supported by the configured resource, then
   verify that the old image is healthy. Report rollback success only after that
   check passes. Do not roll back database data or delete data as part of an
   application rollback.

Coolify rolling updates can keep the old container while checking a replacement
for eligible non-Compose resources with a configured health check. Docker
Compose resources use a different replacement path; validate their behavior on
a staging resource before enabling this pipeline.

## Final callback

When the job is complete, send a JSON `POST` to the supplied callback URL with
`Authorization: Bearer <X-Vernatun-Callback-Token>`. The API accepts one final
result and safely ignores an identical retry. The one-release callback token
expires 24 hours after dispatch. The body shape is:

```json
{
  "jobId": "the-dispatch-uuid",
  "result": "deployed",
  "backupId": "the-staged-backup-uuid",
  "deploymentId": "Coolify deployment identifier",
  "releaseRef": "registry.example/vernatun@sha256:<64 lowercase hex characters>",
  "previousReleaseRef": "registry.example/vernatun@sha256:<64 lowercase hex characters>",
  "migration": {
    "preflight": "passed",
    "driftFree": true,
    "baselineVersion": "038_update_release_pipeline.sql",
    "schemaVersion": "038_update_release_pipeline.sql",
    "result": "not_required"
  },
  "healthCheck": {"status": "passed", "checkedAt": "2026-10-22T12:00:00.000Z"},
  "rollback": {"status": "not_required", "releaseRef": null}
}
```

Allowed results are `deployed`, `deployment_rolled_back`,
`deployment_failed`, `rollback_succeeded`, and `rollback_failed`. A successful
deployment requires a clean migration preflight, a passed health check, and
both immutable release references. `deployment_rolled_back` requires a failed
health check and a verified restore of the previous image. The callback is
rejected if the job, selected backup, migration baseline, action, or required
evidence does not match the active request. Callback outcomes and rejected
results are written to the system audit log.

The API records pipeline acceptance and reported results; it cannot independently
verify that a remote runner told the truth. Keep the runner restricted to the
Vernatun resources and perform the first rollout and rollback on a staging
resource before configuring production secrets.

## Coolify references

- [Docker image references](https://coolify.io/docs/applications/deployments/docker-image)
- [Health checks](https://coolify.io/docs/applications/configuration/health-checks)
- [Rolling updates](https://coolify.io/docs/applications/deployments/rolling-updates)
- [Rollback API](https://coolify.io/docs/api/endpoints/applications/rollback-application-by-uuid)
