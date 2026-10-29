---
name: Platform console scope
description: Scope and wire-format constraints for global Vernatun Console pages.
---

Global platform-console screens should be scoped by platform role permissions and product routes, not by an organization's module entitlements. Date-only analytics fields should be serialized explicitly as `YYYY-MM-DD`; do not rely on implicit PostgreSQL-driver-to-JavaScript date formatting.

**Why:** Authenticated browser QA found that global analytics was hidden by an organization-module gate, and its monthly chart crashed when PostgreSQL date values arrived as locale-formatted strings.

**How to apply:** When adding platform-wide dashboards or reports, verify navigation under the platform-admin role and check that date values crossing the API boundary remain ISO-formatted.
