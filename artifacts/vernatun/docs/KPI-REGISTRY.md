# Vernatun role-dashboard KPI registry

This is the human-readable contract for the live cards returned by
`GET /api/role-insights`. The executable definitions and SQL live in
`artifacts/api-server/archive/vernatun/server/kpi-registry.ts`; authorization,
period handling, and response metadata are applied by `server/insights.ts`.

The API returns each displayed card with its definition, query ID, effective
permission, module, scope, `dataState`, and `noDataBehavior`. Permission
alternatives are evaluated against the active role context; the module value
comes from `moduleForPermission` for the effective permission. A missing
module mapping is returned as `null` and does not imply a fictional module
entitlement.

| Card key | Definition | Canonical query ID | Permission | Module | Data scope | Empty / no-data behavior |
|---|---|---|---|---|---|---|
| `organizations` | Count of organizations in the platform database. | `platform.organizations` | `organizations.read` | `null` | Platform | A returned count of `0` is measured, not missing data. |
| `buildings` | Count of buildings in the platform database. | `platform.buildings` | `organizations.read` | `null` | Platform | A returned count of `0` is measured, not missing data. |
| `activeSubscriptions` | Subscriptions with active status whose start and end dates include today. | `platform.active_subscriptions` | `organizations.read` | `null` | Platform | A returned count of `0` is measured, not missing data. |
| `openSupport` | Unresolved support cases. Platform readers see all cases; support operators see cases assigned to them. | `platform.open_support` or `support.assigned_open` | `organizations.read` or `support.cases` (effective permission returned in card) | `null` | Platform or assigned operator | A returned count of `0` is measured, not missing data. |
| `team` | Distinct unblocked users with an active membership and active, currently effective role assignment. | `organization.active_people` | `people.read` | `null` | Organization, building, and unit context | A returned count of `0` is measured, not missing data. |
| `units` | Units in the selected organization, narrowed to the selected building or unit where present. | `organization.units` | `properties.read` or `properties.own` (effective permission returned in card) | `null` | Organization, building, and unit context | A returned count of `0` is measured, not missing data. |
| `activeGrants` | Approved, unrevoked support grants that have not expired. | `support.active_grants` | `support.access.request` | `null` | Authenticated support operator | A returned count of `0` is measured, not missing data. |
| `onboardingRemaining` | Onboarding steps without `completed_at`; platform-wide readers see all, other authorized operators see their assigned steps. | `platform.onboarding_remaining` | `onboarding.manage` | `null` | Platform or assigned operator | A returned count of `0` is measured, not missing data. |
| `pendingInvites` | Invitations not accepted or revoked that remain within their expiry time. | `organization.pending_invitations` | `people.invite` | `null` | Organization, building, and unit context | A returned count of `0` is measured, not missing data. |
| `openRequests` | Resident requests whose status is not `closed`, within the selected location; `requests.own` is additionally restricted to the authenticated author. | `operations.open_requests` | `requests.read` or `requests.own` (effective permission returned in card) | `requests` | Organization, building, and unit; author for own-only access | A returned count of `0` is measured, not missing data. |
| `assignedWork` | Assigned or in-progress work orders assigned to the authenticated technician. | `operations.assigned_work` | `workorders.assigned` | `requests` | Organization, building, unit, and assigned technician | A returned count of `0` is measured, not missing data. |
| `openDefects` | Defects except accepted defects, within the selected location; contractor-only access is restricted to assigned defects. | `operations.open_defects` | `defects.read` or `defects.assigned` (effective permission returned in card) | `handover` | Organization, building, unit, or assigned contractor | A returned count of `0` is measured, not missing data. |
| `reviewDefects` | Defects in `review` status; contractor-only access is restricted to assigned defects. | `operations.review_defects` | `defects.read` or `defects.assigned` (effective permission returned in card) | `handover` | Organization, building, unit, or assigned contractor | A returned count of `0` is measured, not missing data. |
| `handoverReady` | Handover cases whose current status is `ready`. | `operations.ready_handovers` | `handover.read` | `handover` | Organization, building, and unit context | A returned count of `0` is measured, not missing data. |
| `validPasses` | Visitor passes that are not revoked, are not expired, and have not exited; `access.create`-only access sees passes created by that user. | `operations.active_passes` | `access.validate` or `access.create` (effective permission returned in card) | `access` | Organization, building, unit, or creator | A returned count of `0` is measured, not missing data. |
| `charged` | Sum of published invoice charges for the selected currency and optional invoice period. | `finance.published_invoice_totals` | `billing.read` or `billing.own` (effective permission returned in card) | `finance` | Organization, building, unit, or authenticated payer | If no published invoices match, `dataState=no_data`; the API value remains numeric zero for compatibility, but the UI labels it “No data,” not as a verified zero balance. |
| `paid` | Sum of payment allocations applied to the selected published invoices. | `finance.published_invoice_totals` | `billing.read` or `billing.own` (effective permission returned in card) | `finance` | Organization, building, unit, or authenticated payer | If no published invoices match, `dataState=no_data`; UI labels it “No data.” |
| `balance` | Sum of published invoice charges plus adjustments minus payment allocations. | `finance.published_invoice_totals` | `billing.read` or `billing.own` (effective permission returned in card) | `finance` | Organization, building, unit, or authenticated payer | If no published invoices match, `dataState=no_data`; UI labels it “No data.” |

## Rendered-card contract

`RoleHome` renders cards returned by `GET /api/role-insights`; it does not
derive additional KPIs from the current table page. The server chooses cards
using the active role, scope, effective permission, and module. The same key
can appear for different roles with a different permission or scope.

| Card key | Applicable reference(s) | UI destination when separately authorized | Rendered meaning / empty behavior |
|---|---|---|---|
| `organizations` | Platform admin overview and control center | `/console/organizations` (`organizations.read`) | Measured count; `0` is a real result. |
| `buildings` | Platform admin; organization/property roles | `/console/organizations` or `/os/properties` (`organizations.read` or `properties.read`) | Measured in platform or selected tenant scope. |
| `activeSubscriptions` | Platform admin | `/console/subscriptions` (`subscriptions.manage`) | Active-subscription count; no revenue is inferred. |
| `openSupport` | Platform admin or support | `/console/support-cases` (`support.cases`) when authorized | Platform-wide unresolved cases or cases assigned to the support operator. |
| `team` | Organization admin and `people.read` roles | `/os/people` (`people.read`) | Distinct active, unblocked people/assignments in selected context. |
| `units` | Organization admin and property/resident roles | `/os/units` (`properties.read`) when in OS | Measured units in selected organization/building/unit context. |
| `activeGrants` | Support | `/console/support` (`support.access.request`) | Current approved grants for the authenticated operator. |
| `onboardingRemaining` | Platform admin or assigned support operator | `/console/onboarding` (`onboarding.manage`) | Remaining platform steps or only the operator's assigned steps. |
| `pendingInvites` | Organization admin | `/os/invitations` (`people.invite`) | Pending, unexpired invitations in the active OS scope. |
| `openRequests` | Manager, dispatcher, and eligible residents | `/hayat/works` (`requests.read`) when in HAYAT | Open in-scope requests; `requests.own` is author-scoped. |
| `assignedWork` | Technician | `/hayat/works` (`workorders.assigned`) | Assigned work for the signed-in technician; a page preview is not presented as a total. |
| `openDefects` | Developer/manager or assigned contractor | `/os/defects` or `/hayat/defects` (`defects.read` or `defects.assigned`) | Non-accepted defects; contractor results remain assignment-scoped. |
| `reviewDefects` | Developer/manager or assigned contractor | `/os/defects?status=review` or `/hayat/defects?status=review` (effective defect permission) | Review-state defects; the status filter is preselected from the URL over the authorized defect list, including when the filtered result is empty. |
| `handoverReady` | Developer and other authorized handover readers | `/os/handovers` (`handover.read`) | Handover cases whose current status is `ready`. |
| `validPasses` | Security or authorized pass creator | `/hayat/security` (`access.validate`) when in HAYAT | Valid in-scope passes; create-only access sees passes created by that user. |
| `charged` | Accountant, portfolio owner, eligible residents | `/os/finance` (`billing.read`) when in OS | Published invoice charges for selected currency, period, payer, and scope. |
| `paid` | Accountant, portfolio owner, eligible residents | `/os/finance` (`billing.read`) when in OS | Allocations applied to selected published invoices; imported bank rows alone are not paid. |
| `balance` | Accountant, portfolio owner, eligible residents | `/os/finance` (`billing.read`) when in OS | Published charges plus adjustments minus applied allocations. |

The card title is translated from its key. Its registered definition is exposed
as a tooltip and accessible label. A card is clickable only when the separate
destination permission is present; server authorization and module entitlement
remain authoritative. `0` count values are measured. Finance cards with no
matching published invoices show “No data,” not a verified zero. Errors remain
errors. The period selector applies only to the three finance cards.

The reference and authenticated dashboard screenshots were compared in an
isolated QA run. Each reference-to-screen mapping and observed visual difference
is recorded in `REFERENCE-SCREEN-GAP-REPORT.md`; this comparison confirms the
remaining layout gaps and does not claim pixel parity.

## Contract rules

- The optional `period` and `currency` filters affect only the three finance
  cards. They do not imply a trend or a time series.
- A count query that successfully returns `0` is a measured count.
- Finance cards are no-data when the selected scope, currency, and period match
  no published invoices. If matching invoices exist and their actual total is
  zero, the total is still measured.
- Authorization or database failures remain errors; they must not be converted
  to a zero-valued card.
- The SQL is parameterized and is executed only after the endpoint authorizes
  the active context. Tenant scope is not inferred from the requested period.
- This registry covers current dashboard KPI cards; a separate portfolio history
  chart uses actual `/portfolio/analytics` series. It does not certify full
  reference-chart or pixel parity, and it does not add or imply SaaS platform
  billing revenue.
- The broader mapping from each of the 15 product screenshots to these cards,
  their real-data sources, no-data semantics, and current drill-down status is
  in [`KPI-REFERENCE-CROSSWALK.md`](KPI-REFERENCE-CROSSWALK.md). That crosswalk
  distinguishes implemented sources from reference-only metrics that still
  have no approved data source; it is not a claim of complete browser or
  pixel-parity acceptance.
