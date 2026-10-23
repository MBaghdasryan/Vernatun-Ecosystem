---
name: Payment domain policy
description: Fixed recipients and provider boundaries for Vernatun SaaS, property bills and utility aggregation
---

Vernatun SaaS uses platform-scoped Ameriabank; resident property bills use the
specific organization's ArCa/IPay merchant. Utilities go to the utility provider
through Telcell B2B, never to Vernatun or the property organization.

**Why:** The user explicitly fixed these three independent money flows in the payment master prompt.

**How to apply:** Keep platform/property/utility obligations and merchant routing
separate. An organization without ArCa must not fall back to Vernatun's merchant.
Telcell platform versus organization account scope must follow the actual B2B
contract, not an architectural guess. No fake zero utility balances, consumer-app
reverse engineering, or invented partner APIs. Missing official access must
remain contract-required; test mocks do not count as provider sandbox acceptance.

ArCa/IPay and Telcell APIs will be supplied later, after agreements. The user
has since supplied the Ameriabank vPOS 3.1 specification. Keep space in the admin
interface for manually entering connection details; do not require live API
access to retain the inactive setup area.

**Why:** The user explicitly deferred provider API access until agreements and
asked to keep manual configuration space in the admin interface.

**How to apply:** Preserve inactive provider setup and truthful contract-required
states. Add provider-specific credential fields when their documented contract
is available, without automatically activating payments.
