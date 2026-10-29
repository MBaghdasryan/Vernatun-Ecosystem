# Billing configuration gap audit

Audit scope: the attached Vernatun OS + ImTun tariff and area/resident billing master prompt, compared with the current finance routes, migrations, and screens.

| Capability | Existing | Backend | Vernatun OS UI | ImTun | Missing | Action |
|---|---|---|---|---|---|---|
| Shared finance and payment ledger | Invoices, invoice lines, payment allocations, adjustments, payer assignments, billing batches, and organization-scoped payment boundaries exist. Published invoices are immutable. | Present and tenant-scoped. Existing row-locking and append-only ledger guards must be preserved. | Finance workspace, batches, payments, reconciliation, and invoice details exist. | Bills and payment views exist. | No replacement engine is needed. | KEEP |
| Services | Organization-scoped service names exist. | Service catalog is minimal; service flags, categories, applicability, and default calculation methods are absent. | Service is implicitly created when a tariff is added. | Charge descriptions are shown. | Explicit service lifecycle and configuration. | EXTEND |
| Tariffs | Amount, currency, and legacy `unit`/`area` basis exist. | Tariffs lack effective dates, version status, units, and replacement lineage. | Existing tariff form has only name, amount, and basis. | No tariff history presentation. | Immutable effective-dated versions and impact review. | EXTEND |
| Billing rules and scopes | Batch billing chooses one tariff for a building and period. | No reusable rules for service, scope, effective dates, count policy, bounds, or rounding. | No dedicated rules workspace. | Not applicable. | Multiple calculation methods, precedence, overlap checks, and organization/building/unit scopes. | BUILD |
| Unit areas | `units.area` is a required positive authoritative value. | No separate legal and billing area history or controlled correction record. | Unit/property records show the current area. | Not explained on bills. | Effective-dated billing area with reason, actor, and audit. | EXTEND |
| Resident billing count | Active owner/renter/family assignments and leases exist, but no authoritative billing-count flag or count snapshot. | No count source/mode, vacant-unit policy, history, or count exceptions. | No billing parameters/review screen. | No count explanation or correction request. | Avoid counting users or guests by default; explicit, effective-dated policy and protected review workflow. | BUILD |
| Calculation and invoice snapshots | Existing batch previews fingerprint their inputs; invoice lines retain quantity, rate, and amount. | Current batch uses one tariff and area/unit quantity; invoice line lacks a full calculation trace. | Preview, draft, warnings, and publish exist. | Basic charge details exist. | Generic resolver, formula snapshot, meter and resident bases, and exact explanation. | EXTEND |
| Drafts, exceptions, and publication | Draft batches, warning acknowledgement, stale-preview protection, and immutable published invoices exist. | No first-class billing-readiness or exception queue for missing/conflicting data. | Draft and publish workflow exists. | Published invoice history exists. | Per-unit/service exceptions and readiness checks. | EXTEND |
| Payer responsibility | Payer assignment and effective delegated payer resolution exist. | Payment beneficiary and merchant are separate from the resident's payer assignment. | Payer tools exist. | Payer/financial views are scoped. | No tariff or amount recalculation when payer changes. | KEEP |
| Access, audit, and localization | Existing RBAC, organization/building/unit context, audit, and HY/RU/EN infrastructure exist. | Finance permissions are enforced on the server. | Existing finance screens are localized. | Resident screens are localized. | Add only server-enforced authorization for new operations; do not trust UI gates. | EXTEND |
| Exports and reports | Existing invoice export and finance tables exist. | No rule-based area/resident reports or calculation-trace export. | No tariff/rule export or billing exception report. | No area/resident monthly explanation ledger. | Add authorized, tenant-scoped reporting after the rule engine is stable. | BUILD |
| Provider activation | Property payment architecture exists; no provider is authorized by this prompt. | Provider setup remains organization-specific and independent from billing calculation. | Existing payment setup may be configured separately. | Payment routes are separate from charge calculation. | No new provider activation is part of this work. | KEEP |

## Implementation constraints

- Extend the existing finance engine and preserve current invoice, payment, adjustment, payer delegation, and batch invariants.
- Additive migrations only; do not rewrite migrations that may already be applied.
- Published invoices and historical calculations remain unchanged; corrections use existing adjustment/reversal workflows.
- Use integer minor-unit money arithmetic and store a complete per-line calculation snapshot.
- Unknown area, resident count, meter reading, or conflicting rules must stop the affected charge and create a visible exception.
- Residents may request review but cannot directly alter tariffs, billing area, resident counts, or published bills.
- Keep platform SaaS fees, organization property charges, utility charges, payment responsibility, and merchant beneficiary as separate domains.

## Implementation status

The configurable billing framework is implemented in source code; it is not production-enabled yet.

- Migration `064_configurable_billing_rules.sql` adds effective-dated tariff/rule versions, unit parameters, resident billing eligibility, service applicability and quantities, manual-charge revisions, and immutable calculation metadata for invoice lines.
- The API supports service/tariff configuration, organization/building/unit rules, rule-based previews and drafts, scoped unit settings, resident parameter-review requests, audited manager decisions, and revisioned manual charges.
- Vernatun OS has configuration, per-unit parameters, manual-charge entry, and a manager review queue. ImTun displays saved calculation details and lets residents submit parameter corrections for review.
- Published invoice calculations remain snapshots. Corrections do not rewrite an already published invoice, and payment merchant/beneficiary settings are not changed by billing rules.
- API tests cover area-based calculation, invoice publication and snapshot retention, manual-charge idempotency and revisions, parameter-review authorization, and service-applicability approval. The API schema also generates typed clients from the new routes.

### Not enabled or not fully accepted

- Migration 064 has been exercised by isolated API tests only. It has **not** been applied to the shared development database or Production. The API returns `billing_configuration_migration_required` until the migration exists.
- No real payment provider was configured or tested. Provider setup, live collection, and settlement verification remain separate work.
- The tested end-to-end calculation path uses area billing and manual charges; the other supported calculation methods, all exception combinations, all role/language/device combinations, and real Android/iOS acceptance still need broader test coverage.
- No Production deployment or database migration was performed as part of this implementation.
