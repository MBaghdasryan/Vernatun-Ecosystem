---
name: Independent rate-limit budgets
description: Prevent unrelated routes from consuming each other's persistent request budgets.
---

Give independently configured rate limiters distinct storage namespaces, even when they share the PostgreSQL store/table.

**Why:** Authentication requests consumed a newly added public-form budget when both stores hashed the same client key under the same namespace. Correctly configured limits then rejected legitimate form submissions.

**How to apply:** When adding a limiter, choose its namespace explicitly or verify the generated key is disjoint from every existing limiter. Test interactions with login/bootstrap, not only the endpoint in isolation.
