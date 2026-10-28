---
name: IAM role and user permissions
description: User-approved boundaries for shared role-template editing and individual permission overrides.
---

Platform administrators may edit shared role templates globally, except the protected `platform_admin` and `support` templates. Template changes apply to all assignments of that role, require a reason, and must be audited. Platform-only permissions cannot be added to other roles; `roles.assign` remains exclusive to `org_admin`, whose template must retain it. Platform administrators may also manage individual permission overrides globally; organization administrators may manage them only within their own organization. Individual overrides may only adjust the current role template's permissions and never bypass organization/building/unit scope, module or subscription entitlements, MFA, or endpoint-level authorization. Users cannot edit their own assignment, and the last unrestricted administrator must be protected.

The product has one platform-administrator role; combine platform-admin and super-admin console capabilities under `platform_admin` rather than introducing a separate super-admin role.

**Why:** The user requested editable role capabilities after the earlier fixed-template approach, while preserving recovery, platform authority, audit, and tenant-scope safeguards.

**Why:** The user clarified that Vernatun currently has one platform administrator and asked for the platform-admin and super-admin design capabilities in that single console.

**How to apply:** Shared template changes require a platform administrator; keep special platform roles protected and validate every permission on the server. Keep organization-level per-assignment changes scoped, preserve audit/reason records, and test authorization, stale edits, and administrator recovery.

**How to apply:** Extend the existing platform-admin navigation and permissions; do not add a second global-admin role unless the user changes this product decision.
