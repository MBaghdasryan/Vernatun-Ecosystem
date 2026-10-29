---
name: Payment domain policy
description: Payment recipients, contract status, and provider boundaries for Vernatun SaaS, property bills, and utilities
---

No payment provider is currently contracted for Vernatun. ArCa Platform is a
planned integration under discussion, not an active provider or payment method.
Keep platform subscription fees, organization property charges, and utility
payments as separate obligations and recipients. Do not state or imply that a
provider is live until a contract is signed and the integration is activated.

**Why:** The user clarified on 2026-10-29 that there is no contracted payment provider yet and that ArCa Platform is only planned.

Payment responsibility delegation is not a settlement and must never change the
beneficiary or merchant. The management company defines delegable charge/service
categories. Within that allowlist, the owner proposes future responsibility to a
renter or family member; activation requires only the recipient's acceptance,
not company approval of each transfer. Legal ownership and the original
billing/account history must remain unchanged. Actual property payments use
the organization's own ArCa merchant, with provider server-to-server confirmation.

**Why:** The user explicitly clarified the consent and financial boundary for payer delegation.

**How to apply:** Keep platform/property/utility obligations and beneficiaries
separate. Never infer a provider, merchant, or live payment ability from a
configuration screen. No fake zero utility balances, consumer-app reverse
engineering, or invented partner APIs. Missing official access must remain
contract-required; test mocks do not count as provider sandbox acceptance.

Provider contracts and API access will be supplied later, after agreements. Keep
space in the admin interface for manually entering connection details; do not
require live API access to retain the inactive setup area.

**Why:** The user has not contracted the planned provider and has deferred live
provider activation until agreements and approved access exist.

**How to apply:** Preserve inactive provider setup and truthful contract-required
states. Add provider-specific credential fields when their documented contract
is available, without automatically activating payments.
