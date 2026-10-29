---
name: Platform console scope
description: Scope and wire-format constraints for global Vernatun Console pages.
---

Global platform-console screens should be scoped by platform role permissions and product routes, not by an organization's module entitlements. Date-only analytics filters and monthly buckets use UTC calendar boundaries explicitly, and API dates remain ISO `YYYY-MM-DD`; do not rely on session-timezone casts or implicit PostgreSQL-driver-to-JavaScript date formatting.

**Why:** Authenticated browser QA found that global analytics was hidden by an organization-module gate, and its monthly chart crashed when PostgreSQL date values arrived as locale-formatted strings. Implicit date-to-`timestamptz` casts also shift report boundaries under non-UTC database sessions.

**How to apply:** When adding platform-wide dashboards or reports, verify navigation under the platform-admin role, apply UTC explicitly when comparing date-only boundaries with `timestamptz`, and keep date values crossing the API boundary ISO-formatted.
