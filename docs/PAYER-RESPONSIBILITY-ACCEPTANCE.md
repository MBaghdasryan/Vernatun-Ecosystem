# Future payer responsibility

## Business rule

The management company enables individual canonical billing services/categories
for a building. The owner proposes future monthly responsibility to a currently
eligible renter or family member of the same unit. **Only the recipient accepts**;
there is no company approval of each proposal.

This is not a payment or settlement. Ownership, original payer assignments and
existing invoice/account history are unchanged. Property payments still belong
to the organization's own ArCa merchant and require provider server-to-server
confirmation. This change neither routes money nor grants global `billing.own`
to family members.

## Implementation

- Building/service policy is disabled by default, scoped through existing
  organization-settings authorization, versioned and audited.
- Owners may delegate only their own canonical payer rules. Proposal keys are
  idempotent; overlapping pending/accepted rules are rejected.
- Start and optional inclusive last month use `YYYY-MM-01`. New proposals and
  acceptance require a future start. Already-calculated affected periods,
  including drafts, cannot be reassigned.
- Pending, accepted, declined and revoked states are versioned and audited.
  Recipient accepts/declines; either participant may revoke future responsibility.
  Sensitive mutations require recent authentication.
- Recipient membership, assignment dates, family-delegation parent and live
  lease dates are rechecked when generating new charges. Existing legacy lease
  access semantics are preserved. Disabled policy or lost eligibility makes
  subsequent unbilled periods fall back to the original payer.
- Single and batch billing use the same resolver after locking canonical payer
  rules. A **separate SQL statement after acquiring locks** avoids retaining a
  pre-acceptance snapshot after a lock wait.
- Charges remain unique by canonical payer assignment and period. A nullable
  delegation reference records the consent used for the new charge.
- Batch publication recomputes the snapshot/fingerprint. Changed payer or consent
  invalidates the preview rather than silently billing somebody else. Draft
  batches prepared before this update may require a new preview.
- The resident panel exposes only the current authenticated user's published
  invoices in the current unit. It is read-only; it is not a replacement checkout.

## Interfaces

- Web resident: `/imtun/preferences` → Payer responsibility.
- Web company: `/os/resident`, building selector → allowed payer services.
- Native ImTun: account/preferences → Payer responsibility, including proposal,
  accept/decline, revoke confirmation and recent-authentication recovery.
- Labels and explanations are supplied in Armenian, Russian and English.

## Verification

- Full workspace typecheck passed, including all seven artifact/script projects.
- Vernatun production build passed. Existing large-chunk warning remains.
- Isolated resident suite: **31/31 passed**, including three financial acceptance
  cases covering consent, idempotency, default-deny policy, scoped access,
  preservation of original assignments/invoices, batch invalidation and posting,
  family-assignment/delegation expiration, and concurrent acceptance versus billing.
- Development API health returned 200 after workflow restart.
- API compiled and started; Metro successfully bundled Android and iOS.
- Focused browser acceptance passed in an isolated QA schema: company enabled a
  new service policy at `/os/resident`; owner selected that service and the real
  same-unit family fixture at `/imtun/preferences`, with server-provided next
  month; recipient accepted through their UI, and owner reload showed accepted.
  Owner had no Accept button; no company per-transfer approval was required.
- A 390×844 read-only screenshot confirmed that the accepted-state card fits
  the viewport. This is not acceptance of the complete responsive/a11y matrix.
- Revoke/confirmation was not exercised in the browser pass (server transitions
  were tested). A non-blocking duplicate React-key warning appeared on the
  existing administration screen; policy editing still succeeded.

## Migration and remaining limits

`048_resident_superapp.sql` retains its agreed name. New schema is in
`052_resident_payer_responsibility.sql`, applied in development and disposable
test schemas only. **Production was not changed or accepted.** Production rollout
requires backup, the standard migration plan/drift check and coordinated API/UI
deployment.

Still separate: notifications about responsibility proposals/transitions;
recorded-renter lease cancellation versus billing concurrency acceptance; family
checkout authorization within the existing organization ArCa flow; actual payment
provider acceptance; physical-phone and full responsive/accessibility/theme
matrices. Do not claim the complete resident master prompt is finished.
