---
name: Public demo access
description: Safety boundary for shared test accounts used by ImTun and HAYAT testers.
---

Public demo accounts should have normal product roles only inside a separate synthetic organization. They must not expose real resident data or connect to live physical devices, payment providers, or outbound messaging.

**Why:** The user wants external testers to exercise the same app functions without seeing real residents' information.

**How to apply:** Mark the organization, building, and fixture records as demo, keep permissions scoped to that tenant, label synthetic records, and leave physical or external integrations unconfigured.
