# Platform Operations completion

Current implementation status. The eight-phase prompt is
**not complete**. Phase 1 has a working foundation, not full log-source coverage.

| Feature | Status | Real/Test/Stub | Notes |
|---|---|---|---|
| Permissions | COMPLETE | Real + isolated tests | Granular catalog, platform scope, MFA/effective permissions preserved |
| System overview | PARTIAL | Real | Actual runtime/database/pool metrics; unavailable values explicit |
| Health | PARTIAL | Real | API/DB evidence, bounded cached read-only private-storage probe and email history; no send or integration connectivity tests |
| Logs | PARTIAL | Real + isolated tests | API/auth/security metadata and jobs; filters/paging; no external log drain |
| Log exports | PARTIAL | Real + isolated API tests | JSON/CSV download UI; applied filters; mandatory range ≤31 days, ≤5000 rows and ≤5 MiB; audited; large background exports not implemented |
| Redaction | COMPLETE | Real + isolated tests | No arbitrary payloads, secrets, query values or raw stacks; trusted basename/line/column extraction only |
| Error Center | COMPLETE | Real + isolated tests | For captured API/job errors: grouping, counters, details, audited lifecycle, event environment, build ID and safe call locations; not full crash/external-source monitoring |
| Log retention | COMPLETE | Real + isolated tests | Opt-in, disabled by default; typed confirmation, recent authentication, revision check, audited batches of ≤500; preserves recurrence watermarks and business audit |
| Jobs | PARTIAL | Real + isolated tests | Original jobs, log retention, backup worker, scheduler and backup retention observed; backup queue persists; generic retry/cancel remains incomplete |
| Backup | PARTIAL | Real + isolated tests + development App Storage verification | UI, encrypted bounded builders, queue, verification/download/delete, Local/AppStorage/S3 adapters and periodic policies with opt-in retention; recovery drill and update-triggered backup remain unfinished |
| Restore | PARTIAL | Existing isolated tools | New package format has no full restore workflow yet; integrity verification is not a restore rehearsal; no production restore |
| Cache | COMPLETE | Real + isolated tests | Actual storage-health cache only; process-scoped Memory provider, audited clearing, Redis adapter boundary tested but not connected; no imaginary org/user caches |
| Sessions | COMPLETE | Real + isolated tests | Platform-only list/count/filter/paging, timestamps, coarse device, single/user revocation with confirmation and recent auth; late-save resurrection prevented |
| OpenAPI | PARTIAL | Real generated contract | New endpoints included; interactive API Center not built |
| API Clients | NOT IMPLEMENTED | — | Phase 4 |
| API Keys | NOT IMPLEMENTED | — | Phase 4 |
| Webhooks | PARTIAL | Existing Resend real implementation | No generic outbound webhook framework |
| Integration Registry | NOT IMPLEMENTED | — | Existing provider boundaries preserved |
| Secret Storage | PARTIAL | Runtime secrets + tested cryptographic foundation | AES-256-GCM purpose-bound envelope with independent key; development encryption validated; no integration vault CRUD/UI or managed rotation yet |
| Modules | PARTIAL | Existing entitlements | Registry/dependency UI not yet extended |
| Extensions | NOT IMPLEMENTED | — | No arbitrary plugin execution |
| Update Upload | NOT IMPLEMENTED | — | Phase 7 |
| Update Validation | NOT IMPLEMENTED | — | Phase 7 |
| Update Installation | NOT SUPPORTED BY CURRENT DEPLOYMENT | — | No safe runtime replacement; later staging → manual publish |
| Rollback | PARTIAL | Existing platform/checkpoint and isolated recovery tools | No new paired application/database rollback workflow |
| Environment | COMPLETE | Real + isolated tests | Fixed allowlist of runtime/provider modes and secret configured/not-configured flags, no arbitrary environment enumeration |
| Payments integration framework | PARTIAL | Existing business ledger only | General provider-capability framework still to build |
| Concrete payment provider | NOT IMPLEMENTED | — | Intentionally excluded by prompt |
| Bank integration framework | PARTIAL | Existing manual imports only | General provider interface still to build |
| Concrete bank provider | NOT IMPLEMENTED | — | Intentionally excluded by prompt |
| Manual bank statement import | COMPLETE | Existing implementation, unchanged | Not re-tested or modified in this increment |

Next scope: safe recovery/drill for encrypted packages, remaining Phase 1 source
coverage/health evidence and large exports, then outstanding API/integration/update work.
Do not equate existing CLI support with a completed administrative workflow.

## Storage, cache, sessions, retention and encryption increment

- Storage checks are read-only and prefix-scoped. They do not download private
  contents, create objects or expose bucket names. Success verifies read access,
  not write permissions, physical byte counts or recoverability. Responses are
  bounded by a 3-second observation deadline and cached, including failures, for
  60 seconds in the current API process. Multi-instance invalidation is not
  claimed: the UI explicitly identifies process-local scope.
- Session administration exposes only one-way public references, never the
  session cookie/token. New sessions record issuance, minute-resolution activity
  and coarse browser/device classes; historical unknown values remain null.
  No raw User-Agent or IP is stored by this feature. Revocation and audit commit
  together; persistent revocation markers prevent in-flight requests from
  resurrecting a revoked login. Marker cleanup is not implemented.
- Retention starts disabled with a saved 30-day proposal. Administrators can
  choose 7–3650 days, must reauthenticate when needed and type RETENTION.
  This authorizes future irreversible deletion of operational logs only.
  The app does not silently enable deletion during installation.
  A bounded worker adjusts error-group acknowledgement counts under locks,
  preserving open recurrences while pruning; business audit is untouched.
- The encryption foundation requires VERNATUN_OPERATIONS_ENCRYPTION_KEY,
  a separate 32-byte random key encoded as 64 hex characters. It never falls
  back to SESSION_SECRET, stores the key in a database or includes it in an
  envelope. See OPERATIONS-ENCRYPTION.md. This does not mean Backup Center or the
  integration vault has been completed.
- Twelve isolated System test groups and both type checks passed. Tests cover
  provider-scoped cache deletion, permission denial, current/unmatched session
  references, late-session resurrection, retention opt-in and bounded batches,
  recurrence after pruning, ciphertext tampering and purpose isolation.
  Additive development migrations preserved the 13 legacy-table fingerprints.
  No production migration, real email or working-data deletion was performed.

### Email health evidence

- Overview and Health show last provider acceptance, confirmed sent and confirmed
  delivered timestamps separately, plus rolling 24-hour failed/bounced/complained/
  delayed message counters and recently created unknown transport outcomes.
- These are historical observations across all providers and account scopes, not
  a connectivity probe or proof that the current sending domain is ready.
  The UI explains this distinction in Armenian, Russian and English.
- Each event counter counts distinct matched accepted messages, not webhook calls.
  A message can appear in several categories. Event counters use occurrence time;
  unknown outcomes use message creation time. Unknown does not mean failed.
- Local outbox and unmatched webhook events cannot establish delivery. Query
  failures return unavailable values, not zero counts; no recipients, sender
  addresses, scopes, message identifiers or SQL errors reach these metrics.
- No provider calls, sends, schema changes or production modifications. Eight
  isolated System API test groups and API/web type checks passed. Existing
  polling, access checks and refresh buttons cover these added metric rows.
- Remaining Phase 1 scope includes storage health, other source coverage,
  retention and large background exports; email connectivity remains unprobed.

## Acceptance evidence for this increment

- Isolated System API suite: four test groups passed; migration preservation
  checks passed for 13 existing tables. Type checks and frontend build passed.
- Browser: admin access, four tabs, refresh, filters, request-ID lookup, validation,
  pagination and direct navigation passed. Support users have no System navigation
  and cannot open the protected page.
- A real forbidden API request from an isolated support session returned 403;
  the admin Security log showed the same request UUID. Client-only route rejection
  does not make an API request and therefore does not create an API security event.
- Mobile Logs at 390px: document and body width 375px after the fix, with no
  page-level horizontal overflow. Wide tables scroll within their own container.
- No real email was sent. No production migration or deployment was performed.

### Bounded log export increment

- Five isolated System API test groups passed, including export filters, JSON and
  CSV responses, audit records, permission denials, invalid date ranges, 5001-row
  rejection, CSV formula escaping and a separate export rate limit.
- Export requires both `logs.read` and `logs.export` in a platform context.
  Anonymous, support without permission and tenant contexts are denied.
- Files contain only the same allowlisted metadata as Logs. Successful export
  is audited before returning data; free-text filters and exported rows are not
  copied into business audit. Failed/oversized exports return no partial file.
- UI offers JSON/CSV only to permitted users, uses the applied filters (not
  unsaved edits), and downloads the returned content locally. Pending requests
  are aborted when the Logs component unmounts.
- Type checks passed for API and web. The download buttons have not yet had a
  separate authenticated browser acceptance pass; previous browser acceptance
  above applies to the original Logs flow, not this export increment.

### Error Center increment

- `/console/system/errors`: grouped error/fatal records from retained operational
  history, open/resolved filters, 50-group pagination and latest 50 event details.
- Fingerprints use stable metadata, not actor IDs or arbitrary exception text.
  Message is the safe error code or event name. First/last seen, occurrences,
  affected user/organization counts and latest request ID are real aggregates.
- Viewing requires `logs.read`; changes additionally require `logs.manage`.
  Default status-management permission belongs only to platform admin.
- Resolution records and audit entries commit atomically. Revision plus event
  watermark checks reject stale updates (409); concurrent updates are serialized.
  New events reopen resolved groups without deleting their resolution history.
- Initially version/stack were unavailable. The subsequent diagnostics increment
  below adds event-time metadata without backfilling old events.
- Six isolated API test groups passed, including recurrence, concurrent status
  changes, permission denial, detail lookup, paging and export regression coverage.
  Migration preservation checks passed for 13 legacy tables before and after
  applying the additive development migration. No production migration was run.
- Authenticated browser acceptance passed on an isolated QA schema: direct
  navigation, a three-occurrence group and details, resolve confirmation,
  resolved filter, persisted state after reload, reopen, open filter, Back/Forward.
  At 390px, document width equals client width (375px); wide tables scroll locally.
  Support-role denial was covered by API tests, not repeated in this browser pass.

### Event-time diagnostics increment

- Additive migration adds nullable diagnostics; it does not rewrite old events.
  Newly captured events store environment and a public API build ID. Source-mode
  execution explicitly has no compiled build ID; no semantic release or frontend
  version is inferred.
- API error middleware and observed job failures use one redactor. Only up to 12
  allowlisted source basenames and positive line/column coordinates survive.
  Exception messages, functions, absolute paths, remote URLs, query strings,
  unknown files and nested causes are not persisted.
- Header metadata belongs to the latest event; per-event details expose each
  retained event's own values. Missing values remain “not recorded”.
- Seven isolated API test groups and both type checks passed, including synthetic
  sensitive values, malformed/remote frames, throwing stack getters, frame limits,
  job capture and legacy null preservation. Development migration preserved the
  same 13 legacy table fingerprints.
- A request to the running compiled development API confirmed persisted build ID
  and event environment. New per-event expanders were checked in code/types; the
  earlier browser pass covers the unchanged Error Center lifecycle, not a fresh
  browser pass over these expanders.
- Phase 1 is still incomplete: additional log sources/health probes
  and large background exports remain. No production deployment or live email.

## Encrypted Backup Center increment

- `/console/system/backups` provides actual registry/readiness, queue creation,
  verification, encrypted download and retention-protected deletion.
- Creation requires read/create rights, recent authentication and BACKUP.
  Deletion requires read/delete rights, recent authentication, DELETE BACKUP and
  expiration of the minimum 30-day hold. Audit history is retained.
- A database-backed single pending queue survives a process restart. An
  interrupted running job becomes failed, never completed. Worker errors are
  visible in both the backup registry and the job history.
- Consistent snapshots use short-wait table/advisory locks; a busy database/file
  aborts the attempt. Private objects missing from the source make the snapshot
  fail. Reference coverage includes document versions and organization logos.
- Logical contents are bounded to 64 MiB and 5000 private files. SQL dumping has
  a 60-second process deadline; file acquisition checks a 120-second cumulative
  budget and a 5-second per-read deadline. These limits intentionally reject
  oversized work rather than claiming a scalable archival service.
- AES-GCM packages authenticate the snapshot identity and per-component
  checksums; written ciphertext is read back before the registry says completed.
  Source-inclusive packages exclude environment files, secrets directories,
  installed dependencies and compiled output. Published runtimes without source
  cannot create that kind. Manual rebuilding and environment configuration are
  still needed for recovery.
- Fourteen isolated API/test groups passed, including real encrypted local
  round-trip and binary download, protected deletion, corruption detection,
  custom-format PostgreSQL dump and missing referenced-file failure. Both app
  type checks passed. Development migration preserved all 13 legacy fingerprints.
- Browser acceptance passed for cache, sessions, environment and retention at
  390px and 1280px, including current-session revocation. The new Backup Center
  browser check also passed at both widths: missing-key warning, disabled
  creation, no fake success and no unsafe restore action. The successful-create
  UI journey has not been browser-tested; its backend was tested in isolation.
  The missing-key browser result above predates key configuration. On 2026-10-07
  the supplied development key passed validation and an authenticated roundtrip.
  A real configuration package was created via the application worker, written to
  private App Storage and read-back verified. Its queued/completed audit records
  identify the operator readiness check; no user identity was impersonated.
  This was not a browser create-flow test or a production/recovery test.
- Still incomplete after that increment: schedules/policies, recovery workflow and drill for the new
  package, integration vault, key rotation, API Center, Modules and Updates.
  Do not mark the eight-phase prompt complete.

## Backup verification and overview follow-through

- PostgreSQL components now undergo bounded `pg_restore --file=/dev/null`
  decoding before a stored package is considered verified. This executes no SQL
  and does not connect to a restore target. It is stronger than checksum/header
  validation, but is explicitly not a recovery rehearsal.
- Overview and Health now show the most recent completed, verified backup:
  timestamp, kind, byte size and age. A copy whose verification subsequently
  fails is excluded. Configuration-only copies are labelled by kind and do not
  imply that business records or uploaded files are protected.
- Encryption readiness is reported separately. Backup storage provider mode is
  visible, but its health remains unavailable without an actual dedicated probe;
  successful configuration is not reported as live storage health.
- Both application type checks and all 14 isolated system test groups passed,
  including genuine PostgreSQL archive decoding, malformed archive rejection,
  latest-backup metrics and exclusion of failed verification.
- No restore, production deployment, email send or retention deletion occurred.

## Periodic backup policies

- Additive migration checked in isolation and applied to development; all 13
  legacy-table fingerprints preserved. All five live policies remain disabled.
- Daily/weekly/monthly UTC scheduling, one global pending/running queue,
  coalesced missed intervals, chosen configured provider, revision-guarded edits.
- Opt-in retention: minimum 30 days and original hold both enforced; newest
  keep-last verified copies retained; manual copies and failed evidence excluded.
  At most one expiry per pass, durable audit intent and final event, bytes removed
  only for the selected scheduled copy. Policy and verification changes serialize
  with the expiry decision.
- Backup Center has HY/RU/EN policy controls, recent-authentication flow, typed
  confirmation and additional irreversible-deletion acknowledgement. Disabling
  remains possible when encryption/storage configuration becomes unavailable.
- All 15 isolated system test groups and both application type checks passed.
  Tests cover disabled defaults, denied access, invalid retention, stale revision,
  concurrent scheduler calls, queue bounds, original hold, keep-last preservation,
  expiry audit, and retention excluding manual copies. Destructive checks used
  disposable test storage only.
- Browser acceptance on an isolated schema confirmed invalid-day/phrase rejection,
  draft preservation across polling, save/reload persistence, enabling a daily
  schedule, irreversible-deletion acknowledgement and final disabled settings.
  No overflow at 390/768/1024/1440px. No copies were created/deleted by browser QA.
  The discovered Yerevan-time-plus-UTC-label mismatch was corrected with explicit
  UTC formatting and checked separately; no second full browser pass was run.
  Logout could not be confirmed because the workspace restarted at that step;
  the isolated schema was subsequently removed, not any working account.
- Remaining: recovery workflow/drill, pre-update trigger, API Center, integration
  vault, Modules/Extensions, Update Center, and remaining overall QA coverage.
