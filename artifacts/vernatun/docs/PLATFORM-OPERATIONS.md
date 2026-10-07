# Platform Operations — foundation and audit

## Scope

Continuation from the updated Platform Operations prompt. This is not the
Payments & Utility Billing project. Work stays inside `/console/system`.
The full eight-phase prompt is not complete.

## Existing-system audit

| Area | Existing mechanism | Decision |
|---|---|---|
| Console | Shared portal, product routing and Console navigation | Extend existing shell |
| Identity | Session auth, context selection, MFA policy, effective permission evaluator | Reuse, never introduce admin boolean bypass |
| Data | PostgreSQL, checksum-tracked additive SQL migrations | Add separate observability tables; preserve business rows |
| Audit | Existing immutable business audit | Keep separate from operational logs |
| Storage | Private App Storage, local/S3-compatible provider boundary, authorized file reads | Reuse; do not expose bucket credentials or paths |
| Backups | Matched SQL/file snapshot, manifest/checksums, isolated restore tools | Reuse in Phase 2; current CLI refuses production |
| Email | Replaceable Resend/SMTP/outbox, receipts and signed delivery webhooks | Preserve; no test email while domain is unready |
| Jobs | In-process housekeeping, SLA escalation, maintenance generation | Instrument existing execution, not a second scheduler |
| API | Shared Express stack and generated OpenAPI clients | Extend contract and existing CSRF/auth boundaries |
| Cache | Provider-instance memory and existing policies/rate-limit state | No global cache-clear or session deletion in Phase 1 |
| Modules | Existing module/subscription entitlements | Later registry must preserve existing evaluation |
| Runtime | Managed workflows with one process owner per service | No UI shell execution or process replacement |

## Phase 1 implementation

Granular rights: `system.read`, `system.health.read`, `logs.read`, `jobs.read`.
Additional permissions from the prompt are registered for later phases, but
registration does not mean the feature exists. Only platform_admin receives
them by default. Tenant contexts are denied even if a permission is mistakenly
added. Ordinary support is denied. All access still passes existing MFA/context
and effective-permission checks.

Routes: overview, health, logs, jobs. Corresponding GET APIs live under
`/api/system`. Read limiter: independent `system-read` namespace, 120/min/user.

Real observations: API response, process uptime/start time, Node version,
environment kind, PostgreSQL version/connectivity/size, last migration,
connection-pool counters, dropped log writes, observed job outcomes.
Storage provider and email configuration are configuration evidence, not
proof of external service health. Unprobed or unavailable values remain null.
The overall warning must not be misrepresented as all providers verified.

Logs store an allowlist of technical metadata only. No request bodies, headers,
cookies, query strings, full email, raw URL parameters, secrets or raw stack traces.
Endpoint uses Express's static route template; unmatched paths are not stored.
User/context identifiers are recorded when available; failed login email is
not retained, so account correlation for failed anonymous logins is unavailable.
50-row pagination with server filters, safe parameterized SQL, date/category/
level/actor/org/request/status/endpoint/error/job/free-text filters.
No immutable business-audit records are changed by this viewer.

Actual housekeeping, SLA and maintenance cycles have persisted start/finish/
failure records and a 30-second heartbeat. No heartbeat for two minutes is shown
as interrupted, not completed. This is observability, not a durable work queue.
No arbitrary execution/retry/cancel controls exist. Queued jobs and retries for
backup, import and webhook workflows remain future integration work.

Log writer bounds pending writes to 50 and exposes a dropped count. It deliberately
does not stop business operations when the telemetry database write fails.
Client read timeouts are not a guarantee of PostgreSQL query cancellation.
Retention/archive policies and external log drains remain to implement before
high-volume production use.

## Error Center

The existing System Console includes an Errors tab. Only retained `error` and
`fatal` events are grouped, using category, service, event, route template, method,
HTTP status, safe error code and job name. Group metadata never includes raw
exception messages, credentials or request payloads.

Groups expose counts, affected identities, first/last observation, last request
and safe event details. Marking resolved requires `logs.manage` as well as
`logs.read`; the update and immutable audit entry use one database transaction.
Stale revisions/event counts are rejected. Any additional retained occurrence
reopens the group. “Resolved” is an administrator's acknowledgement, not a claim
that the underlying software has been repaired.

Details display at most the latest 50 events. Full operational history remains
in Logs. New events record their runtime environment and, in a bundled API, its
public build ID. Each build receives a unique ID; it is not a semantic application
release, frontend version or Git revision. Source-mode tests have no build ID.
Pre-existing events retain null metadata; no historical backfill is fabricated.

For captured API exceptions resulting in error/fatal events and observed job
failures, central diagnostics redaction retains at most 12 trusted source
basenames with line/column numbers. It drops messages, function names, absolute
paths, URL/query data and nested causes. Trusted source names come from the code,
not the exception. Remote frames, unknown files and malformed locations are
discarded. This reduced location list is not a complete stack trace.

The group header describes its latest event, not today's runtime. Each of the
latest 50 events has its own expandable diagnostics. Existing logs JSON/CSV
exports include the same safe fields. Native/dependency frames, arbitrary process
crashes and external provider stack collection are outside this capture boundary.

## Backups, restore, cache

Existing developer/test backup utilities are unchanged. No new backup button,
production restore, scheduled backup, encrypted archive UI or global cache
clear is claimed. Session administration is Phase 3, not part of this delivery.

## Deployment constraints

Official Replit documentation consulted: publishing overview, App Storage and
production database/data recovery docs. Published filesystem writes must not
serve as durable backup storage; use persistent storage. App updates require
republishing. Update Center must stage/validate packages and report **Manual
deployment required**, unless a real deployment-provider adapter is implemented.
No runtime code replacement, arbitrary SQL, secret browser, or publishing action
was introduced.

## Verification

`pnpm --filter @workspace/api-server run test:system` checks isolated migration
preservation, anonymous/support/tenant denial, granular deny rules, actual
metrics, unavailable observations, log redaction/pagination/validation, job
success/failure/interrupted states and absence of arbitrary job execution.
The migration preserves fingerprints of 13 legacy business tables.
