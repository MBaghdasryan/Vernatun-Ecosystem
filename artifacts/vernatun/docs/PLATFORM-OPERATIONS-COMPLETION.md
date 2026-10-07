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
| Redaction | COMPLETE | Real + isolated tests | No arbitrary payloads, secrets, query values or stacks in new log store |
| Error Center | NOT IMPLEMENTED | — | No grouped-error detail center yet; errors visible in logs |
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
