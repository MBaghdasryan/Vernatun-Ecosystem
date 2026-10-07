# Platform Operations completion

Status after the first implementation increment. The eight-phase prompt is
**not complete**. Phase 1 has a working foundation, not full log-source coverage.

| Feature | Status | Real/Test/Stub | Notes |
|---|---|---|---|
| Permissions | COMPLETE | Real + isolated tests | Granular catalog, platform scope, MFA/effective permissions preserved |
| System overview | PARTIAL | Real | Actual runtime/database/pool metrics; unavailable values explicit |
| Health | PARTIAL | Real | API/DB evidence; external provider probes not implemented |
| Logs | PARTIAL | Real + isolated tests | API/auth/security metadata and jobs; filters/paging; no external log drain |
| Log exports | PARTIAL | Real + isolated API tests | JSON/CSV download UI; applied filters; mandatory range ≤31 days, ≤5000 rows and ≤5 MiB; audited; large background exports not implemented |
| Redaction | COMPLETE | Real + isolated tests | No arbitrary payloads, secrets, query values or raw stacks; trusted basename/line/column extraction only |
| Error Center | COMPLETE for captured API/job errors | Real + isolated tests | Grouping, counters, details, audited open/resolved lifecycle, event environment, API build ID and reduced safe call locations; not full crash/external-source monitoring |
| Jobs | PARTIAL | Real + isolated tests | Existing three periodic jobs instrumented; no persistent queue/retry/cancel |
| Backup | PARTIAL | Existing real CLI | Developer/test paired SQL + files tools, no Operations UI/policies yet |
| Restore | PARTIAL | Existing isolated tools | No production restore workflow introduced |
| Cache | NOT IMPLEMENTED | — | No management UI or provider abstraction for clearing |
| Sessions | NOT IMPLEMENTED | Existing auth unchanged | No new platform session administration |
| OpenAPI | PARTIAL | Real generated contract | New endpoints included; interactive API Center not built |
| API Clients | NOT IMPLEMENTED | — | Phase 4 |
| API Keys | NOT IMPLEMENTED | — | Phase 4 |
| Webhooks | PARTIAL | Existing Resend real implementation | No generic outbound webhook framework |
| Integration Registry | NOT IMPLEMENTED | — | Existing provider boundaries preserved |
| Secret Storage | PARTIAL | Existing runtime secrets | No database-encrypted integration secret vault/UI |
| Modules | PARTIAL | Existing entitlements | Registry/dependency UI not yet extended |
| Extensions | NOT IMPLEMENTED | — | No arbitrary plugin execution |
| Update Upload | NOT IMPLEMENTED | — | Phase 7 |
| Update Validation | NOT IMPLEMENTED | — | Phase 7 |
| Update Installation | NOT SUPPORTED BY CURRENT DEPLOYMENT | — | No safe runtime replacement; later staging → manual publish |
| Rollback | PARTIAL | Existing platform/checkpoint and isolated recovery tools | No new paired application/database rollback workflow |
| Environment | NOT IMPLEMENTED | — | Only safe environment-kind metric; no secret inspection |
| Payments integration framework | PARTIAL | Existing business ledger only | General provider-capability framework still to build |
| Concrete payment provider | NOT IMPLEMENTED | — | Intentionally excluded by prompt |
| Bank integration framework | PARTIAL | Existing manual imports only | General provider interface still to build |
| Concrete bank provider | NOT IMPLEMENTED | — | Intentionally excluded by prompt |
| Manual bank statement import | COMPLETE | Existing implementation, unchanged | Not re-tested or modified in this increment |

Next scope in prompt order: finish Phase 1 source coverage/health evidence and
log retention, then Phase 2 Backup Center using existing paired snapshot tools.
Do not equate existing CLI support with a completed administrative workflow.

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
- Phase 1 is still incomplete: additional log sources/health probes, retention
  and large background exports remain. No production deployment or live email.
