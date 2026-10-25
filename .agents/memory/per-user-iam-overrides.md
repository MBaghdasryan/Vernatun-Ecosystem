---
name: Per-user IAM overrides
description: User-approved scope and security boundaries for editing an individual assignment's permissions.
---

Platform administrators may manage individual permission overrides globally. Organization administrators may manage them only within their own organization. System role templates remain fixed; per-user overrides may only adjust permissions included in the assignment's base role. Overrides do not bypass organization/building/unit scope, module or subscription entitlements, MFA, or endpoint-level authorization. Users cannot edit their own assignment, and the last unrestricted administrator must be protected.

**Why:** The user selected scoped per-user permission controls instead of editing shared system role templates.

**How to apply:** Keep these boundaries in the IAM API and UI. Validate actor scope server-side, preserve audit/reason records, and test cross-organization access and last-administrator safeguards.
